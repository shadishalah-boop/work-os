#!/usr/bin/env bash
# slack-draft-headless.sh — stage a Slack DRAFT (never send) from a headless
# `claude -p --permission-mode bypassPermissions` subprocess, given a prompt file.
#
# WHY DRAFT-ONLY
# --------------
# This backs serve.py's POST /slack-send, which a dashboard reply button can hit
# WITHOUT an interactive Claude Code session. Sending is irreversible, so the
# button never sends: the worst case here is an unused draft sitting in Slack for
# you to discard. To actually send, review the draft in Slack and hit send, or use
# the /dashboard-slack-send skill in an interactive session (which confirms first).
#
# CAVEAT (same as the refresh button): claude.ai-managed connectors can be invisible
# to `claude -p`. If the draft tool isn't reachable headlessly this prints DRAFT_FAIL
# and serve.py reports it, so the dashboard falls back to copy-to-clipboard + open
# Slack. For headless-capable Slack MCP setups it stages a real draft.
#
# Usage:  slack-draft-headless.sh <prompt-file>
# Prints: a single line containing DRAFT_OK <where> or DRAFT_FAIL <reason>.
set -uo pipefail

PROMPT_FILE="${1:-}"
if [ -z "$PROMPT_FILE" ] || [ ! -f "$PROMPT_FILE" ]; then
  echo "DRAFT_FAIL missing prompt file" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "DRAFT_FAIL 'claude' CLI not found on PATH" >&2
  exit 1
fi

# cwd MUST NOT be inside ~/.claude (see refresh-headless.sh). Use a throwaway dir.
WORKDIR="$(mktemp -d 2>/dev/null || echo /tmp)"
cd "$WORKDIR" 2>/dev/null || cd /tmp

# --model sonnet: the task is mechanical (resolve channel, call the draft tool, print
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
  echo "DRAFT_FAIL bypassPermissions not allowed (often org-managed). Use /dashboard-slack-send in an interactive session instead." >&2
  exit "$status"
fi

echo "$OUT"
exit "$status"
