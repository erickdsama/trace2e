# Deploying the trace2e daemon (shared/hosted)

For a team, host the daemon once so everyone's extension uploads to a shared store and each
developer's Claude Code reads from it. The MCP server still runs locally per developer
(Claude Code spawns it over stdio); only the HTTP ingest + read API is hosted.

## What gets hosted

The daemon's HTTP API:

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /auth/login` | none | password login → the user's API token |
| `GET /auth/me` | Bearer | identity of the presented token |
| `POST /traces` | Bearer | extension uploads a recording (stamped with the uploader) |
| `GET /traces[?project=id\|none]` | Bearer | list summaries, optionally by project |
| `GET /traces/:id` (or `/latest`) | Bearer | full trace |
| `PUT /traces/:id` | Bearer | save an edited trace (dashboard editor) |
| `GET /traces/:id/screenshots` | Bearer | screenshots (base64) |
| `DELETE /traces/:id` | Bearer | delete |
| `GET /projects`, `POST /projects` | Bearer | list / create projects |
| `PUT /projects/:id`, `DELETE /projects/:id` | Bearer | rename / delete a project |
| `GET/POST /users`, `DELETE /users/:id`, `POST /users/:id/reset-token`, `PUT /users/:id/password` | admin | user management |
| `GET /health` | none | liveness probe |

## Users & tokens

Set `TRACE2E_ADMIN_PASSWORD` and the daemon bootstraps an `admin` user on startup. Log
into the dashboard (`https://your-daemon/`) as `admin`, open **Admin**, and create one
user per teammate — each gets their own password and a personal `t2e_…` API token (shown
once; resettable). Users paste *their* token into the extension and `.mcp.json`; uploads
are stamped with their username. The legacy shared `TRACE2E_TOKEN` keeps working (as an
admin) so existing setups don't break — you can drop it once everyone has a user.

## Configuration (env)

| Var | Purpose |
|-----|---------|
| `TRACE2E_ADMIN_PASSWORD` | **Recommended in prod.** Bootstraps the `admin` user; manage users/projects from the dashboard. |
| `TRACE2E_TOKEN` | Optional shared access token (legacy single-token mode; acts as an admin token). |
| `TRACE2E_HOST` | Bind address. Set `0.0.0.0` when hosted (the Docker image already does). |
| `TRACE2E_PORT` / `PORT` | Port (default 8787). |
| `TRACE2E_HOME` | Store path — mount a volume (`/data` in the image). |
| `TRACE2E_ALLOWED_ORIGIN` | Lock CORS to your published extension id, e.g. `chrome-extension://<id>`. |

When bound to a non-loopback host the daemon skips the loopback-only guard and relies on the
token — so **always terminate TLS** (platform HTTPS or a reverse proxy) and set a strong token.

## Option A — Docker Compose

```bash
export TRACE2E_ADMIN_PASSWORD=$(openssl rand -hex 12)
docker compose up --build -d
curl -s localhost:8787/health
```

## Option B — Fly.io

```bash
fly launch --no-deploy
fly volumes create trace2e_data --size 1
fly secrets set TRACE2E_ADMIN_PASSWORD=$(openssl rand -hex 12)
fly deploy
```

Any container host works (Render, Railway, Cloud Run, a VM) — build `daemon/Dockerfile`,
give it a volume at `/data`, set `TRACE2E_ADMIN_PASSWORD`, and expose it over HTTPS.

## Point the pieces at the hosted daemon

**Extension:** right-click the extension icon → **Options** (or the ⚙ gear in the side
panel) → set Daemon URL to your `https://…` host and paste *your* API token → Save. Saving
requests permission to reach that origin (needed for a non-loopback daemon); approve it.
**Test connection** confirms the token works.

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
        "TRACE2E_TOKEN": "t2e_your-personal-token"
      }
    }
  }
}
```

With `TRACE2E_REMOTE_URL` set, `list_traces` / `get_trace` / `get_screenshots` fetch from the
hosted API instead of local disk. Then `/trace2e` works exactly as it does locally.

## Security checklist

- [ ] Strong `TRACE2E_ADMIN_PASSWORD` (and `TRACE2E_TOKEN`, if you keep it), delivered as
      platform secrets (never committed).
- [ ] One user per teammate (dashboard → Admin) instead of a shared token; reset a user's
      token from the same page if it leaks.
- [ ] HTTPS only (platform TLS or reverse proxy).
- [ ] `TRACE2E_ALLOWED_ORIGIN` set to your extension id.
- [ ] Volume for `/data` so traces survive restarts.
- [ ] Remember: secret *values* are never in a trace (only `{{PLACEHOLDERS}}`), but recorded
      URLs, entered non-secret data, and screenshots are — treat the store as internal.
