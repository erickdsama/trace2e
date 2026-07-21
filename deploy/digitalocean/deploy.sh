#!/usr/bin/env bash
#
# Provision the trace2e daemon ON a DigitalOcean droplet (run this on the droplet, as root).
#
# It installs Docker if needed, pulls the CI-published image from GHCR, and runs it — behind
# Caddy for automatic HTTPS when DOMAIN is set. No source or build toolchain touches the box;
# it only pulls the image and writes a compose file. Re-run any time to update.
#
# On a fresh Ubuntu droplet:
#   # 1) manual:
#   TRACE2E_TOKEN=$(openssl rand -hex 24) DOMAIN=trace2e.example.com ./deploy.sh
#
#   # 2) straight from GitHub (no clone):
#   curl -fsSL https://raw.githubusercontent.com/erickdsama/trace2e/main/deploy/digitalocean/deploy.sh \
#     | sudo TRACE2E_TOKEN=$(openssl rand -hex 24) DOMAIN=trace2e.example.com bash
#
#   # 3) as a droplet "user data" (cloud-init) script — same body with the env vars set inline.
#
# Env:
#   TRACE2E_TOKEN   shared access token (generated + printed if unset)
#   DOMAIN          optional — Caddy HTTPS (point the domain's A record at this droplet first)
#   TAG             image tag to run                                [latest]
#   IMAGE           full image ref                    [ghcr.io/erickdsama/trace2e-daemon:$TAG]
#   ALLOWED_ORIGIN  optional — chrome-extension://<id> to lock CORS
#   GH_PAT / GH_USER  GitHub token (read:packages) + user, if the GHCR package is private
set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Run as root (use sudo)." >&2; exit 1; }

IMAGE="${IMAGE:-ghcr.io/erickdsama/trace2e-daemon:${TAG:-latest}}"
APP_DIR="/opt/trace2e"
say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

if [ -z "${TRACE2E_TOKEN:-}" ]; then
  TRACE2E_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c18 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  say "Generated TRACE2E_TOKEN: $TRACE2E_TOKEN  (save it — paste into the extension)"
fi

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# --- private GHCR pull auth (optional) ---
if [[ "$IMAGE" == ghcr.io/* ]] && [ -n "${GH_PAT:-}" ]; then
  say "Logging in to GHCR…"
  echo "$GH_PAT" | docker login ghcr.io -u "${GH_USER:-erickdsama}" --password-stdin
fi

# --- public IP (for the printed URL when there's no domain) ---
PUBLIC_IP="$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || true)"
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="$(curl -fsS --max-time 3 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"

# --- write the stack ---
say "Writing the stack to $APP_DIR…"
mkdir -p "$APP_DIR"
if [ -n "${DOMAIN:-}" ]; then
  cat > "$APP_DIR/Caddyfile" <<CADDY
$DOMAIN {
  reverse_proxy trace2e:8787
}
CADDY
  cat > "$APP_DIR/docker-compose.yml" <<COMPOSE
services:
  trace2e:
    image: "${IMAGE}"
    restart: unless-stopped
    environment:
      TRACE2E_TOKEN: "${TRACE2E_TOKEN}"
      TRACE2E_ALLOWED_ORIGIN: "${ALLOWED_ORIGIN:-}"
    volumes: [ "trace2e-data:/data" ]
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: [ "80:80", "443:443" ]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [ trace2e ]
volumes: { trace2e-data: {}, caddy-data: {}, caddy-config: {} }
COMPOSE
  PUBLIC_URL="https://$DOMAIN"
else
  cat > "$APP_DIR/docker-compose.yml" <<COMPOSE
services:
  trace2e:
    image: "${IMAGE}"
    restart: unless-stopped
    ports: [ "8787:8787" ]
    environment:
      TRACE2E_TOKEN: "${TRACE2E_TOKEN}"
      TRACE2E_ALLOWED_ORIGIN: "${ALLOWED_ORIGIN:-}"
    volumes: [ "trace2e-data:/data" ]
volumes: { trace2e-data: {} }
COMPOSE
  PUBLIC_URL="http://${PUBLIC_IP:-<droplet-ip>}:8787"
fi

# --- pull + run ---
say "Pulling $IMAGE and starting…"
cd "$APP_DIR"
docker compose pull
docker compose up -d

# --- verify (from inside the container, so it works whether or not 8787 is published) ---
say "Verifying the daemon…"
ok=""
for _ in $(seq 1 20); do
  docker compose exec -T trace2e wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1 && { ok=1; break; }
  sleep 2
done
[ -n "$ok" ] || { echo "Daemon did not become healthy. Check: cd $APP_DIR && docker compose logs" >&2; exit 1; }
if [ -n "${DOMAIN:-}" ]; then
  echo "   Caddy is obtaining a TLS certificate for $DOMAIN — give it a few seconds on first run."
fi

cat <<DONE

✅ trace2e daemon running (image: $IMAGE)

  URL:    $PUBLIC_URL
  Token:  $TRACE2E_TOKEN

Update later:   cd $APP_DIR && docker compose pull && docker compose up -d
Logs:           cd $APP_DIR && docker compose logs -f

Next:
  • Extension → Settings → Daemon URL = $PUBLIC_URL, Token = above → Save.
  • Claude Code → .mcp.json env: TRACE2E_REMOTE_URL=$PUBLIC_URL, TRACE2E_TOKEN=… (see DEPLOY.md).
$( [ -z "${DOMAIN:-}" ] && echo "  ⚠ No DOMAIN — plain HTTP. For real use set DOMAIN (A record → ${PUBLIC_IP:-this droplet}) and re-run for HTTPS." )
DONE
