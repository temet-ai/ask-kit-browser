// A real headless Chromium, driven through Playwright. Every call launches a new browser with an
// empty temporary profile (no cookies, no logins, none of the person's own Chrome) and closes it,
// and kills it if the call runs past its time limit. A call opens one page; a call with `steps`
// runs them on that page before it reports.
//
// Targets in steps and in find: a string is a Playwright selector ("#save", "button.primary",
// "text=Save", "a[href*=docs]"). A string that has a capital letter or a space and no selector
// characters is taken as text ("Save changes"). Or write {text: "Save"}, {role: "button", name: "Save"},
// {selector: "..."}. The first match is used.

interface Steps extends Array<
  | { click: string | { text?: string; role?: string; name?: string; selector?: string } }
  | { hover: string | { text?: string; selector?: string } }
  | { type: [string | { text?: string; selector?: string }, string] }   // [field, text]
  | { press: string }                                                    // "Escape", "Tab", "ArrowDown", "Enter"
  | { waitFor: string | { text?: string; selector?: string } }           // visible within 8 s
  | { scroll: "top" | "bottom" | number | string }                       // a number scrolls by that many px; a string is an element to scroll to
  | { wait: number }                                                     // ms, at most 5000
> {}

interface PageOptions {
  width?: number;        // viewport width in px, default 1280. 500 or less is emulated as a phone (touch, mobile viewport rules). Common: 390 phone, 768 tablet, 1440 desktop.
  height?: number;       // default 800 (844 for a phone)
  wait?: "load" | "domcontentloaded" | "networkidle" | "commit"; // default "load", then up to 2 s for the network to go quiet. A dev server with a live-reload socket never reaches "networkidle": leave the default.
  timeoutMs?: number;    // per page load, default 30000, at most 120000. The whole call is killed after twice this plus 20 s plus 8 s per step.
  scheme?: "light" | "dark"; // prefers-color-scheme, default light
  scale?: number;        // device pixel ratio, default 1
  steps?: Steps;         // up to 25, run after the load and before the report; one that fails stops the list
  ignoreHttpsErrors?: boolean;
}

interface StepResult {
  step: number; did: string; ok: boolean; error?: string; hint?: string;
  url: string; navigatedFrom?: string; title?: string;
  changed: boolean;                 // the visible text or the URL differs from before the step
  added?: string[]; removed?: string[]; moreAdded?: number; moreRemoved?: number; // visible text lines, at most 15 each
  newErrors?: number; newFailedRequests?: number;
}

interface Dedup { count: number }

declare const browser: {
  cwd: string;
  act: boolean; // true when this ask may change things (submit forms, type into password fields or into fields on a non-local host, send non-GET requests)

  // Which Playwright, which browser binary, where screenshots go.
  info(): { playwright: string; playwrightDir: string; executable: string; shotsFolder: string };

  // True for localhost, 127.x, ::1 and *.localhost URLs.
  isLocal(url: string): boolean;

  // Load a page and report it. The first call to make for any question about a page.
  // rendered: status below 400, some visible text, and no framework root (#root, #app, #__next) left empty.
  // problems: plain-word list of what is wrong (empty when nothing is). text is cut at textLimit (default 3000, at most 20000);
  // textCut says how much. Lists (links, buttons, images, headings) are capped and have a ...More count.
  // images[].loaded is false for a broken image (lazy images not yet in view are skipped in the problems). Tokens, keys and
  // user names in URLs are masked as ***. Failed requests exclude ones the browser aborted itself (navigations away, cancelled prefetches).
  open(url: string, o?: PageOptions & { textLimit?: number }): Promise<{
    url: string; finalUrl: string; redirected: boolean; redirects: { url: string }[];
    status: number | null; ok: boolean; loadError?: string; rendered: boolean; problems: string[];
    viewport: string; title: string; lang: string | null; description: string | null; viewportMeta: string | null;
    headings: { level: number; text: string }[]; headingsMore: number;
    text: string; textLength: number; textCut?: string;
    roots: { id: string; children: number; textLength: number }[];
    links: { text: string; href: string }[]; linksMore: number;
    forms: { action: string; method: string; visible: boolean; fields: { tag: string; type: string; name: string; label: string; required: boolean }[]; submit: string[] }[];
    buttons: { text: string; disabled: boolean }[]; buttonsMore: number;
    images: { src: string; alt: string | null; loaded: boolean; natural: string; shown: string; lazy: boolean }[]; imagesMore: number; imagesNotLoaded: number;
    console: { errors: number; warnings: number; first: { type: string; text: string; source: string | null; count: number }[] };
    pageErrors: { message: string; stack: string; count: number }[];
    failedRequests: { url: string; method: string; type: string; failure: string; count: number }[];
    badResponses: { url: string; method: string; status: number; type: string; count: number }[];
    slowRequests: { url: string; method: string; ms: number; type: string }[]; // finished after more than 1.5 s
    requests: number;
    blockedRequests: { url: string; method?: string; why: string }[];         // held back by the kit: not GET after the load without act, link-local addresses
    dialogs: { type: string; message: string }[]; popups: string[];            // alert/confirm dialogs are dismissed; popup windows are closed
    timing: { loadWaitedMs: number; domContentLoadedMs?: number; loadMs?: number; ttfbMs?: number };
    steps?: StepResult[];
  }>;

  // Only what went wrong during the load (and the steps): each distinct message once with its count (numbers in the text are folded together).
  // consoleErrors/consoleWarnings carry source = "file:line:col" where the browser gives one.
  errors(url: string, o?: PageOptions): Promise<{
    url: string; finalUrl: string; status: number | null; loadError?: string; requests: number;
    consoleErrors: (Dedup & { type: string; text: string; source: string | null })[];
    consoleWarnings: (Dedup & { type: string; text: string; source: string | null })[];
    pageErrors: (Dedup & { message: string; stack: string })[];
    failedRequests: (Dedup & { url: string; method: string; type: string; failure: string })[];
    badResponses: (Dedup & { url: string; method: string; status: number; type: string })[];
    slowRequests: { url: string; method: string; ms: number; type: string }[];
    blockedRequests: { url: string; method?: string; why: string }[]; dialogs: { type: string; message: string }[]; popups: string[];
    steps?: StepResult[];
  }>;

  // Layout faults measured at one width (call it again for another width, or use the `layout` script for several).
  // The page is scrolled through once first so lazy images load (fullScroll: false skips that).
  // wide: elements whose right edge is past the viewport, worst first (selector, box "x,y WxH" in page px, overshoot). overflowX is true when the page scrolls sideways.
  // clipped: text in a box with overflow hidden that is wider or taller than the box (kind "ellipsis" and "line-clamp" are deliberate truncation, "cut" is not).
  // imagesNoSize: images with no width/height attribute, no CSS size and no aspect-ratio (the page jumps as they load).
  // tapTargets: buttons, inputs and links smaller than tapMin px either way (default 44 at 768 wide or less, 24 above; links inside running text are skipped).
  // contrast: text below the WCAG ratio (4.5, or 3 for large text), grouped by colour pair; text over an image or gradient and text in a partly transparent element (a fade-in) is not measured (skippedFaded counts the latter).
  // colourBlind: pairs of colours (text, fills, borders, SVG fills) that are far apart for normal vision and close under deuteranopia or protanopia
  // (Machado 2009 simulation). redGreen marks a red-and-green pair. Report them as measurements: whether the pair carries meaning is for a person to judge.
  measure(url: string, o?: PageOptions & { tapMin?: number; fullScroll?: boolean }): Promise<{
    url: string; finalUrl: string; status: number | null; loadError?: string; width: number; height: number; viewportMeta: string | null;
    scrollWidth: number; clientWidth: number; overflowX: boolean; documentHeight: number;
    wide: { selector: string; box: string; overshoot: number; text?: string }[]; widePlus: number;
    clipped: { count: number; examples: { selector: string; box: string; kind: "ellipsis" | "line-clamp" | "cut"; scroll: string; shown: string; text: string }[] };
    imagesBroken: { count: number; examples: { src: string; alt: string | null; shown: string }[] };
    imagesNoSize: { count: number; examples: { src: string; shown: string }[] };
    tapTargets: { minimum: number; count: number; examples: { selector: string; box: string; text: string }[] };
    contrast: { checked: number; failing: number; skippedFaded: number; groups: { fg: string; background: string; ratio: number; needed: number; count: number; sample: string; text: string }[]; note: string };
    colourBlind: { coloursChecked: number; method: string; pairsMore: number;
      pairs: { a: { colour: string; uses: string; count: number; sample: string; text?: string }; b: { colour: string; uses: string; count: number; sample: string; text?: string };
        seenAs: "deuteranopia" | "protanopia"; distanceNormal: number; distanceSimulated: number; redGreen: boolean }[] };
    problems: string[]; elementsLooked: number; steps?: StepResult[];
  }>;

  // Screenshot saved to a PNG file; returns the path, never the image. path: where to write (must end in .png); left out, a file
  // under the ask-kit state folder (browser-shots). fullPage: the whole scrolling page. simulate: "deuteranopia" or "protanopia" draws
  // the page as red-green colour blindness shows it. Nothing here can judge how the image looks: pass the path to someone who can see it.
  screenshot(url: string, o?: PageOptions & { path?: string; fullPage?: boolean; simulate?: "deuteranopia" | "protanopia" }): Promise<{
    path: string; bytes: number; width: number; height: number; viewport: string; fullPage: boolean; simulate: string | null;
    status: number | null; loadError?: string; finalUrl: string; steps?: StepResult[]; note: string;
  }>;

  // Is a text or a selector on the page, is it visible, and where. text matches substrings, ignoring case, unless exact.
  // matches (at most max, default 5): tag, selector path, visible, inViewport, hiddenBy (display:none, visibility:hidden, opacity:0, zero size),
  // box in page coordinates, its text, the parent's text around it, href. inSourceText: the text is in the page's text content even
  // if hidden (text queries only).
  find(url: string, o: PageOptions & { text?: string; selector?: string; exact?: boolean; max?: number }): Promise<{
    url: string; finalUrl: string; status: number | null; loadError?: string; query: { text?: string; selector?: string; exact?: boolean };
    found: boolean; count: number; visibleCount: number; inSourceText?: boolean;
    matches: { tag: string; selector: string; visible: boolean; inViewport: boolean; hiddenBy?: string; box: { x: number; y: number; width: number; height: number }; text: string; around: string; disabled: boolean; href?: string }[];
    steps?: StepResult[];
  }>;

  // Run steps, then report the page (same result as open, with a shorter text). Each step's result says what changed.
  // Submitting a form, typing into a password field, typing into any field of a non-local page and pressing Enter in a form field
  // throw "not in this ask" unless the ask may act. After the load, a request that is not GET is blocked and listed in blockedRequests.
  flow(url: string, steps: Steps, o?: PageOptions & { textLimit?: number }): ReturnType<typeof browser.open>;
};
