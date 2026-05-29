#!/usr/bin/env bash
# slack-fetch.sh — fetches RAW Slack data for the dashboard-slack agent.
#
# Invoked as:  bash <skill-dir>/slack-fetch.sh <N>
#   <N> = lookback window in days (the orchestrator passes WINDOW_DAYS).
#
# Writes <dataCacheDir>/slack-raw.json containing token status, the active-channels
# scope set, and the raw search.messages matches for each radar query. The agent
# then READS that file, applies the scope filter + classification, and WRITES
# slack.json via the Write tool.
#
# Auth: a Slack user token (xoxp-…) with `search:read` scope, stored in the macOS
# keychain under the service name `slack_token`:
#     security add-generic-password -s slack_token -a "$USER" -w 'xoxp-...'
# (On non-macOS, replace the `security` call below with your secret store.)
#
# Why a committed script: Claude Code's permission matcher refuses to auto-approve
# Bash it can't statically parse (heredocs, $(...)). Moving all of that here means
# the agent never needs Bash at all — it just Reads the JSON this script produced.
set -uo pipefail

N="${1:-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DATA_DIR
mkdir -p "$DATA_DIR"
RAW="$DATA_DIR/slack-raw.json"
CACHE="$DATA_DIR/slack-active-channels.json"

# macOS keychain. Swap for your platform's secret store if not on macOS.
SLACK_TOKEN=$(security find-generic-password -s slack_token -w 2>/dev/null)
if [ -z "$SLACK_TOKEN" ]; then
  python3 - "$RAW" << 'PY'
import json, sys
json.dump({"tokenOk": False, "error": "no slack_token in keychain"},
          open(sys.argv[1], "w"), indent=2)
PY
  echo "NO_TOKEN"
  exit 0
fi

# Resolve the authed user's own Slack ID (for the agent's @-mention detection) —
# no need to hardcode it anywhere.
MY_USER_ID=$(curl -s -H "Authorization: Bearer $SLACK_TOKEN" "https://slack.com/api/auth.test" \
  | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('user_id',''))" 2>/dev/null)

search_messages() {
  local query="$1"; local count="${2:-50}"
  local q
  q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$query")
  curl -s -H "Authorization: Bearer $SLACK_TOKEN" \
    "https://slack.com/api/search.messages?query=$q&count=$count"
}

# Slack search.messages requires ABSOLUTE dates: `after:YYYY-MM-DD`. Relative forms
# like `after:30d` are Gmail/`newer_than` syntax and match NOTHING in Slack (returns
# total:0 with ok:true, no error). `since N` prints the calendar date N days ago.
# And the `me` actor is what `from:`/`to:` expect — the `<@U…>` mention encoding is
# the in-message rendering of a mention, not a search operator value.
since() { date -v-"${1}"d '+%Y-%m-%d' 2>/dev/null || date -d "-${1} days" '+%Y-%m-%d'; }

# --- active-channels scope set: 24h cache, else discover via search ---
ACTIVE_CHANNELS=""
if [ -f "$CACHE" ]; then
  cache_age=$(( $(date +%s) - $(stat -f '%m' "$CACHE" 2>/dev/null || stat -c '%Y' "$CACHE" 2>/dev/null) ))
  if [ "$cache_age" -lt 86400 ]; then
    ACTIVE_CHANNELS=$(python3 -c "import json; print(' '.join(json.load(open('$CACHE'))['channels']))" 2>/dev/null)
  fi
fi
if [ -z "$ACTIVE_CHANNELS" ]; then
  search_messages "from:me after:$(since 30)" 100 > /tmp/slack-discovery.json
  ACTIVE_CHANNELS=$(python3 - "$CACHE" << 'PY'
import json, datetime, sys
try:
    d = json.load(open("/tmp/slack-discovery.json"))
except Exception:
    print(""); raise SystemExit(0)
if not d.get("ok"):
    print(""); raise SystemExit(0)
matches = d.get("messages", {}).get("matches", [])
chans = sorted({m["channel"]["id"] for m in matches if m.get("channel", {}).get("id")})
json.dump({"channels": chans,
           "discoveredAt": datetime.datetime.now().astimezone().isoformat(),
           "ttlSeconds": 86400}, open(sys.argv[1], "w"), indent=2)
print(" ".join(chans))
PY
)
fi

# --- the radar queries (absolute dates via `since`, `me` actor) ---
search_messages "to:me after:$(since "$N")" 50      > /tmp/slack-tome.json
search_messages "from:me after:$(since 1) \"?\"" 50   > /tmp/slack-questions.json
search_messages "from:me after:$(since 1)" 50         > /tmp/slack-shipped.json
# Incident detection: `in:incident-` is not a real channel and Slack `in:` has no
# prefix wildcard, so search the keyword instead — the agent filters to high-signal
# incident channels by channel.name afterward.
search_messages "incident after:$(since "$N")" 30     > /tmp/slack-incident.json

# --- bundle raw matches for the agent to classify ---
python3 - "$RAW" "$ACTIVE_CHANNELS" "$MY_USER_ID" << 'PY'
import json, sys
raw_out = sys.argv[1]
active = sys.argv[2].split() if len(sys.argv) > 2 and sys.argv[2] else []
my_user_id = sys.argv[3] if len(sys.argv) > 3 else ""
def load(p):
    try:
        return json.load(open(p))
    except Exception:
        return {}
def matches(p):
    return load(p).get("messages", {}).get("matches", [])
bundle = {
    "tokenOk": True,
    "userId": my_user_id,
    "activeChannels": active,
    "scopeFallback": len(active) < 3,
    "toMe": matches("/tmp/slack-tome.json"),
    "questions": matches("/tmp/slack-questions.json"),
    "shipped": matches("/tmp/slack-shipped.json"),
    "incident": matches("/tmp/slack-incident.json"),
}
json.dump(bundle, open(raw_out, "w"), indent=2)
print("OK toMe=%d questions=%d shipped=%d incident=%d active=%d" % (
    len(bundle["toMe"]), len(bundle["questions"]),
    len(bundle["shipped"]), len(bundle["incident"]), len(active)))
PY

echo "DONE"
