#!/usr/bin/env bash
# open.sh — open the dashboard in the browser at its localhost URL (NEVER as a
# file:// page, which renders blank because the browser blocks Babel from loading
# the .jsx files). Ensures the local server is running first.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTFILE="$HOME/.claude/dashboard-serve-port"
SERVE_VERSION_FILE="$HOME/.claude/dashboard-serve-version"
PORT="$(cat "$PORTFILE" 2>/dev/null || echo 8787)"
URL="http://localhost:${PORT}/Work%20Dashboard.html"

PLUGIN_VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version','0'))" "$SCRIPT_DIR/../../.claude-plugin/plugin.json" 2>/dev/null || echo 0)"
RUNNING_VERSION="$(cat "$SERVE_VERSION_FILE" 2>/dev/null || echo "")"

# Make sure the server is up AND running the current serve.py. If it's unreachable
# OR an older plugin version is running (stale serve.py → missing endpoints like
# /metrics-config or the /run-skill full-output field), (re)start it so the new
# endpoints/fixes take effect. Fixes the recurring "restart the server after updating".
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo 000)
  if [ "$code" != "200" ] || [ "$RUNNING_VERSION" != "$PLUGIN_VERSION" ]; then
    bash "$SCRIPT_DIR/schedule.sh" serve "$PORT" >/dev/null 2>&1 || true
    sleep 1
  fi
fi

if command -v open >/dev/null 2>&1; then
  open "$URL"            # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"        # Linux
fi

echo "Opening the dashboard at: $URL"
echo "(Always use this URL — opening the .html file directly shows a blank page.)"
