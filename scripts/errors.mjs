export const meta = {
  purpose:
    "Only what went wrong while a page loaded: console errors and warnings (with file:line:col where the browser gives one), uncaught page errors with their stack, failed requests and responses with status 400 or more, and slow requests. Each distinct message once, with a count.",
  params: {
    url: "the page",
    width: "viewport width in px, default 1280",
    steps: "optional steps to run first, e.g. [{click: \"text=Open\"}], to catch errors a click causes",
    timeoutMs: "page load limit, default 30000",
  },
  returns: "{url, finalUrl, status, clean, summary, consoleErrors, consoleWarnings, pageErrors, failedRequests, badResponses, slowRequests, blockedRequests} (each list capped at 15 with a ...More count)",
  example: 'await scripts.run("errors", { url: "http://127.0.0.1:3000/kits/" })',
};
import { toUrl } from "./check.mjs";

export default async function ({ browser }, { url, width, steps, timeoutMs } = {}) {
  const r = await browser.errors(toUrl(url), { width, steps, timeoutMs });
  const cap = (a) => ({ items: a.slice(0, 15), more: Math.max(0, a.length - 15) });
  const lists = { consoleErrors: r.consoleErrors, consoleWarnings: r.consoleWarnings, pageErrors: r.pageErrors, failedRequests: r.failedRequests, badResponses: r.badResponses };
  const n = (a) => a.reduce((s, x) => s + x.count, 0);
  const summary = Object.entries(lists).map(([k, v]) => `${n(v)} ${k}`).join(", ");
  const clean = !r.loadError && Object.values(lists).every((v) => v.length === 0);
  return {
    url: r.url, finalUrl: r.finalUrl, status: r.status, loadError: r.loadError, clean, summary,
    ...Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, cap(v)])),
    slowRequests: r.slowRequests, blockedRequests: r.blockedRequests, steps: r.steps,
  };
}
