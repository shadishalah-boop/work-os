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
#   TODAY, TOMORROW, NOW (HH:MM), WINDOW_DAYS, SINCE_ISO, SINCE_EPOCH, SINCE_WINDOW,
#   SINCE_1D, SINCE_30D, START_TS, TZNAME, DATA_DIR, DASH_DIR, RUN_AGENTS, SKIP_AGENTS,
#   CONFIG, BUNDLE, MCP_CALENDAR, MCP_GMAIL, MCP_SLACK, MCP_DRIVE, MCP_GRANOLA
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

# User timezone — resolved LIVE every refresh: an explicit config value pins a
# fixed zone, otherwise the system zone is auto-detected (so a traveling user's
# times follow their laptop). Single source of truth: tzresolve.py.
TZNAME="$(python3 "$SCRIPT_DIR/tzresolve.py" "$CONFIG_FILE" 2>/dev/null)"
[ -z "$TZNAME" ] && TZNAME="UTC"

# Per-source MCP server names from config (defaults = the standard managed
# connectors most users already have).
MCP_CALENDAR="$(_cfg mcp.calendar 'Google_Calendar')"
MCP_GMAIL="$(_cfg mcp.gmail 'Gmail')"
MCP_SLACK="$(_cfg mcp.slack 'Slack')"
MCP_DRIVE="$(_cfg mcp.drive 'Google_Drive')"
MCP_GRANOLA="$(_cfg mcp.granola 'Granola')"
MCP_ZOOM="$(_cfg mcp.zoom 'Zoom_for_Claude')"
MCP_LOOKER="$(_cfg mcp.looker 'Looker')"
MCP_SNOWFLAKE="$(_cfg mcp.snowflake 'Snowflake')"

# --- Custom metrics: are there any definitions to fetch? ----------------------
# Definitions live in dashboard-metrics.local.json (the editor writes it) or the
# config's metrics.items. HAS_METRICS tells the orchestrator whether to run the
# metrics agent at all.
METRICS_DEFS="$HOME/.claude/dashboard-metrics.local.json"
HAS_METRICS=no
if [ -f "$METRICS_DEFS" ] && python3 -c "import json,sys; sys.exit(0 if (json.load(open(sys.argv[1])).get('items')) else 1)" "$METRICS_DEFS" 2>/dev/null; then
  HAS_METRICS=yes
elif [ -f "$CONFIG_FILE" ] && python3 -c "import json,sys; sys.exit(0 if ((json.load(open(sys.argv[1])).get('metrics') or {}).get('items')) else 1)" "$CONFIG_FILE" 2>/dev/null; then
  HAS_METRICS=yes
fi

# --- Lookback cutoff: the EXACT last-refresh time when recent, else a bounded window.
# This is the efficiency core (v0.14): each refresh only looks at what arrived since
# the previous one — the source history before that can't have changed, so re-fetching
# it just burns tokens. Rules:
#   • never refreshed (fresh install)   → 14 days   (one-time backfill so it's not empty)
#   • last refresh was > 7 days ago     → 7 days    (bounded catch-up after a long gap)
#   • otherwise                         → the exact last-refresh timestamp (down to the minute)
# LAST = mtime of data-override.jsx, written only on a COMPLETE refresh. The bundled
# STUB (just copied by the sync above on fresh installs) doesn't count as a refresh.
# NOTE: GNU stat must be tried FIRST (-c). On Linux, BSD-style `stat -f '%m'`
# does not fail — it prints filesystem info — so the old `-f || -c` order
# returned garbage and crashed the arithmetic below under `set -u`.
LAST=$(stat -c '%Y' "$DASH_DIR/data-override.jsx" 2>/dev/null || stat -f '%m' "$DASH_DIR/data-override.jsx" 2>/dev/null)
if [ -n "${LAST:-}" ] && grep -q "^// Stub" "$DASH_DIR/data-override.jsx" 2>/dev/null; then
  LAST=""   # never actually refreshed
fi
if [ -z "${LAST:-}" ]; then
  SINCE_TS=$(( START_TS - 14 * 86400 ))   # fresh install → 14-day backfill
  WINDOW_DAYS=14
else
  AGE=$(( START_TS - LAST ))
  if [ "$AGE" -gt $(( 7 * 86400 )) ]; then
    SINCE_TS=$(( START_TS - 7 * 86400 ))  # long gap → cap catch-up at 7 days
    WINDOW_DAYS=7
  else
    SINCE_TS=$LAST                         # normal case → exact last-refresh moment
    WINDOW_DAYS=$(( (AGE + 86399) / 86400 ))
    [ "$WINDOW_DAYS" -lt 1 ] && WINDOW_DAYS=1
  fi
fi
SINCE_EPOCH=$SINCE_TS
# RFC3339 (UTC) for APIs that filter on a full timestamp (Drive modifiedTime); and the
# plain date for day-granularity searches (Slack/Granola/Gmail `after:`).
SINCE_ISO=$(date -u -r "$SINCE_TS" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "@$SINCE_TS" '+%Y-%m-%dT%H:%M:%SZ')
SINCE_DAY=$(date -r "$SINCE_TS" '+%Y-%m-%d' 2>/dev/null || date -d "@$SINCE_TS" '+%Y-%m-%d')

# --- Per-agent TTL (same-day cache). Live agents always run; slow ones reuse JSON. ---
# NOTE: slack is NOT in this loop — it's fetched inline by the MAIN interactive
# session in Step 2 of SKILL.md (its MCP search needs user consent a sub-agent
# can't give). But slack.json IS pre-deleted below (unconditionally), so the
# inline Step 2 Write is a clean CREATE instead of the wasteful Read+Write
# overwrite fallback.
ttl_for_agent() {
  case "$1" in
    gmail)                echo 0     ;;  # always run (incremental + haiku → cheap)
    calendar)             echo 1800  ;;  # 30m — events don't change minute-to-minute (v0.14)
    granola)              echo 7200  ;;  # 2h
    wellness)             echo 14400 ;;  # 4h
    drive)                echo 28800 ;;  # 8h — recent-files index is slow to go stale (v0.14)
  esac
}

stat_mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null; }

RUN_AGENTS=""
SKIP_AGENTS=""
for agent in calendar granola gmail drive wellness; do
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
#
# EXCEPTION (v0.14): gmail + granola refresh INCREMENTALLY — they read their prior
# JSON, add only what's new since SINCE, and write the merged result. Their file must
# survive so there's something to merge into; they Read-then-Write (no prompt).
for agent in $RUN_AGENTS; do
  case "$agent" in
    drive)         rm -f "$DATA_DIR/drive-raw.json" ;;  # drive writes drive-raw.json
    gmail|granola) : ;;                                 # incremental — keep prior JSON to merge into
    *)             rm -f "$DATA_DIR/${agent}.json"  ;;
  esac
done
# Slack runs inline in Step 2 — pre-delete so the main session's Write is a clean
# CREATE (avoids the Read+Write overwrite fallback that costs an extra tool call).
rm -f "$DATA_DIR/slack.json"

echo "TODAY=$TODAY"
echo "TOMORROW=$TOMORROW"
echo "NOW=$NOW_HHMM"
echo "WINDOW_DAYS=$WINDOW_DAYS"
echo "SINCE_ISO=$SINCE_ISO"
echo "SINCE_EPOCH=$SINCE_EPOCH"
echo "SINCE_WINDOW=$SINCE_DAY"
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
echo "MCP_ZOOM=$MCP_ZOOM"
echo "MCP_LOOKER=$MCP_LOOKER"
echo "MCP_SNOWFLAKE=$MCP_SNOWFLAKE"
echo "METRICS_DEFS=$METRICS_DEFS"
echo "HAS_METRICS=$HAS_METRICS"
