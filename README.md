# trace2e

Record what a real person does on a website in Chrome, then let **Claude Code** turn the
recording into maintainable **Playwright E2E tests**.

```
Chrome extension  ──POST trace──▶  daemon (HTTP API + MCP + dashboard)  ──MCP──▶  Claude Code
   (records, in browser)             (local ~/.trace2e, or hosted)               (/trace2e → specs)
```

## Key properties

- **Secrets never captured.** Password / one-time-code fields auto-become variable
  placeholders (`{{PASSWORD}}`); the real value never enters the log, store, or upload.
- **Accurate recording.** Semantic Playwright locators (getByRole/Label/…), an element
  picker for assertions/waits, fragile-selector flags, plus custom JS, hooks, delays and
  checkpoints.
- **Local or hosted.** Run the daemon on your machine, or deploy it once and have everyone
  point at it (see `DEPLOY.md`). A web **dashboard** to browse/manage traces is served at
  the daemon's `/`.

## Releases (what you download)

Each tagged release attaches **lightweight, Node-based** artifacts — there is no compiled
binary (a self-contained one is ~90 MB of embedded Node; not worth it when Claude Code
users already have Node):

| Asset | Size | What |
|-------|------|------|
| `trace2e.mjs` | ~750 KB | single-file client CLI (needs Node 18+) |
| `trace2e-use.tgz` | ~170 KB | turnkey package: prebuilt extension + the CLI |

The daemon also ships as a container image: `ghcr.io/erickdsama/trace2e-daemon`.

## Quick start — use a hosted daemon (client)

If a trace2e daemon is already deployed (the extension defaults to
`https://trace2e.novaminds.xyz`), you only need the token.

1. **Set up the project.** Download `trace2e.mjs` from the latest release, then in your repo:
   ```bash
   node trace2e.mjs init --token <your-token>
   ```
   This writes `.mcp.json` (MCP → the hosted daemon) and `.claude/commands/trace2e.md`.
   Override the daemon with `--url https://your-daemon`.
2. **Load the extension.** From `trace2e-use.tgz`, load `extension/` at `chrome://extensions`
   (Developer mode → Load unpacked). Open the side panel → Settings → paste the token → Save.
   The Daemon URL is pre-filled with the default.
3. **Record → Upload.** Name the flow (any time), drive the site, add checkpoints/waits with
   the picker, then **Upload to daemon**.
4. **Generate tests.** In Claude Code: `/trace2e <flow-name>` (omit the name for the latest).

## Run your own daemon

Local, for development:
```bash
pnpm install && pnpm -r build
node daemon/dist/cli.js serve      # HTTP API + dashboard on http://127.0.0.1:8787
node daemon/dist/cli.js token      # token to paste into the extension
```
Point the extension's Daemon URL at `http://127.0.0.1:8787`.

Hosted (shared): see **`DEPLOY.md`** and **`deploy/digitalocean/`** — a container image, a
`docker compose` + Caddy TLS stack, and an on-droplet script.

## Packages

| Path | What it is |
|------|-----------|
| `packages/schema` | Shared `Trace` types + zero-dep validator (producer/consumer contract) |
| `daemon` | Node process + `trace2e` CLI: HTTP API, MCP server, dashboard, file store |
| `extension` | WXT Manifest V3 Chrome extension: recorder, element picker, side panel |
| `.claude/commands/trace2e.md` | Slash command that reads a trace via MCP and writes specs |

## CLI reference

| Command | What it does |
|---------|--------------|
| `trace2e init [--token <t>] [--url <daemon>]` | Scaffold `.mcp.json` + `/trace2e` command. With `--token`/`--url` it's **client mode** (MCP → a hosted daemon, URL defaults to the shared one). Merges into an existing `.mcp.json`. |
| `trace2e mcp` | MCP server on stdio — what Claude Code launches. Reads from the local store, or a hosted daemon when `TRACE2E_REMOTE_URL` is set. |
| `trace2e serve` | Run the HTTP API + dashboard (local recording, or as the hosted daemon). |
| `trace2e token` | Print the access token. |
| `trace2e list` | List recorded traces. |
| `trace2e sample` | Load a sample signup flow (username/password) into the store. |

Run it as `node trace2e.mjs <cmd>` from a release, or build a local binary with `pnpm binary`
(unshipped, ~90 MB) if you truly need a no-Node executable.

## Build from source

```bash
pnpm install
pnpm -r build       # schema, daemon, extension
pnpm ext:build      # → extension/.output/chrome-mv3 (Load unpacked)
pnpm dist           # → dist/trace2e-use.tgz (turnkey package)
```

## Security

- Secret values are never captured, stored, transmitted, or logged — placeholders only.
- Local mode binds loopback and rejects non-loopback callers. Hosted mode binds `0.0.0.0`,
  requires a Bearer token, restricts CORS to the extension origin, and expects TLS at the
  proxy (Caddy in the provided deploy).
- Custom JS / hook code is operator-authored and visible in the side panel before upload —
  nothing is injected silently. It is recorded as text and only ever runs inside the
  generated Playwright test, never in the extension.
