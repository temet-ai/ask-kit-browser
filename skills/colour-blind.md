Check a page for red-green colour-blind safety (red-green colour blindness is the most common kind)

1. `const l = await scripts.run("layout", { url, widths: [1440] })` and read `l.widths[0].colourBlind`. Each pair has the two
   colours, what each is used for (`text`, `fill`, `border`, `stroke`), the selector it was seen on, its distance for normal
   vision and its distance simulated (`distanceSimulated`), and `redGreen: true` when one is a red and the other a green.
2. Report every pair with `redGreen: true` first, then the others. For each give the selectors, the two hex colours, and
   what the elements say (`text`). A status, a chart series, a heat-map cell or an alert is a pair where colour carries meaning.
   A button colour that appears once on its own does not.
3. Check that meaning is repeated in something else. For the elements of a pair, `browser.find(url, { selector })` shows the
   text and box; a coloured badge that says only a colour name or nothing at all is a risk; one that says "Failed" or "Passed" is
   not. An outline or a coloured border as the only marker of state is a risk.
4. Take the simulated screenshots: `await scripts.run("shot", { url, widths: [1440], fullPage: true, simulate: "deuteranopia" })`
   and again with `"protanopia"`, and give the paths. You cannot look at them. A reviewer who can see images compares them with
   the normal screenshot.
5. Contrast is separate: `layout` also lists text below the WCAG ratio; report it apart from colour pairs.
6. A colour-blind-safe scale is one hue changing in lightness, or blue to orange, with the meaning also in shape, position,
   weight or text. Say which of those the page already uses, from what you measured; do not recommend a palette from a guess.
7. The answer: the pairs at risk with selectors and colours, what already carries the meaning without colour, the screenshot
   paths, and that the simulation is a calculation (Machado 2009) that a person should confirm on the images.
