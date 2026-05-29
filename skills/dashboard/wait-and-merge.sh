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

stat_mtime() { stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null; }

if [ -z "$EXPECTED" ]; then
  # No agents to wait for (everything cached). Just run merge and exit.
  python3 "$SCRIPT_DIR/build-overrides.py"
  exit $?
fi

TIMEOUT_S=300       # hard cap: 5 minutes
POLL_INTERVAL=2
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
