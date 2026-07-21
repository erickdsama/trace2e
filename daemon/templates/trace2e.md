---
description: Generate Playwright E2E tests from a recorded trace2e trace
argument-hint: "[trace name or id — omit for the latest]"
allowed-tools: mcp__trace2e__list_traces, mcp__trace2e__get_trace, mcp__trace2e__get_screenshots, Read, Write, Edit, Bash
---

You are turning a **trace2e** recording into maintainable Playwright E2E tests.

## Input

Target trace: **$ARGUMENTS** (if empty, use the most recent trace).

1. Call `list_traces`. If `$ARGUMENTS` is empty, pick the newest; otherwise match by `name`
   or `id`. Then call `get_trace` with that id and `get_screenshots` for visual context on
   ambiguous steps.

## Trace model (recap)

A trace is `{ name, startUrl, viewport, variables[], steps[] }`. Step types:
`navigate | click | fill | press | select | upload | waitFor | assert | delay | customJs | hook`.
Each interactive step carries `target: { primary, fallbacks[], frame? }` where `primary`
and `fallbacks` are **Playwright locator expressions** already (e.g.
`getByRole('button', { name: 'Sign in' })`).

## Generation rules

1. **Structure per flow (decide, don't ask):**
   - **Flat spec** (`tests/<name>.spec.ts`) when the flow is short (≲12 steps) and shares
     no pages with existing specs.
   - **Page Object Model** (`tests/pages/*.ts` + `tests/<name>.spec.ts`) when the flow is
     long, or repeats interactions on a page also used by existing specs under `tests/`.
     Inspect `tests/` first with Read/Bash to decide.

2. **Locators:** use `target.primary` as `page.<primary>`. Add `fallbacks` as a trailing
   comment (`// fallback: ...`) so a human can swap if the primary breaks. For steps with
   `target.frame`, wrap as `page.<frame>.<primary>` using `frameLocator`.

3. **Variables — never hardcode secrets:**
   - `kind: "secret"` or `source: "env"` → `process.env.<NAME>` (assert presence at top of
     the spec). Add each to `.env.example` with an empty value and a comment.
   - `source: "fixture"` → read from `tests/fixtures/<name>.json`; create the file with a
     placeholder if missing.
   - `source: "generated"` → generate at runtime (e.g. `` `user_${Date.now()}` ``, or faker
     if already a dependency).
   - A `fill` step's `variableRef` maps to the resolved value above. There is never a raw
     secret in the trace — do not invent one.

4. **Custom steps:**
   - `customJs` → `await page.evaluate(() => { <code> })`.
   - `hook` with `phase: "before"` → `test.beforeEach`; `"after"` → `test.afterEach`. This
     is where **OTP retrieval** belongs — emit the operator's code that fetches the code
     (email/SMS API, TOTP seed, or endpoint) and feeds it to the OTP fill step.
   - `assert` → idiomatic `expect(...)`: `kind: text` → `toHaveText`/`toContainText`,
     `visible` → `toBeVisible`, `hidden` → `toBeHidden`, `url` → `expect(page).toHaveURL`,
     `value` → `toHaveValue`, `count` → `toHaveCount`.

5. **Waits & delays:** prefer Playwright auto-waiting. Emit `waitFor` steps as
   `await expect(locator).toBeVisible()` (or `toBeHidden`) or `await page.waitForURL(...)`.
   A `delay` step maps to `await page.waitForTimeout(ms)` — keep it, but add a
   `// TODO: prefer waiting on a condition` comment, since fixed waits are flaky.

6. **Scaffolding:** if `playwright.config.ts` is absent, create one (baseURL = the trace's
   `startUrl` origin, the recorded `viewport`, `chromium` project). If Playwright is not a
   dependency, add it and note the `npx playwright install` step. Update `.gitignore` to
   exclude `.env`, `test-results/`, and `playwright-report/`.

## Output

- The spec file(s) and any POM/fixtures.
- `.env.example` listing every secret variable (never real values).
- A short summary: files written, which variables the user must fill in `.env`, and the
  exact command to run (`cp .env.example .env && npx playwright test <name>`).

Do not run the tests unless the user asks — they must supply real secret values in `.env`
first.
