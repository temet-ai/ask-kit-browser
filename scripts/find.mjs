export const meta = {
  purpose:
    "Whether a text or an element is on a page, whether it is visible, and where: its tag, selector path, whether it is in the first screen, its box in page pixels, the text around it, and why it is hidden when it is.",
  params: {
    url: "the page",
    text: "a text to look for (substring, ignoring case)",
    selector: "a CSS or Playwright selector instead of text",
    exact: "true to match the whole text of an element",
    width: "viewport width, default 1280",
    steps: "optional steps to run first (click a tab, then look)",
  },
  returns: "{url, status, query, found, count, visibleCount, inSourceText, matches:[{tag, selector, visible, inViewport, hiddenBy, box:{x,y,width,height}, text, around, disabled, href}]}",
  example: 'await scripts.run("find", { url: "http://127.0.0.1:3000/", text: "Sign in" })',
};
import { toUrl } from "./check.mjs";

export default async function ({ browser }, { url, text, selector, exact, width, steps, timeoutMs } = {}) {
  if (!text && !selector) throw new Error('give text or selector, for example scripts.run("find", { url, text: "Sign in" })');
  return browser.find(toUrl(url), { text, selector, exact, width, steps, timeoutMs });
}
