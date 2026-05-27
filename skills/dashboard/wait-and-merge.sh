#!/bin/bash
# =============================================================================
# Wait until all expected agents have written fresh JSONs, then run merge.
#
# The orchestrator launches this script IN PARALLEL with the Agent tool calls
# (same tool_use_block). It polls until every expected agent's JSON has an
# mtime > $START, then runs build-overrides.py and emits the confirmation.
#
# This collapses what used to be two sequential orchestrator turns
# (1: receive agent tool_results → 2: invoke merge) into a single tool block
# the orchestrator's role is just to relay this script's stdout.
#
# Saves ~30-60s of "post-completion orchestrator thinking" per refresh.
#
# Resolves paths from ~/.claude/dashboard-config.local (data cache dir) and
# locates build-overrides.py relative to this script's own directory so it
# works regardless of where the plugin is installed.
#
# Usage:
#   wait-and-merge.sh <start_epoch> <agent1> [agent2 ...]
# Example:
#   wait-and-merge.sh 1778053592 calendar granola gmail slack wellness
# =============================================================================
set -u

START="${1:?usage: wait-and-merge.sh <start_epoch> <agent1> [agent2 ...]}"
shift
EXPECTED="$*"

# Self-locate build-overrides.py (sibling file in plugin)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BUILD_SCRIPT="$SCRIPT_DIR/build-overrides.py"

# Resolve dataCacheDir from config.local (with sensible fallback)
CONFIG="$HOME/.claude/dashboard-config.local"
if [ -f "$CONFIG" ]; then
  DATA_CACHE_DIR=$(python3 -c "
import json, os
try:
    c = json.load(open(os.path.expanduser('$CONFIG')))
    print(os.path.expanduser(c.get('output', {}).get('dataCacheDir', '~/.claude/dashboard-data')))
except Exception:
    print(os.path.expanduser('~/.claude/dashboard-data'))
")
else
  DATA_CACHE_DIR="$HOME/.claude/dashboard-data"
fi

if [ -z "$EXPECTED" ]; then
  # No agents to wait for (everything cached). Just run merge and exit.
  python3 "$BUILD_SCRIPT"
  exit $?
fi

TIMEOUT_S=300       # hard cap: 5 minutes
POLL_INTERVAL=2     # seconds between checks
deadline=$(( $(date +%s) + TIMEOUT_S ))
all_ready=false

while [ "$(date +%s)" -lt "$deadline" ]; do
  all_ready=true
  missing=""
  for agent in $EXPECTED; do
    json="$DATA_CACHE_DIR/${agent}.json"
    if [ ! -f "$json" ]; then
      all_ready=false
      missing="$missing $agent(no-file)"
      continue
    fi
    mt=$(stat -f '%m' "$json")
    if [ "$mt" -le "$START" ]; then
      all_ready=false
      missing="$missing $agent(stale)"
    fi
  done
  $all_ready && break
  sleep "$POLL_INTERVAL"
done

if ! $all_ready; then
  echo "WARNING: timeout waiting for:${missing} — running merge with whatever's on disk" >&2
fi

# Run the merge — this prints the final confirmation line.
python3 "$BUILD_SCRIPT"
