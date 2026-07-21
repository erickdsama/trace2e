#!/usr/bin/env bash
#
# Deploy the trace2e daemon to a DigitalOcean droplet — production pattern.
#
# The image is built once locally (or in CI), pushed to a container registry, and the
# droplet only PULLS and runs it. No source code or build toolchain ever touches the box;
# only a docker-compose.yml (and a Caddyfile for TLS) is written there.
#
# Prereqs (local):
#   - docker, logged in to your registry:
#       DigitalOcean:  doctl registry login
#       Docker Hub:    docker login
#   - to provision a droplet: doctl authenticated + an SSH key in your DO account
#
# Usage:
#   # DigitalOcean Container Registry, deploy to an existing droplet:
#   DOCR=my-registry TRACE2E_TOKEN=$(openssl rand -hex 24) DO_TOKEN=dop_v1_… \
#     ./deploy.sh 203.0.113.10
#
#   # Any registry (public image) + provision a droplet + HTTPS:
#   IMAGE=docker.io/me/trace2e-daemon:latest DOMAIN=trace2e.example.com \
#     CREATE=1 DO_SSH_KEY=my-key TRACE2E_TOKEN=$(openssl rand -hex 24) ./deploy.sh
#
# Env:
#   IMAGE           full image ref to build/push/run (e.g. docker.io/me/trace2e-daemon:latest)
#   DOCR            DigitalOcean Container Registry name → derives IMAGE and enables droplet login
#   TAG             image tag when using DOCR                     [latest]
#   TRACE2E_TOKEN   required — shared access token (generated + printed if unset)
#   DOMAIN          optional — Caddy HTTPS (point the DNS A record at the droplet first)
#   ALLOWED_ORIGIN  optional — chrome-extension://<id> to lock CORS
#   NO_BUILD=1      skip local build+push (image already in the registry)
#   DO_TOKEN        (DOCR) DO API token so the droplet can pull from a private DOCR
#   REGISTRY_USER / REGISTRY_PASSWORD   (generic private registry) droplet login creds
#   CREATE=1        provision a new droplet via doctl (else pass an existing IP as $1)
#   DO_SSH_KEY, DO_NAME, DO_REGION, DO_SIZE, DO_IMAGE   droplet creation options
#   SSH_USER [root], SSH_KEY_PATH
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_DIR="/opt/trace2e"
SSH_USER="${SSH_USER:-root}"
DO_NAME="${DO_NAME:-trace2e-daemon}"
DO_REGION="${DO_REGION:-nyc1}"
DO_SIZE="${DO_SIZE:-s-1vcpu-1gb}"
DO_DROPLET_IMAGE="${DO_IMAGE:-docker-20-04}"   # Marketplace image with Docker preinstalled

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
[ -n "${SSH_KEY_PATH:-}" ] && SSH_OPTS+=(-i "$SSH_KEY_PATH")
ssh_do() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$IP" "$@"; }

# --- resolve image ref ---
if [ -n "${DOCR:-}" ]; then
  IMAGE="registry.digitalocean.com/${DOCR}/trace2e-daemon:${TAG:-latest}"
fi
[ -n "${IMAGE:-}" ] || die "Set IMAGE=<registry>/<repo>:<tag> (or DOCR=<registry-name>)."

# --- token ---
if [ -z "${TRACE2E_TOKEN:-}" ]; then
  TRACE2E_TOKEN="$(openssl rand -hex 24)"
  say "Generated TRACE2E_TOKEN: $TRACE2E_TOKEN  (save it — you paste it into the extension)"
fi

# --- build + push the image (local/CI), unless it's already published ---
if [ "${NO_BUILD:-}" != "1" ]; then
  command -v docker >/dev/null || die "docker not found locally (needed to build/push the image)."
  say "Building image $IMAGE …"
  docker build -f "$REPO_ROOT/daemon/Dockerfile" -t "$IMAGE" "$REPO_ROOT"
  say "Pushing $IMAGE (make sure you're logged in: 'doctl registry login' or 'docker login') …"
  docker push "$IMAGE"
else
  say "NO_BUILD=1 — using already-published $IMAGE"
fi

# --- resolve target droplet ---
if [ "${CREATE:-}" = "1" ]; then
  command -v doctl >/dev/null || die "doctl not found. Install it and run 'doctl auth init'."
  [ -n "${DO_SSH_KEY:-}" ] || die "CREATE=1 requires DO_SSH_KEY (an SSH key already in your DO account)."
  say "Creating droplet '$DO_NAME' ($DO_SIZE, $DO_REGION)…"
  doctl compute droplet create "$DO_NAME" \
    --region "$DO_REGION" --size "$DO_SIZE" --image "$DO_DROPLET_IMAGE" \
    --ssh-keys "$DO_SSH_KEY" --wait >/dev/null
  IP="$(doctl compute droplet get "$DO_NAME" --format PublicIPv4 --no-header)"
  [ -n "$IP" ] || die "Could not determine droplet IP."
  say "Droplet ready at $IP"
else
  IP="${1:-}"
  [ -n "$IP" ] || die "Pass the droplet IP as \$1, or set CREATE=1 to provision one."
fi

# --- wait for SSH ---
say "Waiting for SSH on $IP…"
for i in $(seq 1 30); do
  ssh_do true 2>/dev/null && break
  [ "$i" = 30 ] && die "SSH did not come up on $IP."
  sleep 5
done

# --- ensure Docker on the droplet ---
say "Ensuring Docker is installed…"
ssh_do 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh'

# --- registry auth on the droplet (only needed for private images) ---
if [ -n "${DOCR:-}" ] && [ -n "${DO_TOKEN:-}" ]; then
  say "Logging the droplet in to DigitalOcean Container Registry…"
  ssh_do "docker login registry.digitalocean.com -u '$DO_TOKEN' --password-stdin <<<'$DO_TOKEN'"
elif [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ]; then
  REG_HOST="${IMAGE%%/*}"
  say "Logging the droplet in to $REG_HOST…"
  ssh_do "docker login '$REG_HOST' -u '$REGISTRY_USER' --password-stdin <<<'$REGISTRY_PASSWORD'"
fi

# --- write compose (+ Caddy for TLS if DOMAIN is set) — references the image, no build ---
say "Writing the stack on the droplet…"
ssh_do "mkdir -p $REMOTE_DIR"
if [ -n "${DOMAIN:-}" ]; then
  ssh_do "cat > $REMOTE_DIR/Caddyfile" <<CADDY
$DOMAIN {
  reverse_proxy trace2e:8787
}
CADDY
  ssh_do "cat > $REMOTE_DIR/docker-compose.yml" <<COMPOSE
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
  ssh_do "cat > $REMOTE_DIR/docker-compose.yml" <<COMPOSE
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
  PUBLIC_URL="http://$IP:8787"
fi

# --- pull + run ---
say "Pulling the image and starting the daemon…"
ssh_do "cd $REMOTE_DIR && docker compose pull && docker compose up -d"

# --- verify ---
say "Verifying /health…"
ssh_do "for i in \$(seq 1 20); do curl -fsS http://127.0.0.1:8787/health && break || sleep 2; done" \
  || die "Daemon did not become healthy — check 'docker compose logs' on the droplet."

cat <<DONE

✅ trace2e daemon deployed (image: $IMAGE)

  URL:    $PUBLIC_URL
  Token:  $TRACE2E_TOKEN

Redeploy a new version later:  rebuild+push the image, then re-run this script
(or on the droplet: cd $REMOTE_DIR && docker compose pull && docker compose up -d).

Next:
  • Extension → Settings → Daemon URL = $PUBLIC_URL, Token = above → Save.
  • Claude Code → .mcp.json env: TRACE2E_REMOTE_URL=$PUBLIC_URL, TRACE2E_TOKEN=… (see DEPLOY.md).
$( [ -z "${DOMAIN:-}" ] && echo "  ⚠ No DOMAIN — plain HTTP. For real use set DOMAIN (DNS A record → $IP) and re-run for HTTPS." )
DONE
