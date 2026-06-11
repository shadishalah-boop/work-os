#!/usr/bin/env bash
# schedule.sh — install/uninstall the dashboard's scheduled auto-refresh.
#
# Usage:
#   bash schedule.sh install [--times "08:00 13:00 17:00"] [--serve [PORT]]
#   bash schedule.sh uninstall
#   bash schedule.sh status
#
# install   Schedules refresh-headless.sh at the given times on weekdays
#           (default: 08:00 and 13:00). macOS → launchd LaunchAgent;
#           Linux → crontab entries tagged "# work-os-dashboard".
#           --serve also starts a tiny localhost HTTP server for the dashboard
#           folder (macOS only) so the open tab can auto-reload itself —
#           Chrome blocks the reload poller on file:// pages.
# uninstall Removes everything install created.
# status    Shows what's currently scheduled and the last refresh log lines.
#
# The scheduled job runs in a login shell (-lc) so `claude` is on PATH, and
# appends to ~/.claude/dashboard-refresh.log.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DASH_DIR (and DATA_DIR, unused here)

REFRESH="$SCRIPT_DIR/refresh-headless.sh"
LOG="$HOME/.claude/dashboard-refresh.log"
LABEL="com.work-os.dashboard-refresh"
SERVE_LABEL="com.work-os.dashboard-serve"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVE_PLIST="$HOME/Library/LaunchAgents/$SERVE_LABEL.plist"
CRON_TAG="# work-os-dashboard"

CMD="${1:-status}"
shift || true

TIMES="08:00 13:00"
SERVE=""
SERVE_PORT=8787
while [ $# -gt 0 ]; do
  case "$1" in
    --times) TIMES="${2:?--times needs a value like \"08:00 13:00\"}"; shift 2 ;;
    --serve) SERVE=1; [ "${2:-}" != "" ] && [[ "${2:-}" =~ ^[0-9]+$ ]] && { SERVE_PORT="$2"; shift; }; shift ;;
    *) echo "schedule: unknown arg $1" >&2; exit 2 ;;
  esac
done

is_macos() { [ "$(uname -s)" = "Darwin" ]; }

validate_times() {
  for t in $TIMES; do
    [[ "$t" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "schedule: bad time '$t' (use HH:MM)" >&2; exit 2; }
  done
}

install_macos() {
  mkdir -p "$HOME/Library/LaunchAgents"
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>bash "$REFRESH" >> "$LOG" 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
EOF
    for t in $TIMES; do
      h=${t%%:*}; m=${t##*:}
      for wd in 1 2 3 4 5; do   # Mon-Fri
        printf '    <dict><key>Weekday</key><integer>%d</integer><key>Hour</key><integer>%d</integer><key>Minute</key><integer>%d</integer></dict>\n' "$wd" "$((10#$h))" "$((10#$m))"
      done
    done
    cat <<EOF
  </array>
</dict>
</plist>
EOF
  } > "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Scheduled: weekdays at $TIMES (launchd: $LABEL)"

  if [ -n "$SERVE" ]; then
    cat > "$SERVE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>-m</string>
    <string>http.server</string>
    <string>$SERVE_PORT</string>
    <string>--bind</string>
    <string>127.0.0.1</string>
    <string>--directory</string>
    <string>$DASH_DIR</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
    launchctl unload "$SERVE_PLIST" 2>/dev/null || true
    launchctl load "$SERVE_PLIST"
    echo "Serving:   http://localhost:$SERVE_PORT/Work%20Dashboard.html  (use this URL so the tab auto-reloads)"
  fi
}

install_linux() {
  command -v crontab >/dev/null 2>&1 || { echo "schedule: crontab not found" >&2; exit 1; }
  local lines=""
  for t in $TIMES; do
    h=${t%%:*}; m=${t##*:}
    lines="$lines$((10#$m)) $((10#$h)) * * 1-5 /bin/bash -lc 'bash \"$REFRESH\" >> \"$LOG\" 2>&1' $CRON_TAG
"
  done
  { crontab -l 2>/dev/null | grep -v "$CRON_TAG"; printf '%s' "$lines"; } | crontab -
  echo "Scheduled: weekdays at $TIMES (crontab, tagged '$CRON_TAG')"
  [ -n "$SERVE" ] && echo "Note: --serve is macOS-only; on Linux run: python3 -m http.server $SERVE_PORT --bind 127.0.0.1 --directory \"$DASH_DIR\""
}

uninstall_all() {
  if is_macos; then
    for p in "$PLIST" "$SERVE_PLIST"; do
      [ -f "$p" ] && { launchctl unload "$p" 2>/dev/null || true; rm -f "$p"; echo "Removed $(basename "$p")"; }
    done
  fi
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    crontab -l 2>/dev/null | grep -v "$CRON_TAG" | crontab -
    echo "Removed crontab entries"
  fi
  echo "Auto-refresh uninstalled."
}

status_all() {
  echo "— schedule —"
  if is_macos; then
    [ -f "$PLIST" ] && echo "launchd: $LABEL installed ($(launchctl list 2>/dev/null | grep -c "$LABEL" | sed 's/1/loaded/;s/0/NOT loaded/'))" || echo "launchd: not installed"
    [ -f "$SERVE_PLIST" ] && echo "server:  $SERVE_LABEL installed" || echo "server:  not installed"
  fi
  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep "$CRON_TAG" || true
  fi
  echo "— last refresh log lines ($LOG) —"
  tail -5 "$LOG" 2>/dev/null || echo "(no log yet)"
}

case "$CMD" in
  install)   validate_times; if is_macos; then install_macos; else install_linux; fi
             echo "Log: $LOG · check anytime with: bash $SCRIPT_DIR/schedule.sh status" ;;
  uninstall) uninstall_all ;;
  status)    status_all ;;
  *) echo "usage: schedule.sh install [--times \"HH:MM HH:MM\"] [--serve [PORT]] | uninstall | status" >&2; exit 2 ;;
esac
