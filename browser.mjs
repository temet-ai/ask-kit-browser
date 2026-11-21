// A client for a real headless Chromium, driven through the Playwright library that is already on
// this machine. It loads a page in a fresh browser with an empty profile and reports what the page
// did: status, text, links, forms, images, console messages, page errors, failed requests, measured
// layout faults, screenshots and what a short list of steps (click, type, press) changes.
//
// Three checks. Nothing of the person's own browser is used: every call launches a new Chromium with
// a new temporary profile that is deleted afterwards, and no cookies, headers or logins can be passed
// in. Anything that submits a form, types into a password field, types into any field on a host that
// is not local, or sends a request other than GET after the first load needs `act` (the caller asked
// for a change). And every browser is killed when its call ends or its time is up.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};
const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};

// ---- finding Playwright and a Chromium ------------------------------------------------------

function loadPlaywright(dir) {
  if (!dir) throw new Error("PLAYWRIGHT_MODULE is not set: no Node playwright or playwright-core package was found. Install one (mise use -g npm:playwright) or set PLAYWRIGHT_MODULE to its folder.");
  const real = fs.realpathSync(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf8"));
  const req = createRequire(path.join(real, "package.json"));
  let mod;
  if (pkg.name === "playwright") {
    try { mod = req("playwright-core"); } catch { mod = req(real); }
  } else mod = req(real);
  if (!mod?.chromium) throw new Error(`${dir} has no chromium export`);
  return { chromium: mod.chromium, version: pkg.version, dir: real };
}

function findExecutable(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const root = path.join(os.homedir(), ".cache", "ms-playwright");
  const newest = (prefix, rel) => {
    try {
      return fs.readdirSync(root).filter((d) => d.startsWith(prefix + "-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])).map((d) => path.join(root, d, rel)).find((p) => fs.existsSync(p));
    } catch { return undefined; }
  };
  const found = newest("chromium_headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell") || newest("chromium", "chrome-linux64/chrome");
  if (found) return found;
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"]) if (fs.existsSync(p)) return p;
  throw new Error("no Chromium found: none under ~/.cache/ms-playwright and none of /usr/bin/chromium, google-chrome-stable");
}

// ---- safety ---------------------------------------------------------------------------------

const isLocalHost = (h) => /^(localhost|\[?::1\]?|0\.0\.0\.0|127(\.\d+){3})$/.test(h) || h.endsWith(".localhost");
const isLocalUrl = (u) => {
  try { return isLocalHost(new URL(u).hostname); } catch { return false; }
};
const LINK_LOCAL = /^(169\.254\.|\[?fe80:|metadata\.google\.internal$)/i;

function checkUrl(u) {
  let x;
  try { x = new URL(u); } catch { deny(`"${u}" is not a URL`); }
  if (x.protocol !== "http:" && x.protocol !== "https:") deny(`only http and https pages are opened (got ${x.protocol}); local files are not read`);
  if (LINK_LOCAL.test(x.hostname)) deny("link-local and cloud metadata addresses are not opened");
  if (x.username || x.password) deny("a URL with a user name or password is not opened; credentials are never sent");
  return x.href;
}

const SECRET_PARAM = /^(token|access_token|id_token|key|api_?key|secret|password|passwd|pwd|auth|authorization|sig|signature|session|sid|code)$/i;
// Credentials in a reported URL (user:pass@, token=...) never reach the model.
const maskUrl = (u) => {
  if (String(u).startsWith("chrome-error:")) return "(the browser's error page)";
  try {
    const x = new URL(u);
    if (x.username || x.password) { x.username = "***"; x.password = ""; }
    for (const k of [...x.searchParams.keys()]) if (SECRET_PARAM.test(k)) x.searchParams.set(k, "***");
    return x.href.length > 300 ? x.href.slice(0, 300) + "…" : x.href;
  } catch { return String(u).slice(0, 300); }
};
const clip = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n) + "…" : String(s ?? ""));

// ---- browser lifecycle ----------------------------------------------------------------------

const live = new Set(); // temporary profile folders of browsers that are running; the process-wide kill finds them by this path
function killProfile(dir, sync) {
  try {
    if (sync) execFileSync("pkill", ["-9", "-f", "--", dir], { stdio: "ignore", timeout: 3000 });
    else return new Promise((r) => execFile("pkill", ["-9", "-f", "--", dir], () => r()));
  } catch { /* nothing left to kill (pkill exits 1) */ }
}
process.on("exit", () => { for (const d of live) killProfile(d, true); });

const ARGS = ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--mute-audio", "--hide-scrollbars=false"];

export function make({ settings, push, cwd, act }) {
  const canAct = !!act;
  let pw = null;
  const playwright = () => (pw ??= loadPlaywright(settings?.PLAYWRIGHT_MODULE));
  const exe = () => findExecutable(settings?.BROWSER_EXECUTABLE);
  const stateDir = () => process.env.ASK_KIT_STATE ? path.join(process.env.ASK_KIT_STATE, "browser-shots") : path.join(os.homedir(), ".local", "state", "ask-kit", "browser-shots");

  // Run fn(page, ctx) in a new Chromium with an empty temporary profile; always closes it.
  async function withPage(url, o, fn) {
    const href = checkUrl(url);
    const timeoutMs = Math.max(1000, Math.min(Number(o.timeoutMs) || 30_000, 120_000));
    const width = Math.max(200, Math.min(Number(o.width) || 1280, 4000));
    const mobile = width <= 500;
    const height = Math.max(200, Math.min(Number(o.height) || (mobile ? 844 : 800), 4000));
    const { chromium } = playwright();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-browser-"));
    live.add(profile);
    let ctx;
    let timer;
    const work = (async () => {
      ctx = await chromium.launchPersistentContext(profile, {
        executablePath: exe(), headless: true, args: ARGS, viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: Number(o.scale) || 1,
        colorScheme: o.scheme === "dark" ? "dark" : "light", acceptDownloads: false, serviceWorkers: "block", permissions: [], ignoreHTTPSErrors: !!o.ignoreHttpsErrors,
        reducedMotion: "reduce", timeout: 20_000,
      });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const rec = newRecorder(page, ctx, { canAct, timeoutMs });
      const out = await fn(page, rec, { href, width, height, timeoutMs });
      return out;
    })();
    // Hard limit for the whole call: one page load plus its steps and a margin.
    const hard = timeoutMs * 2 + 20_000 + (o.steps?.length ?? 0) * 8_000;
    const dead = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`the browser call did not finish in ${Math.round(hard / 1000)}s and the browser was killed`)), hard); });
    try {
      return await Promise.race([work, dead]);
    } finally {
      clearTimeout(timer);
      try { if (ctx) await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* closing a dead browser */ }
      await killProfile(profile);
      live.delete(profile);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the folder is gone or still busy */ }
      work.catch(() => {});
    }
  }

  function newRecorder(page, ctx, { canAct, timeoutMs }) {
    const r = { console: [], pageErrors: [], failed: [], httpErrors: [], slow: [], blocked: [], dialogs: [], popups: [], requests: 0, aborted: 0, stepping: false, started: new Map(), redirects: [], mainStatus: null };
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning" || t === "warn") {
        const l = m.location();
        r.console.push({ type: t === "warn" ? "warning" : t, text: clip(m.text(), 500), source: l?.url ? `${maskUrl(l.url)}:${l.lineNumber + 1}:${(l.columnNumber ?? 0) + 1}` : null });
      }
    });
    page.on("pageerror", (e) => {
      r.pageErrors.push({ message: clip(e.message, 500), stack: clip((e.stack || "").split("\n").slice(1, 4).map((s) => s.trim()).join(" | "), 400) });
    });
    page.on("request", (q) => { r.requests++; r.started.set(q, Date.now()); });
    page.on("requestfinished", (q) => {
      const ms = Date.now() - (r.started.get(q) ?? Date.now());
      if (ms > 1500) r.slow.push({ url: maskUrl(q.url()), method: q.method(), ms, type: q.resourceType() });
    });
    page.on("requestfailed", (q) => {
      const why = q.failure()?.errorText ?? "failed";
      if (/ERR_ABORTED|aborted/i.test(why)) { r.aborted++; return; }
      r.failed.push({ url: maskUrl(q.url()), method: q.method(), type: q.resourceType(), failure: why });
    });
    page.on("response", (resp) => {
      const q = resp.request();
      if (q.frame() === page.mainFrame() && q.isNavigationRequest() && r.mainStatus == null) r.mainStatus = resp.status();
      if (resp.status() >= 400) r.httpErrors.push({ url: maskUrl(resp.url()), method: q.method(), status: resp.status(), type: q.resourceType() });
    });
    page.on("dialog", (d) => { r.dialogs.push({ type: d.type(), message: clip(d.message(), 200) }); d.dismiss().catch(() => {}); });
    ctx.on("page", (p) => { if (p !== page) { r.popups.push(maskUrl(p.url())); p.close().catch(() => {}); } });
    // After the first load, anything other than GET that the kit's steps cause is held back unless the caller asked for a change.
    ctx.route("**/*", (route) => {
      const q = route.request();
      let u;
      try { u = new URL(q.url()); } catch { return route.continue(); }
      if (/^https?:$/.test(u.protocol) && LINK_LOCAL.test(u.hostname)) { r.blocked.push({ url: maskUrl(q.url()), why: "link-local address" }); return route.abort(); }
      if (r.stepping && !canAct && !["GET", "HEAD", "OPTIONS"].includes(q.method())) {
        r.blocked.push({ url: maskUrl(q.url()), method: q.method(), why: "not GET and the caller did not ask for a change" });
        return route.abort();
      }
      return route.continue();
    });
    return r;
  }

  const settle = async (page, ms = 1500) => {
    await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
    await page.waitForTimeout(250);
  };

  async function load(page, rec, { href, timeoutMs }, o) {
    const wait = ["commit", "domcontentloaded", "load", "networkidle"].includes(o.wait) ? o.wait : "load";
    const t = Date.now();
    let resp = null, error = null;
    try {
      resp = await page.goto(href, { waitUntil: wait === "networkidle" ? "load" : wait, timeout: timeoutMs });
      if (wait === "networkidle") await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10_000) }).catch(() => {});
      else await settle(page, o.settleMs ?? 2000);
    } catch (e) {
      error = String(e.message).split("\n")[0];
    }
    const chain = [];
    for (let q = resp?.request(); q?.redirectedFrom(); q = q.redirectedFrom()) chain.unshift({ url: maskUrl(q.redirectedFrom().url()) });
    return { resp, error, ms: Date.now() - t, redirects: chain };
  }

  // ---- steps ----------------------------------------------------------------------------------

  const looksLikeText = (s) => /[A-Z\s]/.test(s) && !/[#.\[\]>:=*~+()]/.test(s.replace(/\s+/g, "")) ;
  function locate(page, x) {
    if (typeof x === "string") return looksLikeText(x) ? page.getByText(x, { exact: false }).first() : page.locator(x).first();
    if (x?.text != null) return page.getByText(String(x.text), { exact: !!x.exact }).first();
    if (x?.role) return page.getByRole(x.role, x.name ? { name: x.name } : undefined).first();
    if (x?.selector) return page.locator(x.selector).first();
    throw new Error("a step target is a selector string, {text}, {role, name} or {selector}");
  }
  async function snap(page) {
    const s = await page.evaluate(() => ({ url: location.href, title: document.title, text: (document.body?.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 1500) })).catch(() => ({ url: page.url(), title: "", text: [] }));
    return s;
  }

  async function runSteps(page, rec, steps) {
    const results = [];
    for (const [i, st] of (steps ?? []).slice(0, 25).entries()) {
      const kind = Object.keys(st ?? {})[0];
      const arg = st?.[kind];
      const before = await snap(page);
      const errs0 = rec.console.length + rec.pageErrors.length, reqs0 = rec.failed.length + rec.httpErrors.length;
      const res = { step: i + 1, did: `${kind} ${typeof arg === "string" ? JSON.stringify(arg) : JSON.stringify(arg)}`.slice(0, 160), ok: true };
      rec.stepping = true;
      try {
        if (kind === "click" || kind === "hover") {
          const loc = locate(page, arg);
          await loc.waitFor({ state: "visible", timeout: 5000 });
          if (kind === "click") {
            if (!canAct) {
              const submits = await loc.evaluate((el) => {
                const b = el.closest("button, input");
                if (!b) return false;
                const t = (b.getAttribute("type") || (b.tagName === "BUTTON" ? "submit" : "")).toLowerCase();
                return !!b.form && (t === "submit" || t === "image");
              });
              if (submits) notInThisAsk("clicking a button that submits a form");
            }
            await loc.click({ timeout: 5000 });
          } else await loc.hover({ timeout: 5000 });
        } else if (kind === "type") {
          if (!Array.isArray(arg) || arg.length !== 2) throw new Error("type takes [target, text]");
          const loc = locate(page, arg[0]);
          await loc.waitFor({ state: "visible", timeout: 5000 });
          const pw = await loc.evaluate((el) => /^password$/i.test(el.type || "") || /pass|pwd|secret/i.test(`${el.name} ${el.id} ${el.autocomplete}`));
          if (pw && !canAct) notInThisAsk("typing into a password field");
          if (!canAct && !isLocalUrl(page.url())) notInThisAsk(`filling a form field on ${new URL(page.url()).hostname}, which is not a local host`);
          await loc.fill(String(arg[1]), { timeout: 5000 });
        } else if (kind === "press") {
          const key = String(arg);
          if (!canAct && /^(Enter|NumpadEnter)$/.test(key)) {
            const inForm = await page.evaluate(() => { const a = document.activeElement; return !!(a && a.form && a.tagName === "INPUT"); });
            if (inForm) notInThisAsk("pressing Enter in a form field (it submits the form)");
          }
          await page.keyboard.press(key);
        } else if (kind === "waitFor") {
          await locate(page, arg).waitFor({ state: "visible", timeout: 8000 });
        } else if (kind === "scroll") {
          if (arg === "bottom") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          else if (arg === "top") await page.evaluate(() => window.scrollTo(0, 0));
          else if (typeof arg === "number") await page.evaluate((n) => window.scrollBy(0, n), arg);
          else await locate(page, arg).scrollIntoViewIfNeeded({ timeout: 5000 });
        } else if (kind === "wait") {
          await page.waitForTimeout(Math.min(Number(arg) || 500, 5000));
        } else throw new Error(`unknown step "${kind}"; use click, type, press, waitFor, scroll, hover or wait`);
        await settle(page, 1500);
      } catch (e) {
        res.ok = false;
        res.error = String(e.message).split("\n")[0].slice(0, 300);
        if (/not in this ask|not allowed/.test(res.error)) { rec.stepping = false; throw e; }
        if (/waiting for|locator/i.test(res.error) && typeof arg === "string" && !looksLikeText(arg)) res.hint = "a string target is a CSS selector; for the text of an element use {text: \"...\"}";
      } finally {
        rec.stepping = false;
      }
      const after = await snap(page);
      const had = new Set(before.text), has = new Set(after.text);
      const added = after.text.filter((l) => !had.has(l)), removed = before.text.filter((l) => !has.has(l));
      res.url = maskUrl(after.url);
      if (after.url !== before.url) res.navigatedFrom = maskUrl(before.url);
      if (after.title !== before.title) res.title = after.title;
      res.changed = added.length + removed.length > 0 || after.url !== before.url;
      if (added.length) res.added = added.slice(0, 15).map((l) => clip(l, 160));
      if (removed.length) res.removed = removed.slice(0, 15).map((l) => clip(l, 160));
      if (added.length > 15) res.moreAdded = added.length - 15;
      if (removed.length > 15) res.moreRemoved = removed.length - 15;
      const newErr = rec.console.length + rec.pageErrors.length - errs0, newReq = rec.failed.length + rec.httpErrors.length - reqs0;
      if (newErr > 0) res.newErrors = newErr;
      if (newReq > 0) res.newFailedRequests = newReq;
      results.push(res);
      if (!res.ok) break;
    }
    return results;
  }

  // ---- page report ----------------------------------------------------------------------------

  const reportInPage = (textLimit) => {
    const vis = (el) => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && (r.width > 0 || r.height > 0);
    };
    const txt = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    const all = (sel) => [...document.querySelectorAll(sel)];
    const body = document.body;
    const bodyText = (body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
    const rootIds = ["root", "app", "__next", "__nuxt", "svelte", "main-content"];
    const roots = rootIds.map((id) => document.getElementById(id)).filter(Boolean).map((el) => ({ id: el.id, children: el.children.length, textLength: txt(el).length }));
    const heads = all("h1,h2,h3,h4").filter(vis);
    const links = all("a[href]").filter(vis);
    const imgs = all("img").filter((i) => i.currentSrc || i.getAttribute("src"));
    const label = (el) => (el.labels?.[0] ? txt(el.labels[0]) : el.getAttribute("aria-label") || el.placeholder || "");
    return {
      title: document.title,
      lang: document.documentElement.lang || null,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      description: document.querySelector('meta[name="description"]')?.content ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      roots,
      headings: heads.slice(0, 40).map((h) => ({ level: Number(h.tagName[1]), text: txt(h).slice(0, 120) })),
      headingsTotal: heads.length,
      text: bodyText.slice(0, textLimit),
      textLength: bodyText.length,
      links: links.slice(0, 60).map((a) => ({ text: txt(a).slice(0, 80) || a.getAttribute("aria-label") || "(no text)", href: a.href })),
      linksTotal: links.length,
      forms: all("form").map((f) => ({
        action: f.action, method: (f.method || "get").toLowerCase(), visible: vis(f),
        fields: [...f.elements].filter((e) => e.name || e.id).slice(0, 25).map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || e.id, label: label(e).slice(0, 60), required: !!e.required })),
        submit: [...f.querySelectorAll("button,input[type=submit]")].map((b) => (b.innerText || b.value || "").trim()).filter(Boolean).slice(0, 4),
      })).slice(0, 10),
      buttons: all("button,[role=button],input[type=button],input[type=submit]").filter(vis).slice(0, 40).map((b) => ({ text: (txt(b) || b.value || b.getAttribute("aria-label") || "").slice(0, 60), disabled: !!b.disabled })),
      buttonsTotal: all("button,[role=button],input[type=button],input[type=submit]").filter(vis).length,
      images: imgs.slice(0, 60).map((i) => {
        const r = i.getBoundingClientRect();
        return { src: i.currentSrc || i.src, alt: i.getAttribute("alt"), loaded: i.complete && i.naturalWidth > 0, natural: `${i.naturalWidth}x${i.naturalHeight}`, shown: `${Math.round(r.width)}x${Math.round(r.height)}`, lazy: i.loading === "lazy" };
      }),
      imagesTotal: imgs.length,
      framework: { next: !!window.__NEXT_DATA__ || !!document.getElementById("__next"), nextErrorOverlay: (() => { const d = [...document.querySelectorAll("nextjs-portal")].map((p) => p.shadowRoot?.querySelector("[data-nextjs-dialog-overlay], [data-nextjs-dialog], [role=dialog], dialog[open]")).find(Boolean); return d ? (d.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "an error dialog" : null; })(), react: !!document.querySelector("[data-reactroot]") },
      documentHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  };

  function problemsOf(rep, rec, load) {
    const p = [];
    if (load.error) p.push(`the page did not load: ${load.error}`);
    const st = rep.status;
    if (st != null && st >= 400) p.push(`status ${st}`);
    if (!load.error && rep.textLength === 0) p.push("no visible text");
    for (const r of rep.roots ?? []) if (r.children === 0) p.push(`root element #${r.id} has no children (nothing was rendered into it)`);
    if (rep.framework?.nextErrorOverlay) p.push(`a Next.js error overlay is open: ${rep.framework.nextErrorOverlay}`);
    if (rec.pageErrors.length) p.push(`${rec.pageErrors.length} uncaught page error${rec.pageErrors.length > 1 ? "s" : ""}`);
    const ce = rec.console.filter((c) => c.type === "error");
    if (ce.length) p.push(`${ce.length} console error${ce.length > 1 ? "s" : ""}`);
    if (rec.console.some((c) => /hydrat/i.test(c.text))) p.push("a hydration message in the console");
    if (rec.failed.length) p.push(`${rec.failed.length} failed request${rec.failed.length > 1 ? "s" : ""}`);
    const he = rec.httpErrors.filter((e) => e.type !== "document" || e.status !== st);
    if (he.length) p.push(`${he.length} response${he.length > 1 ? "s" : ""} with status 400 or more`);
    const bad = (rep.images ?? []).filter((i) => !i.loaded && !i.lazy);
    if (bad.length) p.push(`${bad.length} image${bad.length > 1 ? "s" : ""} did not load`);
    if (rec.blocked.length) p.push(`${rec.blocked.length} request${rec.blocked.length > 1 ? "s" : ""} held back (not GET, no act)`);
    return p;
  }

  // Same message, same place: counted once. Numbers and ids in the text are folded so "item 3" and "item 4" group.
  function dedupe(list, keyOf) {
    const m = new Map();
    for (const x of list) {
      const k = keyOf(x);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { ...x, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }
  const fold = (s) => String(s).replace(/\d+/g, "N").replace(/[0-9a-f]{8,}/gi, "H");

  function errorsOf(rec) {
    const consoleErrors = dedupe(rec.console.filter((c) => c.type === "error"), (c) => fold(c.text) + (c.source ?? ""));
    const consoleWarnings = dedupe(rec.console.filter((c) => c.type === "warning"), (c) => fold(c.text) + (c.source ?? ""));
    const pageErrors = dedupe(rec.pageErrors, (e) => fold(e.message));
    const failedRequests = dedupe(rec.failed, (e) => `${e.method} ${e.url}`);
    const badResponses = dedupe(rec.httpErrors, (e) => `${e.method} ${e.url} ${e.status}`);
    return { consoleErrors, consoleWarnings, pageErrors, failedRequests, badResponses, slowRequests: rec.slow.slice(0, 10), blockedRequests: rec.blocked, dialogs: rec.dialogs, popups: rec.popups };
  }
  const cap = (list, n) => (list.length > n ? { items: list.slice(0, n), more: list.length - n } : { items: list, more: 0 });

  // ---- public calls ---------------------------------------------------------------------------

  const api = {
    cwd,
    act: canAct,

    info() {
      const p = playwright();
      return { playwright: p.version, playwrightDir: p.dir, executable: exe(), settings: { PLAYWRIGHT_MODULE: settings?.PLAYWRIGHT_MODULE ?? null }, shotsFolder: stateDir() };
    },

    isLocal: isLocalUrl,

    /** Load a page and report it. */
    async open(url, o = {}) {
      const textLimit = Math.max(200, Math.min(Number(o.textLimit) || 3000, 20000));
      return withPage(url, o, async (page, rec, c) => {
        const l = await load(page, rec, c, o);
        const steps = o.steps?.length ? await runSteps(page, rec, o.steps) : undefined;
        let rep = {};
        try { rep = await page.evaluate(reportInPage, textLimit); } catch (e) { rep = { evalError: String(e.message).split("\n")[0], textLength: 0 }; }
        for (const k of ["headings", "links", "buttons", "images", "forms", "roots"]) rep[k] ??= [];
        rep.status = l.resp?.status() ?? rec.mainStatus;
        const perf = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd), ttfbMs: Math.round(n.responseStart) } : null; }).catch(() => null);
        const e = errorsOf(rec);
        const out = {
          url: maskUrl(c.href), finalUrl: maskUrl(page.url()), redirected: l.redirects.length > 0 || page.url().replace(/#.*/, "") !== c.href.replace(/#.*/, ""), redirects: l.redirects,
          status: rep.status, ok: !l.error && rep.status != null && rep.status < 400, loadError: l.error ?? undefined,
          viewport: `${c.width}x${c.height}`, title: rep.title, lang: rep.lang, description: rep.description, viewportMeta: rep.viewportMeta,
          headings: rep.headings, headingsMore: Math.max(0, (rep.headingsTotal ?? 0) - (rep.headings?.length ?? 0)),
          text: rep.text, textLength: rep.textLength, textCut: (rep.textLength ?? 0) > textLimit ? `${rep.textLength - textLimit} more characters not shown` : undefined,
          roots: rep.roots,
          links: rep.links, linksMore: Math.max(0, (rep.linksTotal ?? 0) - (rep.links?.length ?? 0)),
          forms: rep.forms, buttons: rep.buttons, buttonsMore: Math.max(0, (rep.buttonsTotal ?? 0) - (rep.buttons?.length ?? 0)),
          images: rep.images, imagesMore: Math.max(0, (rep.imagesTotal ?? 0) - (rep.images?.length ?? 0)), imagesNotLoaded: (rep.images ?? []).filter((i) => !i.loaded).length,
          console: { errors: e.consoleErrors.length, warnings: e.consoleWarnings.length, first: cap([...e.consoleErrors, ...e.consoleWarnings], 8).items },
          pageErrors: e.pageErrors.slice(0, 8), failedRequests: e.failedRequests.slice(0, 10), badResponses: e.badResponses.slice(0, 10), slowRequests: e.slowRequests,
          requests: rec.requests, blockedRequests: e.blockedRequests, dialogs: e.dialogs, popups: e.popups,
          timing: { loadWaitedMs: l.ms, ...(perf ?? {}) },
          steps,
        };
        out.rendered = out.ok && (rep.textLength ?? 0) > 0 && !(rep.roots ?? []).some((r) => r.children === 0);
        out.problems = problemsOf({ ...rep, status: rep.status }, rec, l);
        return out;
      });
    },

    /** Console errors and warnings, uncaught page errors, failed and bad requests of one page load, each kind once with a count. */
    async errors(url, o = {}) {
      return withPage(url, o, async (page, rec, c) => {
        const l = await load(page, rec, c, o);
        const steps = o.steps?.length ? await runSteps(page, rec, o.steps) : undefined;
        await settle(page, 1000);
        const e = errorsOf(rec);
        return { url: maskUrl(c.href), finalUrl: maskUrl(page.url()), status: l.resp?.status() ?? rec.mainStatus, loadError: l.error ?? undefined, ...e, requests: rec.requests, steps };
      });
    },

    /** Measured layout faults at one width, with the colour-pair check. */
    async measure(url, o = {}) {
      return withPage(url, o, async (page, rec, c) => {
        const l = await load(page, rec, c, o);
        const steps = o.steps?.length ? await runSteps(page, rec, o.steps) : undefined;
        if (o.fullScroll !== false) { // lazy content: scroll through once so images and sections load, then back to the top
          await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(h, 20000); y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); }).catch(() => {});
          await settle(page, 1500);
        }
        const m = await page.evaluate(measureInPage, { tapMin: o.tapMin ?? (c.width <= 768 ? 44 : 24) }).catch((e) => ({ evalError: String(e.message).split("\n")[0] }));
        if (m.evalError) return { url: maskUrl(c.href), width: c.width, loadError: l.error, error: m.evalError };
        const cb = colourBlind(m.colours);
        delete m.colours;
        const problems = [];
        if (l.error) problems.push(`the page did not load: ${l.error}`);
        if (m.overflowX) problems.push(`horizontal overflow: the page is ${m.scrollWidth}px wide in a ${c.width}px viewport`);
        if (m.wide.length) problems.push(`${m.widePlus} element${m.widePlus > 1 ? "s" : ""} reach past the viewport edge`);
        if (m.clipped.count) problems.push(`${m.clipped.count} element${m.clipped.count > 1 ? "s" : ""} with clipped text`);
        if (m.imagesBroken.count) problems.push(`${m.imagesBroken.count} broken image${m.imagesBroken.count > 1 ? "s" : ""}`);
        if (m.imagesNoSize.count) problems.push(`${m.imagesNoSize.count} image${m.imagesNoSize.count > 1 ? "s" : ""} with no width and height (layout shifts as they load)`);
        if (m.tapTargets.count) problems.push(`${m.tapTargets.count} tap target${m.tapTargets.count > 1 ? "s" : ""} smaller than ${m.tapTargets.minimum}px`);
        if (m.contrast.failing) problems.push(`${m.contrast.failing} text element${m.contrast.failing > 1 ? "s" : ""} below the WCAG contrast ratio`);
        if (!m.viewportMeta && c.width <= 500) problems.push("no viewport meta tag: a phone shows this page zoomed out");
        if (cb.pairs.length) problems.push(`${cb.pairs.length} colour pair${cb.pairs.length > 1 ? "s" : ""} hard to tell apart with red-green colour blindness`);
        return { url: maskUrl(c.href), finalUrl: maskUrl(page.url()), status: l.resp?.status() ?? rec.mainStatus, loadError: l.error ?? undefined, width: c.width, height: c.height, ...m, colourBlind: cb, problems, steps };
      });
    },

    /** Screenshot to a PNG file. simulate: "deuteranopia" | "protanopia" shows the page as red-green colour blindness does. */
    async screenshot(url, o = {}) {
      return withPage(url, o, async (page, rec, c) => {
        const l = await load(page, rec, c, o);
        const steps = o.steps?.length ? await runSteps(page, rec, o.steps) : undefined;
        if (o.simulate) {
          const M = SIM[o.simulate];
          if (!M) throw new Error('simulate is "deuteranopia" or "protanopia"');
          const values = [...M[0], 0, 0, ...M[1], 0, 0, ...M[2], 0, 0, 0, 0, 0, 1, 0].join(" ");
          await page.evaluate((values) => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("style", "position:absolute;width:0;height:0");
            svg.innerHTML = `<filter id="ak-cb" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${values}"/></filter>`;
            document.body.appendChild(svg);
            document.documentElement.style.filter = "url(#ak-cb)";
          }, values).catch(() => {});
        }
        const dir = o.path ? path.dirname(path.resolve(o.path)) : stateDir();
        fs.mkdirSync(dir, { recursive: true });
        const host = (() => { try { return new URL(c.href).host.replace(/[^a-z0-9.-]+/gi, "_"); } catch { return "page"; } })();
        const file = o.path ? path.resolve(o.path) : path.join(dir, `${host}-${c.width}${o.fullPage ? "-full" : ""}${o.simulate ? "-" + o.simulate : ""}-${Date.now()}.png`);
        if (!/\.png$/i.test(file)) deny("a screenshot path must end in .png");
        if (fs.existsSync(file) && fs.readFileSync(file).subarray(1, 4).toString() !== "PNG") deny("that path holds a file that is not a PNG; it is not overwritten");
        await page.screenshot({ path: file, fullPage: !!o.fullPage, animations: "disabled", timeout: 20_000 });
        const buf = fs.readFileSync(file, { encoding: null });
        const dims = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        return { path: file, bytes: buf.length, ...dims, viewport: `${c.width}x${c.height}`, fullPage: !!o.fullPage, simulate: o.simulate ?? null, status: l.resp?.status() ?? rec.mainStatus, loadError: l.error ?? undefined, finalUrl: maskUrl(page.url()), steps, note: "an image file: it is for a reviewer who can see it; nothing here judges how it looks" };
      });
    },

    /** Is a text or a selector on the page, visible, and where. */
    async find(url, o = {}) {
      if (!o.text && !o.selector) throw new Error("find needs text or selector");
      return withPage(url, o, async (page, rec, c) => {
        const l = await load(page, rec, c, o);
        const steps = o.steps?.length ? await runSteps(page, rec, o.steps) : undefined;
        const loc = o.selector ? page.locator(o.selector) : page.getByText(String(o.text), { exact: !!o.exact });
        const count = await loc.count().catch(() => 0);
        const matches = [];
        for (let i = 0; i < Math.min(count, o.max ?? 5); i++) {
          const m = await loc.nth(i).evaluate((el) => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            const visible = s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
            const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
            const sel = (e) => { const p = []; for (let n = 0; e && n < 4 && e.nodeType === 1; n++, e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "")); return p.join(" > "); };
            return {
              tag: el.tagName.toLowerCase(), selector: sel(el), visible, inViewport: visible && inView,
              hiddenBy: visible ? undefined : s.display === "none" ? "display:none" : s.visibility === "hidden" ? "visibility:hidden" : Number(s.opacity) === 0 ? "opacity:0" : "zero size",
              box: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
              text: (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
              around: (el.parentElement?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
              disabled: !!el.disabled, href: el.href || undefined,
            };
          }).catch(() => null);
          if (m) matches.push(m);
        }
        const inText = o.text ? await page.evaluate((t) => (document.body?.textContent ?? "").toLowerCase().includes(String(t).toLowerCase()), String(o.text)).catch(() => false) : undefined;
        return { url: maskUrl(c.href), finalUrl: maskUrl(page.url()), status: l.resp?.status() ?? rec.mainStatus, loadError: l.error ?? undefined, query: o.selector ? { selector: o.selector } : { text: o.text, exact: !!o.exact }, found: count > 0, count, visibleCount: matches.filter((m) => m.visible).length, inSourceText: inText, matches, steps };
      });
    },

    /** Run steps, then report the page after them. */
    async flow(url, steps, o = {}) {
      if (!Array.isArray(steps) || !steps.length) throw new Error("flow needs a list of steps");
      return this.open(url, { ...o, steps, textLimit: o.textLimit ?? 1500 });
    },
  };
  void push;
  return api;
}

// ---- colour-blindness -------------------------------------------------------------------------

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const SIM = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
const simulate = (rgb, M) => { const l = rgb.map(lin); return M.map((row) => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])); };
function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const chroma = (rgb) => { const l = lab(rgb); return Math.hypot(l[1], l[2]); };
const hex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const hue = (rgb) => { const l = lab(rgb); return ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360; };

// colours: [{rgb, role, count, sample, text}] from the page. A pair is reported when the two colours
// are clearly different to normal vision and lose most of that difference under deuteranopia or
// protanopia, with at least one of them a saturated colour.
function colourBlind(colours = []) {
  const byHex = new Map();
  for (const c of colours) {
    const h = hex(c.rgb);
    const e = byHex.get(h);
    if (e) { e.count += c.count; e.roles.add(c.role); } else byHex.set(h, { hex: h, rgb: c.rgb, count: c.count, roles: new Set([c.role]), sample: c.sample, text: c.text });
  }
  const list = [...byHex.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  const pairs = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (Math.max(chroma(a.rgb), chroma(b.rgb)) < 25) continue;
    const normal = dE(a.rgb, b.rgb);
    if (normal < 25) continue;
    for (const [name, M] of Object.entries(SIM)) {
      const sim = dE(simulate(a.rgb, M), simulate(b.rgb, M));
      if ((normal >= 25 && sim < 12) || (normal >= 40 && sim < 30 && sim / normal <= 0.3)) {
        const ha = hue(a.rgb), hb = hue(b.rgb);
        const redGreen = (ha < 50 || ha > 330) && hb > 100 && hb < 190 || (hb < 50 || hb > 330) && ha > 100 && ha < 190;
        pairs.push({ a: { colour: a.hex, uses: [...a.roles].join("/"), count: a.count, sample: a.sample, text: a.text }, b: { colour: b.hex, uses: [...b.roles].join("/"), count: b.count, sample: b.sample, text: b.text }, seenAs: name, distanceNormal: Math.round(normal), distanceSimulated: Math.round(sim), redGreen });
        break;
      }
    }
  }
  pairs.sort((x, y) => (y.a.count + y.b.count) - (x.a.count + x.b.count));
  return { coloursChecked: list.length, pairs: pairs.slice(0, 10), pairsMore: Math.max(0, pairs.length - 10), method: "Machado 2009 simulation in linear RGB, CIE Lab distance. A pair is listed when it is 25 or more apart for normal vision and under 12 apart under deuteranopia or protanopia, or 40 or more apart and keeps under 30% of that distance (under 30). At least one colour is saturated. Colours that differ in lightness stay easier to tell apart than the distance shows." };
}

// ---- measuring in the page -----------------------------------------------------------------------

function measureInPage({ tapMin }) {
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (c) => {
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const out = d[3] === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], d[3] / 255];
    cache.set(c, out); return out;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a); };
  const sel = (e) => { const p = []; for (let n = 0; e && n < 3 && e.nodeType === 1 && e !== document.documentElement; n++, e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "")); return p.join(" > "); };
  const rect = (r) => `${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  const visible = (el, s, r) => s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0;
  const els = [...document.body.querySelectorAll("*")].slice(0, 6000);
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD", "BR", "PATH", "G", "DEFS"]);

  const wide = [], clipped = [], tap = [], noSize = [], broken = [], contrast = new Map(), colours = new Map();
  let checked = 0, fadedSkipped = 0;
  const hasClipAncestor = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const r = p.getBoundingClientRect(); if (r.right <= vw + 1) return true; } if (s.position === "fixed") return false; } return false; };
  const addColour = (c, role, el, text) => {
    if (c[3] < 0.5) return;
    const k = c.slice(0, 3).map(Math.round).join(",");
    const e = colours.get(k);
    if (e) e.count++; else colours.set(k, { rgb: c.slice(0, 3).map(Math.round), role, count: 1, sample: sel(el), text: text ? text.slice(0, 40) : undefined });
  };
  const bodyFg = rgba(getComputedStyle(document.body).color);

  for (const el of els) {
    if (skip.has(el.tagName)) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!visible(el, s, r)) continue;
    const isSvgChild = el instanceof SVGElement && el.tagName.toLowerCase() !== "svg";

    if (s.position !== "fixed" && r.right > vw + 1 && !hasClipAncestor(el)) wide.push({ selector: sel(el), box: rect(r), overshoot: Math.round(r.right - vw), text: (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || undefined });

    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    if (own && !isSvgChild) {
      if (/(hidden|clip)/.test(s.overflowX + s.overflowY) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        clipped.push({ selector: sel(el), box: rect(r), kind: s.webkitLineClamp && s.webkitLineClamp !== "none" ? "line-clamp" : s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth ? "ellipsis" : "cut", scroll: `${el.scrollWidth}x${el.scrollHeight}`, shown: `${el.clientWidth}x${el.clientHeight}`, text: own.slice(0, 50) });
      }
      // contrast
      checked++;
      let fg = rgba(s.color), unknown = false;
      let op = 1;
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
        const ps = getComputedStyle(p);
        op *= Number(ps.opacity);
        if (ps.backgroundImage !== "none") { unknown = true; break; }
      }
      // Background: fold the ancestors' colours from the farthest to the nearest, on white.
      const chain = [];
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) chain.push(rgba(getComputedStyle(p).backgroundColor));
      let bg = [255, 255, 255, 1];
      for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg);
      fg = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
      if (op < 0.9) fadedSkipped++;
      else if (!unknown) {
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
        const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
        if (ratio < need && !(el.closest("[disabled],[aria-disabled=true]"))) {
          const k = [fg, bg].map((c) => c.slice(0, 3).map(Math.round).join(",")).join("|") + "|" + need;
          const e = contrast.get(k) ?? { fg: "#" + fg.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), background: "#" + bg.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), ratio: Math.round(ratio * 100) / 100, needed: need, count: 0, sample: sel(el), text: own.slice(0, 50) };
          e.count++; contrast.set(k, e);
        }
      }
      // colours that may carry meaning: text colour that differs from the body text
      if (Math.abs(lum(fg) - lum(bodyFg)) > 0.02 || fg.slice(0, 3).join() !== bodyFg.slice(0, 3).join()) addColour(fg, "text", el, own);
    }
    // fills of small elements (badges, dots, bars, cells) and borders
    const bgc = rgba(s.backgroundColor);
    if (bgc[3] >= 0.5 && r.width * r.height < 40000 && r.width > 0) addColour(bgc, "fill", el, own);
    const bw = parseFloat(s.borderTopWidth) || parseFloat(s.borderLeftWidth);
    if (bw >= 1 && s.borderTopStyle !== "none") addColour(rgba(s.borderTopColor), "border", el, own);
    if (isSvgChild || el.tagName.toLowerCase() === "svg") {
      for (const prop of ["fill", "stroke"]) { const v = s[prop]; if (v && v !== "none" && !v.startsWith("url")) addColour(rgba(v), prop, el, ""); }
    }

    // tap targets
    const tag = el.tagName;
    const interactive = tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && el.type !== "hidden") || tag === "SUMMARY" || el.getAttribute("role") === "button" || (tag === "A" && el.hasAttribute("href"));
    if (interactive && !el.disabled) {
      const inline = tag === "A" && s.display === "inline" && el.parentElement && (el.parentElement.innerText ?? "").length > (el.innerText ?? "").length + 20;
      if (!inline && (r.width < tapMin || r.height < tapMin)) tap.push({ selector: sel(el), box: rect(r), text: (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 30) });
    }

    if (tag === "IMG") {
      const done = el.complete && el.naturalWidth > 0;
      if (!done && !(el.loading === "lazy" && !el.complete)) broken.push({ src: (el.currentSrc || el.src || "").slice(0, 160), alt: el.getAttribute("alt"), shown: `${Math.round(r.width)}x${Math.round(r.height)}` });
      else if (!el.hasAttribute("width") && !el.hasAttribute("height") && s.aspectRatio === "auto" && !el.closest("picture source") && !/px|%|em|rem|vw/.test(el.style.height + el.style.width)) noSize.push({ src: (el.currentSrc || el.src || "").slice(0, 160), shown: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
  }
  const sortBy = (a, f) => a.sort((x, y) => f(y) - f(x));
  wide.sort((a, b) => b.overshoot - a.overshoot);
  const groups = sortBy([...contrast.values()], (e) => e.count);
  const failing = groups.reduce((n, g) => n + g.count, 0);
  return {
    viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, overflowX: document.documentElement.scrollWidth > vw + 1, documentHeight: document.documentElement.scrollHeight,
    wide: wide.slice(0, 12), widePlus: wide.length,
    clipped: { count: clipped.length, examples: clipped.slice(0, 10) },
    imagesBroken: { count: broken.length, examples: broken.slice(0, 8) },
    imagesNoSize: { count: noSize.length, examples: noSize.slice(0, 5) },
    tapTargets: { minimum: tapMin, count: tap.length, examples: tap.slice(0, 12) },
    contrast: { checked, failing, groups: groups.slice(0, 10), skippedFaded: fadedSkipped, note: "text over a background image or gradient, and text inside an element that is partly transparent (a fade-in, for example), is not measured" },
    colours: [...colours.values()],
    elementsLooked: els.length,
  };
}
