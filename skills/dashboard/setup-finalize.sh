#!/usr/bin/env bash
# setup-finalize.sh <config-json-path>
#
# Does ALL of setup's filesystem side-effects in ONE statically-analyzable call,
# so the interactive session sees a single `bash setup-finalize.sh ...` command
# (allowlistable with "don't ask again") instead of several un-analyzable heredocs
# that each trigger a permission prompt.
#
# Reads the gathered config from the JSON at $1 and:
#   1. backs up any existing ~/.claude/dashboard-config.local
#   2. writes the new config there
#   3. creates the dashboard + data dirs
#   4. copies the static bundle and stamps the plugin version
#   5. creates ~/.claude/dashboard-filters.local from the template if missing
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="${1:?usage: setup-finalize.sh <config-json>}"

[ -f "$SRC" ] || { echo "setup-finalize: config json not found: $SRC" >&2; exit 1; }
# Refuse to write a malformed config (would silently fall back to all-defaults).
python3 -m json.tool "$SRC" >/dev/null 2>&1 || { echo "setup-finalize: $SRC is not valid JSON" >&2; exit 1; }

CFG="$HOME/.claude/dashboard-config.local"
mkdir -p "$HOME/.claude"
[ -f "$CFG" ] && cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
cp "$SRC" "$CFG"

DASH=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('$CFG')));print(os.path.expanduser(d.get('output',{}).get('dashboardDir','~/.claude/dashboard-os')))")
DATA=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('$CFG')));print(os.path.expanduser(d.get('output',{}).get('dataCacheDir','~/.claude/dashboard-data')))")
mkdir -p "$DASH" "$DATA"

cp -R "$PLUGIN_DIR/public/." "$DASH/"
VER=$(python3 -c "import json;print(json.load(open('$PLUGIN_DIR/.claude-plugin/plugin.json'))['version'])" 2>/dev/null || echo 0)
echo "$VER" > "$DASH/.bundle-version"

FILTERS="$HOME/.claude/dashboard-filters.local"
if [ ! -f "$FILTERS" ] && [ -f "$PLUGIN_DIR/templates/dashboard-filters.local.example" ]; then
  cp "$PLUGIN_DIR/templates/dashboard-filters.local.example" "$FILTERS"
fi

# Manual task list — start empty (the template carries samples; we don't want those
# showing as real tasks). The user fills it via the dashboard-task skill or by editing.
TASKS="$HOME/.claude/dashboard-tasks.local"
[ -f "$TASKS" ] || printf '{\n  "tasks": []\n}\n' > "$TASKS"

echo "OK · config=$CFG · dashboardDir=$DASH · dataCacheDir=$DATA · version=$VER"
