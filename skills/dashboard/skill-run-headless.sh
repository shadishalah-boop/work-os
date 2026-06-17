#!/usr/bin/env bash
# skill-run-headless.sh — run a Claude Code skill/command from a headless
# `claude -p --permission-mode bypassPermissions` subprocess, given a prompt file.
#
# Backs serve.py's POST /run-skill, so a skill listed in the dashboard's left rail can be
# launched with one click WITHOUT an interactive Claude Code session — the SAME mechanism
# as the dashboard's refresh button (refresh-headless.sh). The prompt file holds the skill
# invocation (typically a slash command like "/my-skill args", or "Use the my-skill skill
# to …"). bypassPermissions runs it ungated; --no-session-persistence keeps it clean.
#
# CAVEAT (same as the refresh button): a headless `claude -p` can't see claude.ai-managed
# connectors, so a skill that needs one may not have it. Skills that are self-contained
# (local compute, files, or MCPs that load headlessly) work fine.
#
# Usage:  skill-run-headless.sh <prompt-file>
# Prints: the skill's output (the orchestrator/serve.py relays the last line).
set -uo pipefail

PROMPT_FILE="${1:-}"
if [ -z "$PROMPT_FILE" ] || [ ! -f "$PROMPT_FILE" ]; then
  echo "skill-run: missing prompt file" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "skill-run: 'claude' CLI not found on PATH" >&2
  exit 1
fi

# cwd MUST NOT be inside ~/.claude (see refresh-headless.sh). Use a throwaway dir.
WORKDIR="$(mktemp -d 2>/dev/null || echo /tmp)"
cd "$WORKDIR" 2>/dev/null || cd /tmp

OUT=$(claude -p \
        --permission-mode bypassPermissions \
        --no-session-persistence < "$PROMPT_FILE" 2>&1)
status=$?

if [ -n "${WORKDIR:-}" ] && [ "$WORKDIR" != "/tmp" ]; then
  rm -rf "$WORKDIR" 2>/dev/null || true
fi

if [ "$status" -ne 0 ] && echo "$OUT" | grep -qi "bypass"; then
  echo "skill-run: bypassPermissions not allowed (often org-managed) — can't run skills headlessly. Run the skill in an interactive Claude Code session instead." >&2
  exit "$status"
fi

echo "$OUT"
exit "$status"
