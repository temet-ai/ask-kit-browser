export const meta = {
  purpose:
    "Measured layout faults at one or more widths (default a 390 px phone and a 1440 px desktop): horizontal overflow and the elements that reach past the edge, clipped text, broken images, images with no size, tap targets that are too small, text below the WCAG contrast ratio, and colour pairs that red-green colour blindness (deuteranopia, protanopia) makes hard to tell apart. It measures; it cannot judge the look.",
  params: {
    url: "the page",
    widths: "list of widths, e.g. [390, 768, 1440] (or \"390,1440\"); default [390, 1440]",
    tapMin: "smallest tap target in px; default 44 at 768 wide or less, 24 above",
    steps: "optional steps to run before measuring (open a menu, switch a tab)",
    timeoutMs: "page load limit, default 30000",
  },
  returns: "{url, widths:[{width, status, problems:[...], scrollWidth, wide, clipped, imagesBroken, imagesNoSize, tapTargets, contrast, colourPairs}]}; each list holds short strings, at most 3, then a (+N more) entry",
  example: 'await scripts.run("layout", { url: "http://127.0.0.1:3000/", widths: [390, 1440] })',
};
import { toUrl } from "./check.mjs";

const list = (w) => (Array.isArray(w) ? w : String(w ?? "390,1440").split(/[,\s]+/)).map(Number).filter((n) => n >= 200 && n <= 4000).slice(0, 5);

export default async function ({ browser }, { url, widths, tapMin, steps, timeoutMs } = {}) {
  const u = toUrl(url);
  const out = await Promise.all((list(widths).length ? list(widths) : [390, 1440]).map(async (width) => {
    const m = await browser.measure(u, { width, tapMin, steps, timeoutMs });
    if (m.error) return { width, loadError: m.loadError, error: m.error };
    const ex = (list, f, total = list.length, n = 3) => [...list.slice(0, n).map(f), ...(total > n ? [`(+${total - n} more)`] : [])];
    const side = (c) => `${c.colour} ${c.uses} ${c.sample}${c.text ? ` "${c.text}"` : ""}`;
    return {
      width, status: m.status, problems: m.problems, scrollWidth: m.scrollWidth,
      wide: ex(m.wide, (w) => `${w.selector} ${w.box}, ${w.overshoot}px past the edge`, m.widePlus),
      clipped: ex(m.clipped.examples, (e) => `${e.selector} ${e.box} ${e.kind}: "${e.text.slice(0, 30)}"`, m.clipped.count),
      imagesBroken: ex(m.imagesBroken.examples, (e) => e.src, m.imagesBroken.count),
      imagesNoSize: ex(m.imagesNoSize.examples, (e) => e.src, m.imagesNoSize.count),
      tapTargets: ex(m.tapTargets.examples, (e) => `${e.selector} ${e.box}${e.text ? ` "${e.text}"` : ""}`, m.tapTargets.count),
      contrast: ex(m.contrast.groups, (g) => `${g.fg} on ${g.background} = ${g.ratio}, needs ${g.needed}: ${g.count}x, e.g. ${g.sample} "${g.text.slice(0, 30)}"`, m.contrast.groups.length),
      colourPairs: ex(m.colourBlind.pairs, (p) => `${side(p.a)} vs ${side(p.b)}: ${p.distanceNormal} apart, ${p.distanceSimulated} under ${p.seenAs}${p.redGreen ? ", red-green" : ""}`, m.colourBlind.pairs.length + m.colourBlind.pairsMore),
    };
  }));
  return { url: u, widths: out, note: "These are measurements. Whether the page looks right is for someone who can see a screenshot (scripts.run(\"shot\"))." };
}
