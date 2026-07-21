#!/usr/bin/env bash
# trace2e setup — run this from inside the project you want to generate tests for.
# Registers the /trace2e command + MCP server for Claude Code in the current folder.
#
#   TRACE2E_TOKEN=<token> ./setup.sh          # client of the hosted daemon (recommended)
#   ./setup.sh                                # local daemon (no token → you run `serve`)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/trace2e.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 18+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi

echo "▶ Registering trace2e in: $(pwd)"
if [ -n "${TRACE2E_TOKEN:-}" ]; then
  node "$BIN" init --self --token "$TRACE2E_TOKEN"   # MCP → hosted daemon
  cat <<EOF

✅ Client set up for the hosted daemon.

1) Load the Chrome extension (one time):
     chrome://extensions → "Developer mode" → "Load unpacked" → $DIR/extension
   Open Settings in the side panel — the Daemon URL is pre-filled; paste your token and Save.

2) Record a flow → Upload to daemon → in Claude Code run:  /trace2e
EOF
else
  node "$BIN" init --self                            # MCP → local store
  cat <<EOF

✅ Set up for a LOCAL daemon. Next:

1) Start it (keep this terminal open):   node "$BIN" serve
2) Load the extension: chrome://extensions → "Load unpacked" → $DIR/extension
   In Settings, set Daemon URL = http://127.0.0.1:8787 and paste this token:
EOF
  node "$BIN" token 2>/dev/null
  cat <<'EOF'
3) Record → Upload → in Claude Code run:  /trace2e

Tip: to use the hosted daemon instead, re-run:  TRACE2E_TOKEN=<token> ./setup.sh
EOF
fi
