# trace2e

Record what a real person does on a website in Chrome, then let **Claude Code** turn the
recording into maintainable **Playwright E2E tests**.

```
Chrome extension  ──POST trace──▶  local daemon (ingest + MCP)  ──MCP──▶  Claude Code
   (records)                          (~/.trace2e store)                  (/trace2e → specs)
```

## Design

Full design rationale lives in the approved SDD:
`~/.claude/plans/misty-brewing-lantern.md`.

Key properties:

- **Secrets never captured.** Password / OTP fields are auto-tagged as variable
  placeholders (`{{PASSWORD}}`); the real value never enters the log, storage, or upload.
- **Custom steps.** Insert custom JS (`page.evaluate`), before/after hooks (OTP fetch, DB
  reset), and assertions during recording.
- **Local-only handoff.** The daemon binds to loopback, is token-guarded, and serves
  traces to Claude Code over MCP.

## Packages

| Path | What it is |
|------|-----------|
| `packages/schema` | Shared `Trace` types + zero-dep validator (the producer/consumer contract) |
| `daemon` | Local Node process: HTTP ingest + MCP server over one file store (`~/.trace2e`) |
| `extension` | WXT Manifest V3 Chrome extension: recorder, selector engine, side panel |
| `.claude/commands/trace2e.md` | Slash command that reads a trace via MCP and writes Playwright specs |
| `.mcp.json` | Registers the daemon as the `trace2e` MCP server for Claude Code |

## Setup

```bash
pnpm install
pnpm -r build            # build schema + daemon (+ extension)
```

### 1. Start the daemon (for recording)

```bash
node daemon/dist/cli.js --ingest-only
# prints:  ingest token: <uuid>   ← copy this
```

The token and traces live under `~/.trace2e` (override with `TRACE2E_HOME`). Port defaults
to `8787` (`TRACE2E_PORT`).

### 2. Load the extension

```bash
pnpm ext:build           # produces extension/.output/chrome-mv3
```

`chrome://extensions` → enable Developer mode → **Load unpacked** →
`extension/.output/chrome-mv3`. Open the side panel, expand **Settings**, and paste the
ingest token.

### 3. Record a flow

Name the flow, hit **● Record**, drive the site. Password/OTP fields become variables
automatically; use **Tag variable** on any other field you want parameterized. Add custom
JS / hooks / assertions from the side panel. **Stop**, then **Upload to daemon**.

### 4. Generate tests in Claude Code

The daemon is registered in `.mcp.json`. In Claude Code:

```
/trace2e login-with-otp        # or omit the name for the latest recording
```

Claude Code reads the trace over MCP, decides flat-spec vs Page Object Model, wires
variables to `process.env` / fixtures, embeds your custom steps, and writes the specs plus
`.env.example`.

```bash
cp .env.example .env           # fill real secrets locally (gitignored)
npx playwright test login-with-otp
```

## Use it in any project (the `trace2e` CLI)

trace2e is packaged as a single portable CLI so you can generate tests in other repos
without copying this monorepo.

Install the CLI once (from this repo until it's published to npm):

```bash
cd daemon && npm run build && npm link      # exposes a global `trace2e`
# later: npm i -g @trace2e/daemon
```

Then, in any project you want to generate tests for:

```bash
cd my-other-project
trace2e init          # writes .mcp.json (merged) + .claude/commands/trace2e.md
trace2e serve         # leave running while you record; `trace2e token` prints the token
# …record & upload with the extension, then in Claude Code: /trace2e
```

CLI reference:

| Command | What it does |
|---------|--------------|
| `trace2e init [--force] [--npx]` | Scaffold `.mcp.json` + the `/trace2e` command into the current project. `--npx` registers `npx -y @trace2e/daemon mcp` instead of a global binary. |
| `trace2e mcp` | MCP server on stdio (+ ingest if the port is free) — what Claude Code launches via `.mcp.json`. |
| `trace2e serve` | Ingest server only (run while recording). |
| `trace2e list` | List recorded traces. |
| `trace2e token` | Print the ingest token to paste into the extension. |

The trace store is shared across all projects (`~/.trace2e`), so one running daemon serves
every repo. `trace2e init` never clobbers an existing `.mcp.json` — it merges the `trace2e`
server alongside whatever is already there.

## Security

- Secret values are never captured, stored, transmitted, or logged — placeholders only.
- Ingest is loopback-only, CORS-locked to `chrome-extension://` origins, and Bearer-token
  guarded. Requests from non-loopback addresses are rejected.
- Custom JS / hook code is operator-authored and visible/editable in the side panel before
  upload — nothing is injected silently.
