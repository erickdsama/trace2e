# trace2e — record a browser flow, generate Playwright tests

No build step. You need **Node.js 18+** and **Google Chrome**.

## What's in this folder

- `bin/trace2e.mjs` — the CLI (client + optional local daemon), one file
- `extension/` — the Chrome extension (the recorder UI)
- `setup.sh` — one command that wires the `/trace2e` command + MCP into your project
- `templates/` — used by setup (don't touch)

## Setup (once per project)

From inside the project you want tests for:

```bash
/path/to/trace2e-use/setup.sh
```

That registers the `/trace2e` command + MCP server for Claude Code in this folder, and prints
next steps.

Load the extension once: `chrome://extensions` → **Developer mode** → **Load unpacked** →
select this folder's `extension/`. Configure it in its **options page**: right-click the
extension icon → **Options**, or click the ⚙ gear in the side panel.

## Two ways to run

### A. Use a shared/hosted daemon (recommended)

The extension's **Daemon URL is pre-filled** with the hosted daemon — you only paste your
**token** in the options page and Save (get it from the daemon dashboard: log in → **Copy
token**). To make Claude Code read from that same daemon:

```bash
node /path/to/trace2e-use/bin/trace2e.mjs init --token <your-token>
#   override the daemon with:  --url https://your-daemon
```

### B. Run the daemon locally

```bash
node /path/to/trace2e-use/bin/trace2e.mjs serve     # API + dashboard on http://127.0.0.1:8787
node /path/to/trace2e-use/bin/trace2e.mjs token     # token to paste into the extension
```
Then set the extension's Daemon URL to `http://127.0.0.1:8787`.

## Everyday use

1. In Chrome: name the flow → **● Record** → do the actions (password/one-time-code fields
   are auto-hidden — real values are never saved) → add checkpoints/waits with the picker →
   **Upload to daemon**.
2. In Claude Code, in your project: `/trace2e` — generates a Playwright test from the latest
   recording (or `/trace2e <flow-name>`).

You can also browse recordings in the daemon's **dashboard** at its URL (`/`) — log in to
organize traces into projects, edit a recording (rename, tweak/reorder steps), and, as an
admin, manage users and their tokens.

## Commands

| Command | Does |
|---------|------|
| `node bin/trace2e.mjs init --token <t>` | Set up the /trace2e command + MCP → the hosted daemon |
| `node bin/trace2e.mjs serve` | Run a local daemon (API + dashboard) |
| `node bin/trace2e.mjs token` | Print the local token |
| `node bin/trace2e.mjs list` | List recorded flows |

## Optional: shorter command

```bash
alias trace2e="node /path/to/trace2e-use/bin/trace2e.mjs"
```
