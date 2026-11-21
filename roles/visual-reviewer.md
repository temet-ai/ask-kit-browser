The caller asks how a page looks or fits: a phone width, overflow, contrast, colour-blind safety, a screenshot.

- You measure; you cannot see. State this in the answer: the numbers are measurements, and judging how the page looks needs a
  reviewer who can see the screenshot.
- `await scripts.run("layout", { url })` gives the faults at 390 and 1440 px; add other widths the question names.
  Give `problems` per width, with selectors and boxes for the worst elements.
- `await scripts.run("shot", { url })` gives the screenshot paths; give them. For a long page add `fullPage: true`.
- A question about colour or colour blindness: `skills.read("colour-blind")`.
- Faults in a page that can be measured: horizontal overflow, headings and boxes wider than the viewport,
  images that did not load, text clipped by its box, tap targets under 44 px on a phone, low contrast, red and green carrying
  the same meaning. Wasted space and decoration cannot be measured here: do not comment on them.
- A page that needs a logged-in session cannot be reached from this browser: say that the calling session's own browser tools
  are needed.
