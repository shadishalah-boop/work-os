#!/usr/bin/env bash
# prep.sh — single analyzable entry point for the dashboard orchestrator's Step 1.
#
# Invoked (inside the headless refresh subprocess) as:  bash <skill-dir>/prep.sh
#
# Does all the date/window/cache computation and pre-deletes the output files of
# the agents that will run — so the orchestrator's only Bash call here is this one
# statically-analyzable line. Its internals are never analyzed by Claude Code's
# permission matcher (heredocs/$(...) inside a committed script are fine; the same
# logic inline in the skill would force a prompt).
#
# Prints KEY=VALUE lines for the orchestrator to capture:
#   TODAY, TOMORROW, NOW (HH:MM), WINDOW_DAYS, SINCE_WINDOW, SINCE_1D, SINCE_30D,
#   START_TS, TZNAME, DATA_DIR, DASH_DIR, RUN_AGENTS, SKIP_AGENTS, CONFIG, BUNDLE,
#   MCP_CALENDAR, MCP_GMAIL, MCP_SLACK, MCP_DRIVE, MCP_GRANOLA
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DATA_DIR, DASH_DIR
mkdir -p "$DATA_DIR"

# --- Config sanity: a typo'd JSON silently becomes "all defaults", which looks
# --- like a broken install. Surface it loudly instead.
if [ ! -f "$CONFIG_FILE" ]; then
  CONFIG="missing (run /dashboard-setup — using defaults)"
elif ERR=$(python3 -m json.tool "$CONFIG_FILE" 2>&1 >/dev/null); then
  CONFIG=ok
else
  CONFIG="INVALID JSON ($(echo "$ERR" | head -1)) — ALL settings ignored, defaults used"
fi

# --- Bundle sync: copy/refresh the static bundle in DASH_DIR.
# Runs when the HTML is missing (fresh/manual install) or the stamped version
# differs from the plugin's (upgrade). Preserves the two generated overlay files
# and the user's custom.css.
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PUBLIC_DIR="$PLUGIN_ROOT/public"
PLUGIN_VERSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version','0'))" "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null || echo 0)
STAMP_FILE="$DASH_DIR/.bundle-version"
BUNDLE=ok
if [ -d "$PUBLIC_DIR" ]; then
  STAMPED=$(cat "$STAMP_FILE" 2>/dev/null || echo "")
  if [ ! -f "$DASH_DIR/Work Dashboard.html" ] || [ "$STAMPED" != "$PLUGIN_VERSION" ]; then
    mkdir -p "$DASH_DIR"
    KEEP_DIR=$(mktemp -d)
    for f in data-override.jsx drive-index.jsx custom.css; do
      [ -f "$DASH_DIR/$f" ] && cp "$DASH_DIR/$f" "$KEEP_DIR/$f"
    done
    cp -R "$PUBLIC_DIR/." "$DASH_DIR/"
    for f in data-override.jsx drive-index.jsx custom.css; do
      [ -f "$KEEP_DIR/$f" ] && cp "$KEEP_DIR/$f" "$DASH_DIR/$f"
    done
    rm -rf "$KEEP_DIR"
    echo "$PLUGIN_VERSION" > "$STAMP_FILE"
    BUNDLE="synced to v$PLUGIN_VERSION"
  fi
fi

TODAY=$(date '+%Y-%m-%d')
TOMORROW=$(date -v+1d '+%Y-%m-%d' 2>/dev/null || date -d '+1 day' '+%Y-%m-%d')
NOW_HHMM=$(date '+%H:%M')
START_TS=$(date '+%s')

# `since N` prints the calendar date N days ago — Slack search needs ABSOLUTE
# `after:YYYY-MM-DD` dates (relative `after:Nd` is Gmail syntax Slack ignores).
since() { date -v-"${1}"d '+%Y-%m-%d' 2>/dev/null || date -d "-${1} days" '+%Y-%m-%d'; }

# User timezone + per-source MCP server names from config (defaults = the
# standard managed connectors most users already have).
TZNAME="$(_cfg user.timezone 'Europe/Madrid')"
MCP_CALENDAR="$(_cfg mcp.calendar 'Google_Calendar')"
MCP_GMAIL="$(_cfg mcp.gmail 'Gmail')"
MCP_SLACK="$(_cfg mcp.slack 'Slack')"
MCP_DRIVE="$(_cfg mcp.drive 'Google_Drive')"
MCP_GRANOLA="$(_cfg mcp.granola 'Granola')"

# --- WINDOW_DAYS = ceil(hours since last successful refresh / 24), clamped [1,7] ---
# Uses mtime of data-override.jsx — only written on a complete refresh. The
# bundled STUB (just copied by the sync above on fresh installs) doesn't count.
# NOTE: GNU stat must be tried FIRST (-c). On Linux, BSD-style `stat -f '%m'`
# does not fail — it prints filesystem info — so the old `-f || -c` order
# returned garbage and crashed the arithmetic below under `set -u`.
LAST=$(stat -c '%Y' "$DASH_DIR/data-override.jsx" 2>/dev/null || stat -f '%m' "$DASH_DIR/data-override.jsx" 2>/dev/null)
if [ -n "${LAST:-}" ] && grep -q "^// Stub" "$DASH_DIR/data-override.jsx" 2>/dev/null; then
  LAST=""   # never actually refreshed
fi
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

# GNU first, BSD fallback — see the NOTE above.
stat_mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null; }

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

echo "TODAY=$TODAY"
echo "TOMORROW=$TOMORROW"
echo "NOW=$NOW_HHMM"
echo "WINDOW_DAYS=$WINDOW_DAYS"
echo "SINCE_WINDOW=$(since "$WINDOW_DAYS")"
echo "SINCE_1D=$(since 1)"
echo "SINCE_30D=$(since 30)"
echo "START_TS=$START_TS"
echo "TZNAME=$TZNAME"
echo "DATA_DIR=$DATA_DIR"
echo "DASH_DIR=$DASH_DIR"
echo "RUN_AGENTS=$RUN_AGENTS"
echo "SKIP_AGENTS=$SKIP_AGENTS"
echo "CONFIG=$CONFIG"
echo "BUNDLE=$BUNDLE"
echo "MCP_CALENDAR=$MCP_CALENDAR"
echo "MCP_GMAIL=$MCP_GMAIL"
echo "MCP_SLACK=$MCP_SLACK"
echo "MCP_DRIVE=$MCP_DRIVE"
echo "MCP_GRANOLA=$MCP_GRANOLA"
