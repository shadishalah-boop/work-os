# _config.sh — resolve per-user paths from ~/.claude/dashboard-config.local.
# Sourced (not executed) by the dashboard scripts. Sets DATA_DIR and DASH_DIR.
#
# The config file is created by the `dashboard-setup` skill and is NEVER bundled
# into the plugin (see .gitignore). All values fall back to sensible defaults so
# the scripts work even before setup has run.
CONFIG_FILE="$HOME/.claude/dashboard-config.local"

_cfg() {
  # _cfg <dotted.key> <default> — print the config value (expanduser'd) or default.
  python3 -c "
import json, os, sys
try:
    d = json.load(open(os.path.expanduser('$CONFIG_FILE')))
except Exception:
    d = {}
v = d
for k in sys.argv[1].split('.'):
    v = v.get(k) if isinstance(v, dict) else None
print(os.path.expanduser(v) if isinstance(v, str) and v else os.path.expanduser(sys.argv[2]))
" "$1" "$2"
}

DATA_DIR="$(_cfg output.dataCacheDir '~/.claude/dashboard-data')"
DASH_DIR="$(_cfg output.dashboardDir '~/Documents/work-dashboard')"
