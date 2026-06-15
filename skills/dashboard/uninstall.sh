#!/usr/bin/env bash
# uninstall.sh — remove the dashboard's LOCAL footprint (background server,
# scheduled refresh, and optionally your data). Does NOT remove the plugin code
# itself — for that run:  claude plugin uninstall work-os@work-os
#
# Usage:
#   bash uninstall.sh           # stop the server + scheduled refresh; KEEP your files
#   bash uninstall.sh --purge   # also delete the dashboard folder, data cache, and
#                               # config — but back everything up to a tarball first
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DASH_DIR, DATA_DIR

PURGE=""
[ "${1:-}" = "--purge" ] && PURGE=1

# 1. Stop background helpers (server + scheduled refresh).
bash "$SCRIPT_DIR/schedule.sh" uninstall || true

if [ -n "$PURGE" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  BAK="$HOME/work-os-uninstall-backup-$STAMP"
  mkdir -p "$BAK"
  [ -f "$HOME/.claude/dashboard-config.local" ]  && cp "$HOME/.claude/dashboard-config.local"  "$BAK/" 2>/dev/null || true
  [ -f "$HOME/.claude/dashboard-filters.local" ] && cp "$HOME/.claude/dashboard-filters.local" "$BAK/" 2>/dev/null || true
  [ -d "$DASH_DIR" ] && cp -R "$DASH_DIR" "$BAK/dashboard-bundle" 2>/dev/null || true
  [ -d "$DATA_DIR" ] && cp -R "$DATA_DIR" "$BAK/dashboard-data"   2>/dev/null || true
  tar -czf "$BAK.tar.gz" -C "$BAK" . 2>/dev/null && rm -rf "$BAK" || true

  rm -rf "$DASH_DIR" "$DATA_DIR" 2>/dev/null || true
  rm -f "$HOME/.claude/dashboard-config.local" "$HOME/.claude/dashboard-filters.local" 2>/dev/null || true
  rm -f "$HOME/.claude/dashboard-serve-port" 2>/dev/null || true
  echo ""
  echo "Purged the dashboard's files. Safety backup: $BAK.tar.gz"
else
  echo ""
  echo "Removed background helpers. Your config and dashboard files are untouched."
  echo "(Re-run with --purge to also delete them, with a backup.)"
fi

echo ""
echo "Last step — remove the plugin itself in a terminal:"
echo "  claude plugin uninstall work-os@work-os"
echo "(If that subcommand name differs in your version, run 'claude plugin --help'.)"
