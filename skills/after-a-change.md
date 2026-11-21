Check a page after a change: errors first, then layout at phone and desktop width, then screenshot paths for the caller to look at

1. `const c = await scripts.run("check", { url })`. If `c.loadError` is set or `c.status` is not 200 (a redirect to a login page
   shows as `redirected: true` with another `finalUrl`), stop and report that: nothing else is worth measuring on a page that
   did not load. A dev server that refuses the connection is down; say so, do not start it.
2. If `c.rendered` is false, `skills.read("blank-page")`.
3. `const e = await scripts.run("errors", { url })`. List every console error, page error and failed request with its
   `source` file:line, once each. Warnings only when there are few.
4. `const l = await scripts.run("layout", { url, widths: [390, 1440] })`. For each width give `problems` as they are, with the
   selectors of the worst elements. A phone width with `overflowX: true` names the element that causes it in `wide[0]`.
5. `const s = await scripts.run("shot", { url, widths: [390, 1440] })` and give the file paths. Say that you measured the page
   and did not look at the images, and that a reviewer who can see them judges the look.
6. If the change is about colour (a status, a chart, a badge), also run `skills.read("colour-blind")`.
7. The answer: working or not, then the faults grouped as errors, layout, colour, each with its evidence, then the paths.
   Say plainly when a step found nothing ("no console errors, no overflow at 390 or 1440").

When the caller names a part of the page ("the settings panel"), run `find` for it first, so you know it is there and where, and
run `layout` after `steps` that open it.
