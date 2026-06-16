#!/usr/bin/env bash
# slack-send-headless.sh — SEND a Slack message from a headless
# `claude -p --permission-mode bypassPermissions` subprocess, given a prompt file.
#
# WHAT THIS DOES
# --------------
# Backs serve.py's POST /slack-send, which a dashboard reply button can hit WITHOUT
# an interactive Claude Code session. It sends the message directly to the resolved
# channel/thread. Sending is irreversible, so the DASHBOARD guards against accidental
# fires up front: one-click "suggested reply" chips require a second confirming click
# before they ever reach this script (the compose box sends what you typed). This
# script itself does no extra confirming — by the time it runs, the send is intended.
#
# CAVEAT (same as the refresh button): claude.ai-managed connectors can be invisible
# to `claude -p`. If the send tool isn't reachable headlessly this prints SEND_FAIL and
# serve.py reports it, so the dashboard falls back to copy-to-clipboard + open Slack.
# For headless-capable Slack MCP setups it sends for real.
#
# Usage:  slack-send-headless.sh <prompt-file>
# Prints: a single line containing SEND_OK <where> or SEND_FAIL <reason>.
set -uo pipefail

PROMPT_FILE="${1:-}"
if [ -z "$PROMPT_FILE" ] || [ ! -f "$PROMPT_FILE" ]; then
  echo "SEND_FAIL missing prompt file" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "SEND_FAIL 'claude' CLI not found on PATH" >&2
  exit 1
fi

# cwd MUST NOT be inside ~/.claude (see refresh-headless.sh). Use a throwaway dir.
WORKDIR="$(mktemp -d 2>/dev/null || echo /tmp)"
cd "$WORKDIR" 2>/dev/null || cd /tmp

# --model sonnet: the task is mechanical (resolve channel, call the send tool, print
# one line). Pinning keeps it fast/cheap regardless of the user's default model.
OUT=$(claude -p \
        --model sonnet \
        --permission-mode bypassPermissions \
        --no-session-persistence < "$PROMPT_FILE" 2>&1)
status=$?

if [ -n "${WORKDIR:-}" ] && [ "$WORKDIR" != "/tmp" ]; then
  rm -rf "$WORKDIR" 2>/dev/null || true
fi

if [ "$status" -ne 0 ] && echo "$OUT" | grep -qi "bypass"; then
  echo "SEND_FAIL bypassPermissions not allowed (often org-managed). Use /dashboard-slack-send in an interactive session instead." >&2
  exit "$status"
fi

echo "$OUT"
exit "$status"
