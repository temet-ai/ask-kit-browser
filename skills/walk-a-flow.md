Walk a short flow on a page (click, type, press) and report what each step does

1. Look before you click: `await scripts.run("find", { url, text: "<the button or link text>" })`. Use its `selector` for the
   step when the text is not unique. `matches[0].visible` must be true; if it is hidden, `hiddenBy` says why and a step that
   opens it may be needed first.
2. Write the steps in order: `[{ click: "text=Open" }, { waitFor: { text: "Settings" } }, { type: ["input[name=q]", "hello"] }, { press: "Escape" }]`.
   A `waitFor` after a click that loads something makes the next step wait for it.
3. `await scripts.run("flow", { url, steps })`. Read each step: `ok`, `error` and `hint` when it failed, `changed`, the text lines
   `added` and `removed`, `url` and `navigatedFrom` when it moved to another page, `newErrors` and `newFailedRequests`.
4. A step with `changed: false` did nothing visible. Say so, and check `find` on the element: it may be disabled
   (`disabled: true`), covered, or wired to something that failed (`newErrors`).
5. Held back: a submit button, Enter in a form field, a password field, any field on a non-local host, and any request that is not
   GET. The step throws "not in this ask". Report what you reached and that the rest needs act. With act, a form submit sends a real
   request to that server: do exactly the steps the request names, with exactly the values it gives.
6. After a navigation, run `scripts.run("check", { url: <the new url> })` for the page the flow ended on only if the question
   asks about it.
7. The answer: step by step, what each did, then where the flow ended (URL, title, the visible text that matters) and any errors
   it caused with their file:line.
