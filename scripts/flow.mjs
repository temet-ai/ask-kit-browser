export const meta = {
  purpose:
    "Run a short list of steps on a page (click, type, press a key, wait for something, scroll) and report what each step changed: the lines of visible text added and removed, the URL, the title, new console errors and failed requests; then the page as it stands. Submitting a form, typing in a password field and typing in any field of a non-local page need the ask to act.",
  params: {
    url: "the page",
    steps: 'list of steps: {click: "text=Save"}, {click: "#menu"}, {type: ["input[name=q]", "hello"]}, {press: "Escape"}, {waitFor: {text: "Done"}}, {scroll: "bottom"}, {wait: 500}; a string with a capital letter or a space is read as text',
    width: "viewport width, default 1280",
    textLimit: "characters of the final page text, default 800",
  },
  returns: "{url, finalUrl, status, steps:[{step, did, ok, error, changed, added, removed, url, newErrors}], problems, title, text, console, pageErrors, failedRequests, blockedRequests}",
  example: 'await scripts.run("flow", { url: "http://127.0.0.1:3000/", steps: [{ click: "text=Press me" }] })',
};
import { toUrl } from "./check.mjs";

export default async function ({ browser }, { url, steps, width, textLimit = 800, timeoutMs } = {}) {
  let s = steps;
  if (typeof s === "string") s = JSON.parse(s);
  if (!Array.isArray(s) || !s.length) throw new Error('give steps, for example [{ click: "text=Save" }]');
  const r = await browser.flow(toUrl(url), s, { width, textLimit: Number(textLimit) || 800, timeoutMs });
  return {
    url: r.url, finalUrl: r.finalUrl, status: r.status, loadError: r.loadError, steps: r.steps, problems: r.problems, title: r.title, text: r.text, textCut: r.textCut,
    console: r.console, pageErrors: r.pageErrors, failedRequests: r.failedRequests, badResponses: r.badResponses, blockedRequests: r.blockedRequests, dialogs: r.dialogs, popups: r.popups,
  };
}
