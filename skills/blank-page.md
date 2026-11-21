Find out why a page is blank or white, or shows less than it should

1. `const r = await browser.open(url, { width: 1280 })`. Read, in this order:
   - `r.status` and `r.finalUrl`: a 404, a 500 or a redirect to somewhere else explains it. A dev server that is still
     compiling can answer slowly or with an error page: load once more before concluding.
   - `r.loadError`: "net::ERR_CONNECTION_REFUSED" means nothing listens on that port (the server is down or on another port).
     A certificate error needs `ignoreHttpsErrors: true` only for a local https dev server.
   - `r.pageErrors`: an uncaught error stops a script from rendering. Report the message and its first stack line.
   - `r.failedRequests` and `r.badResponses`: look first at `type` "script" and "stylesheet": a 404 on a JavaScript bundle
     or a CSS file is the usual cause of a page that loads but never starts. A `fetch` or `xhr` with 4xx or 5xx means the
     page started and its data did not arrive.
   - `r.roots`: an entry with `children: 0` (#root, #app, #__next) means the framework mounted nothing there.
   - `r.console.first`: a message with "hydrat" means server and client markup disagreed (Next.js and similar); one that says
     "Minified React error" or "Cannot read properties of undefined" is a render error. Quote it with its `source`.
   - `r.textLength` against what the page should show: `r.text` shows what is there.
2. If the page renders only after JavaScript, and `r.text` is short, run `await browser.open(url, { wait: "networkidle" })`
   and compare: a longer text means the content arrives late, not that it is missing.
3. If a dev error overlay is up (`problems` mentions a Next.js overlay), its text is in `r.text`: quote it.
4. `await browser.find(url, { text: "<a word the page should show>" })`: `inSourceText: true` with `found: false`
   or `visible: false` means the text is in the page but hidden (`hiddenBy` says how).
5. Cross-check with `scripts.run("errors", { url })` and report each distinct error once.
6. The answer: the first cause the evidence shows, the evidence (status, error text with file:line, failing URL), and what is
   not known. Do not say the code is wrong where you only saw that a request failed; say which request.
