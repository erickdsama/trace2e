---
description: Replay a recorded trace2e flow with Playwright to reproduce and diagnose a reported problem
argument-hint: "<problem description> [flow: <trace name or id>]"
allowed-tools: mcp__trace2e__list_traces, mcp__trace2e__get_trace, mcp__trace2e__get_screenshots, Read, Write, Edit, Bash, Grep, Glob
---

You are in **debug mode**: a user reported a problem, and a trace2e recording captures the
exact path they followed. Your job is to **replay that path with Playwright, observe what
breaks, and diagnose the root cause** — not to write test suites.

## Input

**$ARGUMENTS** = the problem description, optionally ending with `flow: <name-or-id>`.

1. Extract the problem description and (if present) the flow reference.
2. Call `list_traces`. Pick the trace: the referenced one, else the best name-match for the
   problem (e.g. "checkout fails" → a `checkout*` flow), else the newest. Say which trace
   you chose and why before replaying.
3. Call `get_trace` for the full steps and `get_screenshots` — the screenshots show what the
   page looked like when it *worked* (or when the user hit the bug); compare against them.

## Replay strategy

Write a **throwaway replay script** (`.trace2e-debug/replay.mjs` — add the dir to
`.gitignore` if missing) using the `playwright` library (not `@playwright/test`), then run
it with `node`. If Playwright isn't installed, `npm i -D playwright` and
`npx playwright install chromium` first.

The script must:

1. Launch chromium (headless), context with the trace's `viewport`, then `page.goto(startUrl)`.
2. **Instrument everything before the first step:**
   ```js
   const findings = [];
   const note = (type, detail) => findings.push({ step: current, type, detail, ts: Date.now() });
   page.on("console", m => { if (["error","warning"].includes(m.type())) note("console." + m.type(), m.text()); });
   page.on("pageerror", e => note("pageerror", e.message));
   page.on("requestfailed", r => note("requestfailed", `${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
   page.on("response", async r => { if (r.status() >= 400) note("http." + r.status(), `${r.request().method()} ${r.url()}`); });
   ```
3. **Execute the trace's steps in order**, mapping them exactly as recorded:
   - `navigate` → `page.goto(url)` · `click` → `page.<target.primary>.click()` ·
     `fill` → `.fill(value)` · `press` → `.press(key)` · `select` → `.selectOption(value)` ·
     `waitFor` → `expect`-less `locator.waitFor({state})` or `page.waitForURL(url)` ·
     `assert` → check and record a finding on mismatch (do NOT throw) · `delay` →
     `page.waitForTimeout(ms)` · `customJs` → `page.evaluate(code)` · `hook` → skip
     (test-context only) but tell the user it was skipped.
   - `target.primary` / `fallbacks` are Playwright locator expressions — try `primary`,
     fall back on the first fallback that resolves, and record a finding when the primary
     didn't resolve (that alone is a diagnosis: the UI changed).
   - Wrap each step in try/catch: on failure, screenshot `.trace2e-debug/step-<n>-fail.png`,
     record the finding, and stop the replay (later steps depend on this one).
4. After each step: screenshot to `.trace2e-debug/step-<n>.png` and record the current URL.
5. Print `findings` as JSON at the end, always — even when every step passed.

**Variables:** traces never contain secret values — `fill` steps carry `variableRef`
(`{{PASSWORD}}` style). Resolve each from `.env` / `process.env` if present; otherwise ask
the user for the value (or whether to use a test account) **before** running. Never print
resolved secret values, and never write them into the replay script — read them from env.

## Diagnosis

Run the replay, then correlate:

1. **Where** did the path break? The failing step index + what the user was doing there.
2. **What** does the evidence say? Match findings to the reported problem:
   - `http.4xx/5xx` on an API the step triggered → backend/contract issue; show method,
     URL, status, and (re-run with a response-body capture for that URL if needed) payload.
   - `pageerror` / `console.error` right after a step → frontend exception; grep the
     project source (`Grep`) for the error message to locate the code.
   - Primary locator didn't resolve → UI drift: compare the step screenshot against the
     recorded one from `get_screenshots` and name what changed.
   - Assert mismatch with no errors → data/state problem; report expected vs actual.
   - Only reproducible with a `delay` removed/shortened → race condition; say what must be
     awaited.
3. If the problem did **not** reproduce, say so plainly and list what differed from the
   user's run (environment, data, account state, viewport) as concrete follow-ups — do not
   invent a diagnosis.

## Output

A short report, in this order:
- **Reproduced: yes/no** — failing step `<n>` (`<step description>`), page URL at failure.
- **Evidence** — the relevant findings (console/network/pageerror lines), and the
  screenshot paths to look at.
- **Root cause** — your best-supported hypothesis, referencing project code
  (`file:line`) when you found it.
- **Suggested fix** — concrete and minimal.
- Offer, don't do: "run `/trace2e <flow>` to turn this path into a regression test once
  fixed", and cleanup of `.trace2e-debug/` when done.

Keep the replay artifacts until the user says the bug is fixed — they are the evidence.
