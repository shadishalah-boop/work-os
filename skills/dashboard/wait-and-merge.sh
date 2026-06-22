#!/usr/bin/env bash
# =============================================================================
# Wait until all expected agents have written fresh JSONs, then run the merge.
#
# The orchestrator launches this IN PARALLEL with the Agent tool calls (same
# tool_use_block). It polls until every expected agent's JSON has mtime > $START,
# then runs drive-transform.py (if drive ran) + build-overrides.py and emits the
# final confirmation line. The orchestrator's only post-block job is to relay
# this script's stdout.
#
# Usage:
#   wait-and-merge.sh <start_epoch> <agent1> [agent2 ...]
# =============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DATA_DIR

START="${1:?usage: wait-and-merge.sh <start_epoch> <agent1> [agent2 ...]}"
shift
EXPECTED="$*"

# GNU stat first (-c): on Linux, BSD-style `stat -f` succeeds with filesystem
# info instead of failing, so the old `-f || -c` order returned garbage.
stat_mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null; }

if [ -z "$EXPECTED" ]; then
  # No agents to wait for (everything cached). Just run merge and exit.
  python3 "$SCRIPT_DIR/build-overrides.py"
  exit $?
fi

TIMEOUT_S=300       # hard cap: 5 minutes
POLL_INTERVAL=1     # detect agent completion within ~1s (was 2s)
deadline=$(( $(date +%s) + TIMEOUT_S ))
all_ready=false

# The drive agent writes drive-raw.json, NOT drive.json — the transform converts it.
agent_outfile() {
  case "$1" in
    drive) echo "$DATA_DIR/drive-raw.json" ;;
    *)     echo "$DATA_DIR/${1}.json" ;;
  esac
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  all_ready=true
  missing=""
  for agent in $EXPECTED; do
    json=$(agent_outfile "$agent")
    if [ ! -f "$json" ]; then
      all_ready=false; missing="$missing $agent(no-file)"; continue
    fi
    mt=$(stat_mtime "$json")
    if [ "${mt:-0}" -le "$START" ]; then
      all_ready=false; missing="$missing $agent(stale)"
    fi
  done
  $all_ready && break
  sleep "$POLL_INTERVAL"
done

if ! $all_ready; then
  echo "WARNING: timeout waiting for:${missing} — running merge with whatever's on disk" >&2
fi

# If drive ran this refresh, transform its raw dump → drive.json before the merge.
case " $EXPECTED " in
  *" drive "*) python3 "$SCRIPT_DIR/drive-transform.py" >/dev/null 2>&1 ;;
esac

# Run the merge — this prints the final confirmation line.
python3 "$SCRIPT_DIR/build-overrides.py"

# Self-heal a stale local server: if the running serve.py predates this plugin
# version, it's missing newer endpoints (e.g. /import-org-photo, /metrics-config).
# A plain /dashboard refresh should bring it up to date too — not just the "open"
# flow — so restart it here when the recorded server version differs. (Only when a
# server is known to be running; we never auto-spawn one on a headless refresh.)
SERVE_VERSION_FILE="$HOME/.claude/dashboard-serve-version"
PORTFILE="$HOME/.claude/dashboard-serve-port"
PLUGIN_VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version','0'))" "$SCRIPT_DIR/../../.claude-plugin/plugin.json" 2>/dev/null || echo 0)"
RUNNING_VERSION="$(cat "$SERVE_VERSION_FILE" 2>/dev/null || echo "")"
if [ -n "$RUNNING_VERSION" ] && [ "$RUNNING_VERSION" != "$PLUGIN_VERSION" ]; then
  PORT="$(cat "$PORTFILE" 2>/dev/null || echo 8787)"
  bash "$SCRIPT_DIR/schedule.sh" serve "$PORT" >/dev/null 2>&1 || true
  echo "↻ Restarted the local dashboard server (was running an older version)."
fi
