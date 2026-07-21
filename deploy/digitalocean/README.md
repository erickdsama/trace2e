# Deploy the trace2e daemon to a DigitalOcean droplet

Production pattern: **build the image once, push it to a container registry, and the droplet
pulls and runs it.** No source or build tools ever go on the droplet — `deploy.sh` only
writes a `docker-compose.yml` (and a Caddyfile for HTTPS) there.

```
local:  docker build ─▶ docker push ─▶ registry
droplet:                          registry ─▶ docker compose pull ─▶ run (behind Caddy TLS)
```

## Prerequisites

- Local: `docker`, logged in to your registry
  - DigitalOcean Container Registry: `doctl registry login`
  - Docker Hub: `docker login`
- `doctl` authenticated (only if you want the script to create the droplet)
- An SSH key already added to your DO account (for droplet creation)
- A domain with an A record pointing at the droplet (for HTTPS)

## Examples

**Existing droplet, DigitalOcean Container Registry, HTTPS:**
```bash
DOCR=my-registry \
DO_TOKEN=dop_v1_xxx \
DOMAIN=trace2e.example.com \
TRACE2E_TOKEN=$(openssl rand -hex 24) \
ALLOWED_ORIGIN=chrome-extension://jbbacjmlabncoinbnddpgcjgjkomeknp \
./deploy.sh 203.0.113.10
```

**Provision a new droplet + Docker Hub public image + plain HTTP (quick test):**
```bash
IMAGE=docker.io/me/trace2e-daemon:latest \
CREATE=1 DO_SSH_KEY=my-key \
TRACE2E_TOKEN=$(openssl rand -hex 24) \
./deploy.sh
```

**Redeploy after a code change:** rebuild+push and re-run the same command, or on the droplet:
```bash
cd /opt/trace2e && docker compose pull && docker compose up -d
```

## Key env vars

| Var | Meaning |
|-----|---------|
| `IMAGE` / `DOCR` | image ref to build/push/run (or a DOCR registry name to derive it) |
| `TRACE2E_TOKEN` | shared access token (auto-generated + printed if unset) |
| `DOMAIN` | enables Caddy automatic HTTPS |
| `ALLOWED_ORIGIN` | lock CORS to your extension id |
| `DO_TOKEN` | lets the droplet pull from a private DOCR |
| `REGISTRY_USER` / `REGISTRY_PASSWORD` | droplet login for any other private registry |
| `NO_BUILD=1` | skip local build/push (image already published, e.g. from CI) |
| `CREATE=1` + `DO_SSH_KEY` | provision the droplet first |

See `../../DEPLOY.md` for wiring the extension and Claude Code to the deployed URL.

## Note on the "web"

Only the **daemon** is hosted here. The extension (the client) isn't a server — it's
distributed via the Chrome Web Store or the `dist/trace2e-use.tgz` package, and each user
points it at this daemon's URL in the side panel Settings.
