export const meta = {
  purpose:
    "Load a URL in a headless browser and say whether it rendered: status and final URL, title, how much visible text, the first headings and lines of text, console errors, uncaught page errors, failed requests and images that did not load, with a plain-word list of problems. The first thing to run for any question about a page.",
  params: {
    url: "the page, e.g. http://127.0.0.1:3000/ (https://, or host:port which gets http://)",
    width: "viewport width in px, default 1280",
    wait: '"load" (default), "domcontentloaded" or "networkidle"',
    timeoutMs: "page load limit, default 30000",
    textLimit: "characters of visible text to return, default 600; the full text is in the open call",
  },
  returns: "{url, finalUrl, status, rendered, problems:[...], title, textLength, text, headings, console:{errors,warnings,first}, pageErrors, failedRequests, badResponses (short strings, at most 5 each), imagesNotLoaded, links, forms and buttons (counts), timing}",
  example: 'await scripts.run("check", { url: "http://127.0.0.1:3000/" })',
};

export const toUrl = (u) => {
  if (!u) throw new Error('give a url, for example scripts.run("check", { url: "http://127.0.0.1:3000/" })');
  const s = String(u).trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(s) ? "http://" + s : "https://" + s;
};

export default async function ({ browser }, { url, width, wait, timeoutMs, textLimit = 600 } = {}) {
  const r = await browser.open(toUrl(url), { width, wait, timeoutMs, textLimit: Math.max(200, Number(textLimit) || 600) });
  return {
    url: r.url, finalUrl: r.finalUrl, redirected: r.redirected, status: r.status, rendered: r.rendered, loadError: r.loadError,
    problems: r.problems,
    title: r.title, textLength: r.textLength, text: r.text, textCut: r.textCut,
    headings: r.headings.slice(0, 5).map((h) => `h${h.level} ${h.text}`), roots: r.roots,
    console: { errors: r.console.errors, warnings: r.console.warnings, first: r.console.first.slice(0, 5).map((m) => `${m.type}${m.count > 1 ? ` x${m.count}` : ""}: ${m.text}${m.source ? ` (${m.source})` : ""}`) },
    pageErrors: r.pageErrors.slice(0, 5).map((e) => `${e.message}${e.stack ? ` (${e.stack})` : ""}`),
    failedRequests: r.failedRequests.slice(0, 5).map((f) => `${f.method} ${f.url}: ${f.failure}`), badResponses: r.badResponses.slice(0, 5).map((f) => `${f.status} ${f.method} ${f.url} (${f.type})`),
    slowRequests: r.slowRequests.slice(0, 3),
    imagesNotLoaded: r.imagesNotLoaded, images: r.images.length + r.imagesMore, links: r.links.length + r.linksMore, forms: r.forms.length, buttons: r.buttons.length + r.buttonsMore,
    requests: r.requests, blockedRequests: r.blockedRequests, timing: r.timing,
  };
}
