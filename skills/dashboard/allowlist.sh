#!/usr/bin/env bash
# allowlist.sh — pre-approve the dashboard's tools so /dashboard refreshes don't
# prompt. Merges permission allow-rules into ~/.claude/settings.json (idempotent).
#
# It grants exactly what the refresh uses — the read-only connector search/list
# tools (both bare and claude.ai-managed `claude_ai_` names) and this plugin's own
# scripts — nothing else. Review the rules it prints. Re-runnable safely.
#
# Note: Claude Code reads permissions at session start, so newly-added rules take
# effect in your NEXT session (the current one may still prompt once).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"

# Version-independent glob for this plugin's scripts dir:
#   ~/.claude/plugins/cache/work-os/work-os/<version>/skills/dashboard
# → match any <version> so the rule survives plugin updates.
PKGROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"        # .../<version>
PKGROOT="$(dirname "$PKGROOT")"                   # .../work-os (name dir)
BASH_PREFIX="bash ${PKGROOT}/*/skills/dashboard/"

python3 - "$SETTINGS" "$BASH_PREFIX" <<'PY'
import json, os, sys

settings_path, bash_prefix = sys.argv[1], sys.argv[2]
try:
    cfg = json.load(open(os.path.expanduser(settings_path)))
    if not isinstance(cfg, dict):
        cfg = {}
except Exception:
    cfg = {}

perms = cfg.setdefault("permissions", {})
allow = perms.setdefault("allow", [])
if not isinstance(allow, list):
    allow = perms["allow"] = []

# Read-only connector tools the agents use, under both naming schemes.
servers = {
    "Google_Calendar": ["list_events", "list_calendars", "suggest_time"],
    "Gmail":           ["search_threads", "get_thread"],
    "Granola":         ["list_meetings", "get_meetings"],
    "Google_Drive":    ["list_recent_files", "search_files"],
    "Slack":           ["slack_search_public_and_private", "slack_search_public"],
}
rules = []
for prefix in ("claude_ai_", ""):
    for srv, tools in servers.items():
        for t in tools:
            rules.append(f"mcp__{prefix}{srv}__{t}")
# This plugin's own scripts (version-globbed so updates don't re-prompt).
rules.append(f"Bash({bash_prefix}:*)")

added = [r for r in rules if r not in allow]
allow.extend(added)

os.makedirs(os.path.dirname(os.path.expanduser(settings_path)), exist_ok=True)
with open(os.path.expanduser(settings_path), "w") as f:
    json.dump(cfg, f, indent=2)

print(f"Pre-approved {len(added)} rule(s) (skipped {len(rules)-len(added)} already present).")
for r in added:
    print(f"  + {r}")
PY

echo ""
echo "Done. From your NEXT Claude Code session, /dashboard refreshes won't prompt"
echo "for these connectors or scripts. (Settings: $SETTINGS)"
