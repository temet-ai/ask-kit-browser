export const meta = {
  purpose:
    "Screenshots of a page at one or more widths (default 390 and 1440), each saved as a PNG file; the paths come back, never the image. With simulate it draws the page as deuteranopia or protanopia shows it. Someone who can see images has to look at the files.",
  params: {
    url: "the page",
    widths: "list of widths, default [390, 1440]",
    fullPage: "true for the whole scrolling page, default false (the first screen)",
    simulate: '"deuteranopia" or "protanopia" (red-green colour blindness), default none',
    dir: "folder to write into, default the ask-kit state folder (browser-shots)",
    steps: "optional steps to run before the shot",
    timeoutMs: "page load limit, default 30000",
  },
  returns: "{url, shots:[{width, path, bytes, imageWidth, imageHeight, fullPage, simulate, status}]}",
  example: 'await scripts.run("shot", { url: "http://127.0.0.1:3000/", fullPage: true, simulate: "deuteranopia" })',
};
import { toUrl } from "./check.mjs";

export default async function ({ browser }, { url, widths, fullPage = false, simulate, dir, steps, timeoutMs } = {}) {
  const u = toUrl(url);
  const ws = (Array.isArray(widths) ? widths : String(widths ?? "390,1440").split(/[,\s]+/)).map(Number).filter((n) => n >= 200 && n <= 4000).slice(0, 4);
  const host = new URL(u).host.replace(/[^a-z0-9.-]+/gi, "_");
  const shots = [];
  for (const width of ws.length ? ws : [390, 1440]) {
    const path = dir ? `${String(dir).replace(/\/$/, "")}/${host}-${width}${fullPage ? "-full" : ""}${simulate ? "-" + simulate : ""}.png` : undefined;
    const r = await browser.screenshot(u, { width, fullPage: !!fullPage, simulate, path, steps, timeoutMs });
    shots.push({ width, path: r.path, bytes: r.bytes, imageWidth: r.width, imageHeight: r.height, fullPage: r.fullPage, simulate: r.simulate, status: r.status, loadError: r.loadError });
  }
  return { url: u, shots, note: "image files: look at them with a tool that can see images; this script measures nothing about how they look" };
}
