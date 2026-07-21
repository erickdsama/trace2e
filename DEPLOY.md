# Deploying the trace2e daemon (shared/hosted)

For a team, host the daemon once so everyone's extension uploads to a shared store and each
developer's Claude Code reads from it. The MCP server still runs locally per developer
(Claude Code spawns it over stdio); only the HTTP ingest + read API is hosted.

## What gets hosted

The daemon's HTTP API:

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /traces` | Bearer | extension uploads a recording |
| `GET /traces` | Bearer | list summaries |
| `GET /traces/:id` (or `/latest`) | Bearer | full trace |
| `GET /traces/:id/screenshots` | Bearer | screenshots (base64) |
| `DELETE /traces/:id` | Bearer | delete |
| `GET /health` | none | liveness probe |

## Configuration (env)

| Var | Purpose |
|-----|---------|
| `TRACE2E_TOKEN` | **Required in prod.** Shared access token (a secret). |
| `TRACE2E_HOST` | Bind address. Set `0.0.0.0` when hosted (the Docker image already does). |
| `TRACE2E_PORT` / `PORT` | Port (default 8787). |
| `TRACE2E_HOME` | Store path — mount a volume (`/data` in the image). |
| `TRACE2E_ALLOWED_ORIGIN` | Lock CORS to your published extension id, e.g. `chrome-extension://<id>`. |

When bound to a non-loopback host the daemon skips the loopback-only guard and relies on the
token — so **always terminate TLS** (platform HTTPS or a reverse proxy) and set a strong token.

## Option A — Docker Compose

```bash
export TRACE2E_TOKEN=$(openssl rand -hex 24)
docker compose up --build -d
curl -s localhost:8787/health
```

## Option B — Fly.io

```bash
fly launch --no-deploy
fly volumes create trace2e_data --size 1
fly secrets set TRACE2E_TOKEN=$(openssl rand -hex 24)
fly deploy
```

Any container host works (Render, Railway, Cloud Run, a VM) — build `daemon/Dockerfile`,
give it a volume at `/data`, set `TRACE2E_TOKEN`, and expose it over HTTPS.

## Point the pieces at the hosted daemon

**Extension:** open the side panel → Settings → set Daemon URL to your `https://…` host and
paste `TRACE2E_TOKEN` → Save. Saving requests permission to reach that origin (needed for a
non-loopback daemon); approve it.

**Claude Code (each developer):** make the local MCP server read from the hosted daemon by
adding env to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "trace2e": {
      "command": "trace2e",
      "args": ["mcp"],
      "env": {
        "TRACE2E_REMOTE_URL": "https://trace2e.your-co.com",
        "TRACE2E_TOKEN": "the-shared-secret"
      }
    }
  }
}
```

With `TRACE2E_REMOTE_URL` set, `list_traces` / `get_trace` / `get_screenshots` fetch from the
hosted API instead of local disk. Then `/trace2e` works exactly as it does locally.

## Security checklist

- [ ] Strong `TRACE2E_TOKEN`, delivered as a platform secret (never committed).
- [ ] HTTPS only (platform TLS or reverse proxy).
- [ ] `TRACE2E_ALLOWED_ORIGIN` set to your extension id.
- [ ] Volume for `/data` so traces survive restarts.
- [ ] Remember: secret *values* are never in a trace (only `{{PLACEHOLDERS}}`), but recorded
      URLs, entered non-secret data, and screenshots are — treat the store as internal.
