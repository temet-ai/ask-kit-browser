# ask-kit-browser

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool say what a
web page does when a real browser loads it. A cheap model drives a headless Chromium outside your agent's
context and answers with the status, the errors with their file and line, measurements, and the paths of
screenshots it saved. It is for pages a session built or is debugging: a local dev server, a preview, a
deployed page.

Questions from its bench, of the kinds agents had answered by hand with Playwright and claude-in-chrome:

- Does https://temet.ai/ load without console errors or failed requests? Which ones happen, and from where?
- At a 390 px phone width, does https://temet-ai.github.io/ask-kit/ scroll sideways, and which image has no size?
- Check https://temet.ai/ for colour pairs that are hard to tell apart with red-green colour blindness.

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up), Node, and a Node `playwright` package
with a Chromium build: `mise use -g npm:playwright` installs the package, and `playwright install chromium`
the browser (the kit also uses `/usr/bin/chromium` or Google Chrome when no Playwright build exists). The kit
finds the package under mise's `npm-playwright` installs or the global `node_modules`; the `PLAYWRIGHT_MODULE`
setting overrides that. Nothing is installed for you.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-browser
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-browser        # shows what it reaches, changes and runs
ask-kit kit install temet-ai/ask-kit-browser --yes  # installs and enables it
```

Restart your agents so `ask` lists `browser`.

## What it carries

| | |
|---|---|
| Scripts | `check` (did the page load and render: status, title, text, errors, problems in plain words), `errors` (console errors and warnings with file:line, uncaught page errors, failed and slow requests, each once with a count), `layout` (at 390 and 1440 px: overflow, clipped text, images with no size, small tap targets, contrast, colour pairs that red-green colour blindness merges), `shot` (screenshots saved as PNG files, optionally as deuteranopia or protanopia shows them), `find` (is a text or selector on the page, visible, and where), `flow` (click, type, press, scroll, then what each step changed) |
| Skills | `after-a-change`, `blank-page`, `colour-blind`, `walk-a-flow`: playbooks the investigator loads when the job calls for one |
| Roles | `page-checker` for whether a page works or renders; `visual-reviewer` for how it fits and looks, which reports measurements and screenshot paths |

Each script also runs with no model: `ask-kit run browser check url=http://127.0.0.1:3000/`, or
`ask(do: "browser.check", params: { url })` from an agent.

The colour check simulates deuteranopia and protanopia (Machado 2009) and lists pairs of colours, from text,
fills, borders and SVG shapes, that are far apart for normal vision and close under the simulation. It measures
colours; it does not know whether a pair carries meaning. Layout checks measure; none of them can see the page.
A screenshot comes back as a file path, for someone who can look at the image.

## What it can change

The browser is a fresh headless Chromium with an empty temporary profile for every call, deleted afterwards.
It does not use your Chrome, your profiles, your cookies or your logins, and no call can pass cookies,
headers or credentials in. A page that needs a login shows its login screen; for the logged-in page the calling
session's own browser tools are needed.

A question can open pages, scroll, hover, click links and buttons, and type into fields on a local host
(`localhost`, `127.x`). These need the ask to act (`act: true`):

- a click on a button that submits a form, and Enter in a form field;
- typing into a password field;
- typing into any field of a page on a host that is not local;
- after the first load, any request other than GET that a step causes (it is blocked and listed in
  `blockedRequests`).

Screenshots are the one file the kit writes: into the ask-kit state folder (`browser-shots`), or to a `.png`
path the caller gives; a path that holds a file that is not a PNG is refused. Only `http` and `https` pages
are opened: not `file:`, not `data:`, not link-local addresses such as 169.254.169.254, and not URLs with a
user name or password. Tokens and keys in reported URLs are masked. A script run as a shot (`ask-kit run`,
or `ask(do: ...)`) counts as the caller asking for that exact call, so it acts unless `act: false` is passed.

Every browser is closed when its call ends and killed when its time runs out (30 s per page by default,
`timeoutMs` to change it; the whole call is limited to twice that plus 20 s plus 8 s per step).

## How well it works

`bench/questions.json` holds seven questions and two script runs, each with patterns its answer must hold.
It has not been run on a model yet; `ask-kit kit test browser` runs it. The scripts have been run, with no
model, on a small page with deliberate faults, on `https://temet-ai.github.io/ask-kit/`,
`https://temet.ai/` and a local Next.js dev server.
