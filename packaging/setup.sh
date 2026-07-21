#!/usr/bin/env bash
# trace2e setup — run this from inside the project you want to generate tests for.
# It registers the /trace2e command + MCP server for Claude Code in the current folder.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/trace2e.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 18+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi

echo "▶ Registering trace2e in: $(pwd)"
node "$BIN" init --self

cat <<EOF

✅ Done. Three things to use it:

1) Start the recorder server (keep this terminal open):
     node "$BIN" serve

2) Load the Chrome extension (one time):
     chrome://extensions  →  turn on "Developer mode"  →  "Load unpacked"  →  pick:
     $DIR/extension

   Then click the trace2e icon, open Settings in the side panel, and paste this token:
EOF
node "$BIN" token 2>/dev/null

cat <<'EOF'

3) Record a flow in the browser, click "Upload to daemon", then in Claude Code run:
     /trace2e

Tips:
  - node <bin> list     # see recorded traces
  - node <bin> token    # reprint the token
EOF
