#!/usr/bin/env bash
# schedule.sh — manage the dashboard's background helpers:
#   • a PERMANENT localhost server (required so the page renders over http://).
#   • refresh REMINDERS at set times (a notification to run /dashboard) — the
#     realistic "auto-refresh" with claude.ai connectors, which a background job
#     can't fetch.
#   • OPTIONAL true scheduled refresh (only works with headless-capable connectors).
#
# Usage:
#   bash schedule.sh serve [PORT]                          # permanent localhost server (default 8787)
#   bash schedule.sh unserve                               # stop & remove the server
#   bash schedule.sh remind [--times "09:00 14:00 17:00"]  # notify at times to run /dashboard
#   bash schedule.sh unremind                              # remove reminders
#   bash schedule.sh install [--times "08:00 13:00"]       # headless auto-refresh (headless-capable connectors only)
#   bash schedule.sh uninstall                             # remove server + reminders + scheduled refresh
#   bash schedule.sh status                                # show what's running + last refresh log
#
# macOS uses launchd LaunchAgents (persist across reboots). Linux uses crontab +
# notify-send for reminders and a nohup process for serving.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DASH_DIR, DATA_DIR

REFRESH="$SCRIPT_DIR/refresh-headless.sh"
LOG="$HOME/.claude/dashboard-refresh.log"
SERVE_LOG="$HOME/.claude/dashboard-serve.log"
LABEL="com.work-os.dashboard-refresh"
SERVE_LABEL="com.work-os.dashboard-serve"
REMIND_LABEL="com.work-os.dashboard-remind"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVE_PLIST="$HOME/Library/LaunchAgents/$SERVE_LABEL.plist"
REMIND_PLIST="$HOME/Library/LaunchAgents/$REMIND_LABEL.plist"
CRON_TAG="# work-os-dashboard"
REMIND_CRON_TAG="# work-os-dashboard-remind"
DEFAULT_PORT=8787
DEFAULT_REMIND_TIMES="09:00 14:00 17:00"
PORTFILE="$HOME/.claude/dashboard-serve-port"
SERVE_VERSION_FILE="$HOME/.claude/dashboard-serve-version"

is_macos() { [ "$(uname -s)" = "Darwin" ]; }
pybin() { command -v python3 2>/dev/null || echo /usr/bin/python3; }
dash_url() { echo "http://localhost:${1}/Work%20Dashboard.html"; }
plugin_version() { python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version','0'))" "$SCRIPT_DIR/../../.claude-plugin/plugin.json" 2>/dev/null || echo 0; }

# --------------------------------------------------------------------------
# remind — notify at set times to run /dashboard.
# With claude.ai-managed connectors a background job can't fetch data, so we
# can't auto-refresh on a clock — instead we nudge the user to run /dashboard
# (which works in-session). macOS: launchd + osascript notification. Linux: cron
# + notify-send.
# --------------------------------------------------------------------------
NOTIFY_MSG="Time to refresh your Work Dashboard — run /dashboard in Claude Code."

remind() {
  local times="${1:-$DEFAULT_REMIND_TIMES}"
  for t in $times; do
    [[ "$t" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "remind: bad time '$t' (use HH:MM)" >&2; exit 2; }
  done
  if is_macos; then
    mkdir -p "$HOME/Library/LaunchAgents"
    {
      cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$REMIND_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>display notification "$NOTIFY_MSG" with title "Work Dashboard"</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
EOF
      for t in $times; do
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
    } > "$REMIND_PLIST"
    launchctl unload "$REMIND_PLIST" 2>/dev/null || true
    launchctl load "$REMIND_PLIST"
  else
    command -v crontab >/dev/null 2>&1 || { echo "remind: crontab not found" >&2; exit 1; }
    local lines=""
    for t in $times; do
      h=${t%%:*}; m=${t##*:}
      lines="$lines$((10#$m)) $((10#$h)) * * 1-5 notify-send 'Work Dashboard' '$NOTIFY_MSG' $REMIND_CRON_TAG
"
    done
    { crontab -l 2>/dev/null | grep -v "$REMIND_CRON_TAG"; printf '%s' "$lines"; } | crontab -
  fi
  echo "Reminders set: weekdays at $times → a notification to run /dashboard."
  echo "(With claude.ai connectors a background job can't fetch data, so this nudges"
  echo " you to refresh in-session rather than auto-fetching.)"
}

unremind() {
  if is_macos && [ -f "$REMIND_PLIST" ]; then
    launchctl unload "$REMIND_PLIST" 2>/dev/null || true; rm -f "$REMIND_PLIST"; echo "Reminders removed."
  elif command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "$REMIND_CRON_TAG"; then
    crontab -l 2>/dev/null | grep -v "$REMIND_CRON_TAG" | crontab -; echo "Reminders removed."
  else
    echo "No reminders installed."
  fi
}

# --------------------------------------------------------------------------
# serve — permanent localhost server (the dashboard's display requirement)
# --------------------------------------------------------------------------
# Warn if the dashboard lives in a macOS TCC-protected folder, where launchd
# processes are denied access (server returns 404 / refresh can't write).
tcc_check() {
  case "$DASH_DIR" in
    "$HOME/Documents"/*|"$HOME/Desktop"/*|"$HOME/Downloads"/*)
      echo "⚠️  WARNING: $DASH_DIR is in a macOS privacy-protected folder." >&2
      echo "   launchd (the permanent server + scheduled refresh) is blocked from" >&2
      echo "   reading it, so you'll get a blank/404 page. Move the dashboard out of" >&2
      echo "   Documents/Desktop/Downloads (set output.dashboardDir to" >&2
      echo "   ~/.claude/dashboard-os in ~/.claude/dashboard-config.local and re-run" >&2
      echo "   setup), or grant your terminal/launchd Full Disk Access." >&2
      ;;
  esac
}

serve() {
  local port="${1:-$DEFAULT_PORT}"
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "serve: bad port '$port' (use a number)" >&2; exit 2; }
  mkdir -p "$DASH_DIR"
  echo "$port" > "$PORTFILE"
  plugin_version > "$SERVE_VERSION_FILE"   # record which serve.py is now running
  is_macos && tcc_check

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
    <string>$SCRIPT_DIR/serve.py</string>
    <string>$port</string>
    <string>$DASH_DIR</string>
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
    echo "Permanent server running (launchd, survives reboot) — with one-press /refresh."
  else
    pkill -f "serve.py $port" 2>/dev/null || true
    nohup "$(pybin)" "$SCRIPT_DIR/serve.py" "$port" "$DASH_DIR" >"$SERVE_LOG" 2>&1 &
    echo "Server started (nohup) — with one-press /refresh."
  fi
  echo "Open your dashboard at:"
  echo "  $(dash_url "$port")"

  # Validate the launchd server can actually read DASH_DIR (catches TCC denial,
  # which serves 404 even though the files exist). Give it a moment to bind.
  if command -v curl >/dev/null 2>&1; then
    sleep 1
    code=$(curl -s -o /dev/null -w '%{http_code}' "$(dash_url "$port")" 2>/dev/null || echo 000)
    if [ "$code" != "200" ]; then
      echo "" >&2
      echo "⚠️  Server is up but returned HTTP $code for the dashboard." >&2
      if is_macos; then
        echo "   On macOS this is almost always TCC privacy protection denying launchd" >&2
        echo "   access to $DASH_DIR. Move the bundle to ~/.claude/dashboard-os (out of" >&2
        echo "   Documents/Desktop/Downloads) and re-run, or grant Full Disk Access." >&2
      else
        echo "   Check that $DASH_DIR exists and contains 'Work Dashboard.html'." >&2
      fi
    else
      echo "Verified: server returns HTTP 200. ✅"
    fi
  fi
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
    for p in "$PLIST" "$SERVE_PLIST" "$REMIND_PLIST"; do
      [ -f "$p" ] && { launchctl unload "$p" 2>/dev/null || true; rm -f "$p"; echo "Removed $(basename "$p")"; }
    done
  else
    unserve
  fi
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qE "$CRON_TAG|$REMIND_CRON_TAG"; then
    crontab -l 2>/dev/null | grep -vE "$CRON_TAG|$REMIND_CRON_TAG" | crontab -
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
  echo "— refresh reminders —"
  if is_macos; then
    [ -f "$REMIND_PLIST" ] && echo "installed ($REMIND_LABEL)" || echo "not installed"
  fi
  command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep "$REMIND_CRON_TAG" || true
  echo "— scheduled refresh (headless; only for headless-capable connectors) —"
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

TIMES="08:00 13:00"   # default for `install`
TIMES_SET=""          # set only if the user passed --times (so `remind` can use its own default)
while [ $# -gt 0 ]; do
  case "$1" in
    --times) TIMES="${2:?--times needs a value like \"09:00 14:00 17:00\"}"; TIMES_SET="$2"; shift 2 ;;
    *) break ;;
  esac
done

case "$CMD" in
  serve)    serve "${1:-}" ;;
  unserve)  unserve ;;
  remind)   remind "${TIMES_SET:-}" ;;
  unremind) unremind ;;
  install)
    for t in $TIMES; do
      [[ "$t" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "schedule: bad time '$t' (use HH:MM)" >&2; exit 2; }
    done
    if is_macos; then install_macos_refresh; else install_linux_refresh; fi
    echo "Log: $LOG · check with: bash $SCRIPT_DIR/schedule.sh status" ;;
  uninstall) uninstall_all ;;
  status)    status_all ;;
  *) echo "usage: schedule.sh serve [PORT] | unserve | remind [--times \"09:00 14:00 17:00\"] | unremind | install [--times \"...\"] | uninstall | status" >&2; exit 2 ;;
esac
