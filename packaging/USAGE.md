# trace2e — record a browser flow, generate Playwright tests

No build step. You only need **Node.js 18+** and **Google Chrome**.

## What's in this folder

- `bin/trace2e.mjs` — the whole tool in one file (recorder server + MCP server for Claude Code)
- `extension/` — the Chrome extension (the recorder UI)
- `setup.sh` — one command that wires everything into your project
- `templates/` — used by setup (don't touch)

## Setup (once per project)

From inside the project you want tests for:

```bash
/path/to/trace2e-use/setup.sh
```

That registers the `/trace2e` command + MCP server for Claude Code in this folder, prints
your access token, and tells you where to load the extension.

Load the extension once: `chrome://extensions` → **Developer mode** → **Load unpacked** →
select this folder's `extension/`. Open the side panel (click the icon), expand **Settings**,
paste the token.

## Everyday use

```bash
# 1. start the recorder server (leave running while you record)
node /path/to/trace2e-use/bin/trace2e.mjs serve

# 2. in Chrome: name the flow → ● Record → do the actions → Stop → Upload to daemon
#    (password / one-time-code fields are auto-hidden — real values are never saved)

# 3. in Claude Code, in your project:
/trace2e                 # generates a Playwright test from the latest recording
```

## Commands

| Command | Does |
|---------|------|
| `node bin/trace2e.mjs serve` | Run the recorder server (needed while recording) |
| `node bin/trace2e.mjs token` | Print the token to paste into the extension |
| `node bin/trace2e.mjs list`  | List recorded flows |
| `node bin/trace2e.mjs init`  | Re-register the /trace2e command in the current project |

Recordings are stored on your machine at `~/.trace2e` — nothing is sent anywhere else.

## Optional: a shorter command

To type `trace2e` instead of `node …/bin/trace2e.mjs`, add an alias:

```bash
echo 'alias trace2e="node /path/to/trace2e-use/bin/trace2e.mjs"' >> ~/.zshrc && source ~/.zshrc
```
