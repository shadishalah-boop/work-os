#!/usr/bin/env bash
# prep.sh — single analyzable entry point for the dashboard orchestrator's Step 1.
#
# Invoked (inside the headless refresh subprocess) as:  bash <skill-dir>/prep.sh
#
# Does all the date/window/cache computation, pre-deletes the output files of the
# agents that will run, and pre-fetches Slack — so the orchestrator's only Bash
# call here is this one statically-analyzable line. Its internals are never
# analyzed by Claude Code's permission matcher (heredocs/$(...) inside a committed
# script are fine; the same logic inline in the skill would force a prompt).
#
# Prints KEY=VALUE lines for the orchestrator to capture:
#   TODAY, TOMORROW, NOW (HH:MM), WINDOW_DAYS, START_TS, SLACK_RAW,
#   DATA_DIR, DASH_DIR, RUN_AGENTS, SKIP_AGENTS
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DATA_DIR, DASH_DIR
mkdir -p "$DATA_DIR"

TODAY=$(date '+%Y-%m-%d')
TOMORROW=$(date -v+1d '+%Y-%m-%d' 2>/dev/null || date -d '+1 day' '+%Y-%m-%d')
NOW_HHMM=$(date '+%H:%M')
START_TS=$(date '+%s')

# --- WINDOW_DAYS = ceil(hours since last successful refresh / 24), clamped [1,7] ---
# Uses mtime of data-override.jsx — only written on a complete refresh.
LAST=$(stat -f '%m' "$DASH_DIR/data-override.jsx" 2>/dev/null || stat -c '%Y' "$DASH_DIR/data-override.jsx" 2>/dev/null)
if [ -z "$LAST" ]; then
  WINDOW_DAYS=7   # no prior refresh → safe default
else
  HRS=$(( (START_TS - LAST) / 3600 ))
  WINDOW_DAYS=$(( (HRS + 23) / 24 ))
  [ "$WINDOW_DAYS" -lt 1 ] && WINDOW_DAYS=1
  [ "$WINDOW_DAYS" -gt 7 ] && WINDOW_DAYS=7
fi

# --- Per-agent TTL (same-day cache). Live agents always run; slow ones reuse JSON. ---
ttl_for_agent() {
  case "$1" in
    calendar|gmail|slack) echo 0     ;;  # always run
    granola)              echo 7200  ;;  # 2h
    drive|wellness)       echo 14400 ;;  # 4h
  esac
}

stat_mtime() { stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null; }

RUN_AGENTS=""
SKIP_AGENTS=""
for agent in calendar granola gmail slack drive wellness; do
  ttl=$(ttl_for_agent "$agent")
  json="$DATA_DIR/${agent}.json"
  if [ ! -f "$json" ] || [ "$ttl" -eq 0 ]; then
    RUN_AGENTS="$RUN_AGENTS $agent"
    continue
  fi
  age=$(( START_TS - $(stat_mtime "$json") ))
  # Cache valid only if mtime < TTL AND sourceOk:true (a failed JSON must be retried).
  ok=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('sourceOk',False))" "$json" 2>/dev/null)
  if [ "$age" -lt "$ttl" ] && [ "$ok" = "True" ]; then
    SKIP_AGENTS="$SKIP_AGENTS $agent"
  else
    RUN_AGENTS="$RUN_AGENTS $agent"   # expired or cache poisoned by prior failure
  fi
done

RUN_AGENTS="${RUN_AGENTS# }"
SKIP_AGENTS="${SKIP_AGENTS# }"

# --- Delete each running agent's output file so its Write is a fresh CREATE ---------
# The Write tool refuses to OVERWRITE an existing file without a prior Read; agents
# then fall back to an unparseable `cat > file << EOF`. Removing the stale file first
# means the agent's Write creates a brand-new file and never reaches that fallback.
for agent in $RUN_AGENTS; do
  case "$agent" in
    drive) rm -f "$DATA_DIR/drive-raw.json" ;;  # drive writes drive-raw.json
    *)     rm -f "$DATA_DIR/${agent}.json"  ;;
  esac
done

# --- If slack will run, fetch its raw data now so the agent can Read it ---
SLACK_RAW=skipped
case " $RUN_AGENTS " in
  *" slack "*)
    if bash "$SCRIPT_DIR/slack-fetch.sh" "$WINDOW_DAYS" >/dev/null 2>&1; then
      SLACK_RAW=ok
    else
      SLACK_RAW=fail
    fi
    ;;
esac

echo "TODAY=$TODAY"
echo "TOMORROW=$TOMORROW"
echo "NOW=$NOW_HHMM"
echo "WINDOW_DAYS=$WINDOW_DAYS"
echo "START_TS=$START_TS"
echo "SLACK_RAW=$SLACK_RAW"
echo "DATA_DIR=$DATA_DIR"
echo "DASH_DIR=$DASH_DIR"
echo "RUN_AGENTS=$RUN_AGENTS"
echo "SKIP_AGENTS=$SKIP_AGENTS"
