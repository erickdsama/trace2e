# Deploy the trace2e daemon to a DigitalOcean droplet

`deploy.sh` runs **on the droplet**. It installs Docker (if missing), pulls the CI-published
image from GHCR, and runs it — behind Caddy for automatic HTTPS when you set `DOMAIN`. No
source or build tools touch the box; it only pulls the image and writes a compose file.

```
GitHub Actions ─build─▶ ghcr.io/erickdsama/trace2e-daemon
droplet: ./deploy.sh ─▶ docker compose pull ─▶ run (Caddy TLS)
```

## Create the droplet

Any Ubuntu droplet works; the **Docker** Marketplace image saves the install step. Add your
SSH key, then SSH in as root.

## Run it on the droplet

**Manual (after `git clone` or copying the file):**
```bash
TRACE2E_TOKEN=$(openssl rand -hex 24) DOMAIN=trace2e.example.com ./deploy.sh
```

**One-liner, straight from GitHub (no clone):**
```bash
curl -fsSL https://raw.githubusercontent.com/erickdsama/trace2e/main/deploy/digitalocean/deploy.sh \
  | sudo TRACE2E_TOKEN=$(openssl rand -hex 24) DOMAIN=trace2e.example.com bash
```

**As cloud-init / droplet "user data"** (runs at first boot): paste the script with the env
vars set inline at the top, e.g.
```bash
#!/usr/bin/env bash
export TRACE2E_TOKEN=REPLACE_ME DOMAIN=trace2e.example.com
curl -fsSL https://raw.githubusercontent.com/erickdsama/trace2e/main/deploy/digitalocean/deploy.sh | bash
```

## Pin a released version
```bash
TAG=0.1.0 TRACE2E_TOKEN=… DOMAIN=… ./deploy.sh    # runs ghcr.io/erickdsama/trace2e-daemon:0.1.0
```

## Env vars

| Var | Meaning |
|-----|---------|
| `TRACE2E_TOKEN` | shared access token (auto-generated + printed if unset) |
| `DOMAIN` | enables Caddy automatic HTTPS (point the A record at the droplet first) |
| `TAG` / `IMAGE` | version to run (default `ghcr.io/erickdsama/trace2e-daemon:latest`) |
| `ALLOWED_ORIGIN` | lock CORS to your extension id |
| `GH_PAT` / `GH_USER` | pull a **private** GHCR image (token needs `read:packages`) |

If you keep the GHCR package **public** (repo → Packages → visibility), no token is needed.

## Update later
```bash
cd /opt/trace2e && docker compose pull && docker compose up -d
```

See `../../DEPLOY.md` for pointing the extension and Claude Code at the deployed URL.

## Note on the "web"

Only the **daemon** is hosted here. The extension (client) isn't a server — it's distributed
via the Chrome Web Store or `dist/trace2e-use.tgz`, and each user points it at this daemon's
URL in the side panel Settings.
