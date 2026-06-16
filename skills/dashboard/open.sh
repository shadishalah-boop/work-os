#!/usr/bin/env bash
# open.sh — open the dashboard in the browser at its localhost URL (NEVER as a
# file:// page, which renders blank because the browser blocks Babel from loading
# the .jsx files). Ensures the local server is running first.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTFILE="$HOME/.claude/dashboard-serve-port"
PORT="$(cat "$PORTFILE" 2>/dev/null || echo 8787)"
URL="http://localhost:${PORT}/Work%20Dashboard.html"

# Make sure the server is up; start it if the URL isn't reachable.
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo 000)
  if [ "$code" != "200" ]; then
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
