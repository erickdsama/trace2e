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
  point at it (see `DEPLOY.md`). A web **dashboard** at the daemon's `/` lets you log in,
  browse traces by **project**, **edit** recorded traces (rename, tweak steps, reorder,
  raw JSON), and — as admin — manage **users**, each with their own password and API token.

## Releases (what you download)

Each tagged release attaches a **light, standalone Go client** (~5 MB, no Node needed) for
every platform, plus the Chrome extension:

| Asset | What |
|-------|------|
| `trace2e-linux-x64`, `trace2e-linux-arm64` | client binary (Linux) |
| `trace2e-darwin-x64`, `trace2e-darwin-arm64` | client binary (macOS Intel / Apple Silicon) |
| `trace2e-windows-x64.exe` | client binary (Windows) |
| `trace2e-extension-chrome.zip` | the recorder extension (load unpacked) |

The daemon (the server) is separate and ships as a container image:
`ghcr.io/erickdsama/trace2e-daemon` (see `DEPLOY.md`).

## Quick start — client + hosted daemon

The client is a small binary that installs the MCP server + `/trace2e` command into a
project and talks to your hosted daemon. The extension defaults its Daemon URL to
`https://trace2e.novaminds.xyz`, so you only need the token.

1. **Set up the project.** Download the client binary for your OS, then in your repo:
   ```bash
   ./trace2e-<os>-<arch> init --token <your-token>
   ```
   This writes `.mcp.json` (MCP → the daemon) and `.claude/commands/trace2e.md`.
   Override the daemon with `--url https://your-daemon`.
2. **Load the extension.** Unzip `trace2e-extension-chrome.zip`, load it at
   `chrome://extensions` (Developer mode → Load unpacked). Right-click the extension icon →
   **Options** (or the ⚙ gear in the side panel) → paste your token → Save (the URL is
   pre-filled). Get your token from the daemon dashboard: sign up / log in → **Copy token**.
3. **Record → Upload.** Name the flow (any time), pick a project if you use them, drive the
   site, add checkpoints/waits with the picker, then **Upload to daemon**.
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
| `client` | **Light Go client** (`init` + MCP bridge) — the release binary users install |
| `packages/schema` | Shared `Trace` types + zero-dep validator (producer/consumer contract) |
| `daemon` | The **server**: HTTP API, MCP source, dashboard, file store (Node/container) |
| `extension` | WXT Manifest V3 Chrome extension: recorder, element picker, side panel |
| `.claude/commands/trace2e.md` | Slash command that reads a trace via MCP and writes specs |

## Client CLI (the release binary)

| Command | What it does |
|---------|--------------|
| `trace2e init [--token <t>] [--url <daemon>]` | Scaffold `.mcp.json` + `/trace2e` command into the current project, pointing the MCP server at the daemon (URL defaults to the shared one). Merges into an existing `.mcp.json`. |
| `trace2e mcp` | MCP server on stdio that Claude Code launches; forwards trace reads to the daemon (`TRACE2E_REMOTE_URL` + `TRACE2E_TOKEN`). |
| `trace2e list` | List traces on the daemon. |

## Server CLI (the daemon)

For running/operating the daemon itself: `serve` (HTTP API + dashboard), `token`, `list`,
`sample`, `mcp`. See `DEPLOY.md`.

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
- Hosted daemons support **per-user accounts**: anyone can sign up from the dashboard's
  login page and gets their own password + resettable `t2e_…` API token (scrypt-hashed
  passwords, tokens never re-shown after creation). Set `TRACE2E_ADMIN_PASSWORD` to
  bootstrap an `admin` who can manage users. The legacy single `TRACE2E_TOKEN` still
  works for local/simple setups.
- Custom JS / hook code is operator-authored and visible in the side panel before upload —
  nothing is injected silently. It is recorded as text and only ever runs inside the
  generated Playwright test, never in the extension.
