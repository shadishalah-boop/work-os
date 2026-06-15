#!/usr/bin/env bash
# schedule.sh — manage the dashboard's background helpers:
#   • a PERMANENT localhost server, so the dashboard renders over http:// (not
#     file://, which makes the browser block Babel from loading the .jsx files →
#     blank page). This is required for the dashboard to display at all.
#   • OPTIONAL scheduled auto-refresh (weekday launchd/cron).
#
# Usage:
#   bash schedule.sh serve [PORT]                     # permanent localhost server (default 8787)
#   bash schedule.sh unserve                          # stop & remove the server
#   bash schedule.sh install [--times "08:00 13:00"]  # scheduled auto-refresh
#   bash schedule.sh uninstall                        # remove scheduled refresh AND server
#   bash schedule.sh status                           # show what's running + last refresh log
#
# macOS uses launchd LaunchAgents (persist across reboots). Linux uses crontab for
# refresh and a nohup background process for serving.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DASH_DIR, DATA_DIR

REFRESH="$SCRIPT_DIR/refresh-headless.sh"
LOG="$HOME/.claude/dashboard-refresh.log"
SERVE_LOG="$HOME/.claude/dashboard-serve.log"
LABEL="com.work-os.dashboard-refresh"
SERVE_LABEL="com.work-os.dashboard-serve"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVE_PLIST="$HOME/Library/LaunchAgents/$SERVE_LABEL.plist"
CRON_TAG="# work-os-dashboard"
DEFAULT_PORT=8787
PORTFILE="$HOME/.claude/dashboard-serve-port"

is_macos() { [ "$(uname -s)" = "Darwin" ]; }
pybin() { command -v python3 2>/dev/null || echo /usr/bin/python3; }
dash_url() { echo "http://localhost:${1}/Work%20Dashboard.html"; }

# --------------------------------------------------------------------------
# serve — permanent localhost server (the dashboard's display requirement)
# --------------------------------------------------------------------------
serve() {
  local port="${1:-$DEFAULT_PORT}"
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "serve: bad port '$port' (use a number)" >&2; exit 2; }
  mkdir -p "$DASH_DIR"
  echo "$port" > "$PORTFILE"

  if is_macos; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$SERVE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(pybin)</string>
    <string>-m</string><string>http.server</string><string>$port</string>
    <string>--bind</string><string>127.0.0.1</string>
    <string>--directory</string><string>$DASH_DIR</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$SERVE_LOG</string>
  <key>StandardOutPath</key><string>$SERVE_LOG</string>
</dict>
</plist>
EOF
    launchctl unload "$SERVE_PLIST" 2>/dev/null || true
    launchctl load "$SERVE_PLIST"
    echo "Permanent server running (launchd, survives reboot)."
  else
    pkill -f "http.server $port .*$DASH_DIR" 2>/dev/null || true
    nohup "$(pybin)" -m http.server "$port" --bind 127.0.0.1 --directory "$DASH_DIR" >"$SERVE_LOG" 2>&1 &
    echo "Server started (nohup). For reboot-persistence on Linux add a systemd user service or @reboot cron."
  fi
  echo "Open your dashboard at:"
  echo "  $(dash_url "$port")"
}

unserve() {
  if is_macos; then
    if [ -f "$SERVE_PLIST" ]; then
      launchctl unload "$SERVE_PLIST" 2>/dev/null || true
      rm -f "$SERVE_PLIST"
      echo "Server removed."
    else
      echo "No server installed."
    fi
  else
    local port; port="$(cat "$PORTFILE" 2>/dev/null || echo "$DEFAULT_PORT")"
    pkill -f "http.server $port" 2>/dev/null && echo "Server stopped." || echo "No server running."
  fi
}

# --------------------------------------------------------------------------
# install — scheduled auto-refresh (optional)
# --------------------------------------------------------------------------
install_macos_refresh() {
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
      for wd in 1 2 3 4 5; do
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
  echo "Scheduled refresh: weekdays at $TIMES (launchd)."
}

install_linux_refresh() {
  command -v crontab >/dev/null 2>&1 || { echo "schedule: crontab not found" >&2; exit 1; }
  local lines=""
  for t in $TIMES; do
    h=${t%%:*}; m=${t##*:}
    lines="$lines$((10#$m)) $((10#$h)) * * 1-5 /bin/bash -lc 'bash \"$REFRESH\" >> \"$LOG\" 2>&1' $CRON_TAG
"
  done
  { crontab -l 2>/dev/null | grep -v "$CRON_TAG"; printf '%s' "$lines"; } | crontab -
  echo "Scheduled refresh: weekdays at $TIMES (crontab)."
}

uninstall_all() {
  if is_macos; then
    for p in "$PLIST" "$SERVE_PLIST"; do
      [ -f "$p" ] && { launchctl unload "$p" 2>/dev/null || true; rm -f "$p"; echo "Removed $(basename "$p")"; }
    done
  else
    unserve
  fi
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    crontab -l 2>/dev/null | grep -v "$CRON_TAG" | crontab -
    echo "Removed crontab entries."
  fi
  echo "Background helpers removed."
}

status_all() {
  echo "— server —"
  if is_macos; then
    [ -f "$SERVE_PLIST" ] && echo "installed ($SERVE_LABEL)" || echo "not installed"
  fi
  [ -f "$PORTFILE" ] && echo "url: $(dash_url "$(cat "$PORTFILE")")"
  echo "— scheduled refresh —"
  if is_macos; then
    [ -f "$PLIST" ] && echo "installed ($LABEL)" || echo "not installed"
  fi
  command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep "$CRON_TAG" || true
  echo "— last refresh log ($LOG) —"
  tail -5 "$LOG" 2>/dev/null || echo "(no log yet)"
}

# --------------------------------------------------------------------------
CMD="${1:-status}"
shift || true

TIMES="08:00 13:00"
while [ $# -gt 0 ]; do
  case "$1" in
    --times) TIMES="${2:?--times needs a value like \"08:00 13:00\"}"; shift 2 ;;
    *) break ;;
  esac
done

case "$CMD" in
  serve)   serve "${1:-}" ;;
  unserve) unserve ;;
  install)
    for t in $TIMES; do
      [[ "$t" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "schedule: bad time '$t' (use HH:MM)" >&2; exit 2; }
    done
    if is_macos; then install_macos_refresh; else install_linux_refresh; fi
    echo "Log: $LOG · check with: bash $SCRIPT_DIR/schedule.sh status" ;;
  uninstall) uninstall_all ;;
  status)    status_all ;;
  *) echo "usage: schedule.sh serve [PORT] | unserve | install [--times \"HH:MM HH:MM\"] | uninstall | status" >&2; exit 2 ;;
esac
