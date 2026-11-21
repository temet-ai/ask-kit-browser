# Recipe: browser kit

## What it answers

What a web page does when a real headless browser loads it: whether it loads (status, final URL), what is
on it (title, headings, visible text, links, forms, buttons, images and whether each loaded), console
errors and warnings, uncaught page errors, failed and slow requests, whether a text or element is present
and visible, screenshots at a phone and a desktop width saved to files, measured layout faults (horizontal
overflow, clipped text, images with no size, small tap targets, contrast, colour pairs that red-green colour
blindness merges), and what a short list of steps (click, type, press, scroll) does.

## What it needs

- Node 22 or newer.
- A Node `playwright` or `playwright-core` package. `PLAYWRIGHT_MODULE` (a setting, detected under
  mise's `installs/npm-playwright/*/node_modules/playwright` and the global `node_modules`) holds its folder.
  The kit imports it by absolute path; it installs nothing.
- A Chromium: the newest build under `~/.cache/ms-playwright` (`chromium_headless_shell-*`, then
  `chromium-*`), else `/usr/bin/chromium`, `google-chrome-stable`. `BROWSER_EXECUTABLE` overrides.
  Playwright 1.65 asks for build 1254 and refuses to launch another one by itself, so the module passes
  `executablePath` explicitly.
- `pkill` (procps), used to end a browser that does not close.

## What it reads and runs

- Launches Chromium headless through `launchPersistentContext` with a new `mkdtemp` profile folder per
  call, closes it in a `finally`, runs `pkill -9 -f <profile folder>` and deletes the folder. A timer
  kills the browser when the call passes its limit.
- No cookies, headers, storage state or credentials can be passed in. Service workers are blocked,
  downloads and permissions are refused, popups are closed, dialogs are dismissed.
- Opens `http` and `https` only; refuses `file:`, `data:`, link-local and metadata addresses and URLs
  with a user name or password. Masks `token`, `key`, `password` style query values in reported URLs.
- Refuses, unless the ask may act: a click on a submit button, Enter in a form field, typing in a password
  field, typing in a field of a non-local host, and (through a route handler) any non-GET request after
  the first load. `acts` is written as prose because the host cannot tell these calls from reading ones.
- Writes screenshots as PNG files to `$ASK_KIT_STATE/browser-shots`, or to a caller-given `.png` path.

## Rebuild it from an empty folder

Write `ask-kit.toml` with one `module` source named `browser` and two settings (`PLAYWRIGHT_MODULE`,
required, with a Node one-line `detect`; `BROWSER_EXECUTABLE`). The module exports
`make({settings, push, cwd, act})` returning `browser` with: `info()`, `isLocal(url)`, `open(url, o)`,
`errors(url, o)`, `measure(url, o)`, `screenshot(url, o)`, `find(url, o)` and `flow(url, steps, o)`. Each
call goes through one helper that launches the browser, runs the work against a timer, and always closes
and kills it. `open` returns the page report with `rendered` and a `problems` list in plain words.
`measure` runs one function in the page that reads computed styles for contrast (compositing background
colours from the farthest ancestor), tap target sizes, clipped text, images and overflow, and collects
colours; the colour-blind pairs are computed in Node with the Machado 2009 matrices in linear RGB and
CIE Lab distance. `screenshot` with `simulate` adds an SVG `feColorMatrix` filter to the page first.
Steps take a Playwright selector string, `{text}` or `{role, name}`.

Scripts, each returning short strings and capped lists because a shot is cut at 4000 characters: `check`,
`errors`, `layout`, `shot`, `find`, `flow`. Skills in `skills/`: after-a-change, blank-page, colour-blind,
walk-a-flow. Roles in `roles/`: page-checker, visual-reviewer. `instructions.md`: start from a script,
report status and `rendered` first, quote the browser's own messages with file:line, say that measuring
is not seeing, and say that the logged-in page needs the calling session's own browser tools.

## Bench

`bench/questions.json`: seven questions of the kinds sessions answered by hand in November 2026, put to
`https://temet-ai.github.io/ask-kit/` and `https://temet.ai/`, and two script runs.
