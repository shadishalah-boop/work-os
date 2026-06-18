#!/usr/bin/env bash
# refresh-headless.sh — run the ENTIRE dashboard refresh inside a headless
# `claude -p --permission-mode bypassPermissions` subprocess.
#
# WHY THIS EXISTS
# ---------------
# The per-agent refresh trips a manual permission prompt in an interactive session
# several INDEPENDENT ways, none of which an allowlist rule or `tools:` frontmatter
# can suppress:
#   (a) the Write tool guards every write under ~/.claude/ as a "sensitive file"
#       and prompts regardless of an allow rule;
#   (b) lightweight (haiku) agents shell out via `cat <<EOF` heredocs / `python3
#       <<EOF` / `cp` to do computation — unparseable by the static analyzer;
#   (c) overwrite-needs-Read Write fallbacks.
# NOTE (corrected): sub-agent `tools:` frontmatter DOES restrict tools in this
# runtime — and a sub-agent's ToolSearch is scoped to that allowlist. That's why
# every agent must list its connector tool names (incl. the claude_ai_-prefixed
# ones) explicitly. This headless path is DEPRECATED anyway: claude.ai-managed
# connectors are invisible to `claude -p`, so it fetches nothing. The live refresh
# runs in-session (see SKILL.md). Kept only for headless-capable MCP setups.
#
# The reliable fix: move the whole orchestration into a non-interactive subprocess
# where bypassPermissions runs it ungated. The interactive session then sees exactly
# ONE Bash call (this script), matched by the plugin's Bash allow rule, and never a
# permission prompt. MCP servers and user-scoped sub-agents load fine in `claude -p`
# (bypass-mode startup adds ~20s).
#
# Trust trade-off: the subprocess runs locally, as you, on your own data, only when
# you run /dashboard. Everything it does is your own committed code + your own MCP
# servers. Review headless-prompt.md and the scripts it calls before trusting it.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$SCRIPT_DIR/headless-prompt.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "refresh-headless: missing prompt file $PROMPT_FILE" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "refresh-headless: 'claude' CLI not found on PATH" >&2
  exit 1
fi

# cwd MUST NOT be inside ~/.claude — running there makes `claude -p` load a weird
# project scope. A throwaway tmp dir keeps it in clean user-level scope (where the
# agents + MCP servers are defined).
WORKDIR="$(mktemp -d 2>/dev/null || echo /tmp)"
cd "$WORKDIR" 2>/dev/null || cd /tmp

# The headless prompt references its sibling scripts via {{SKILL_DIR}}; substitute
# the resolved absolute path so the subprocess can find prep.sh / wait-and-merge.sh
# regardless of where the plugin is installed.
#
# --model sonnet: the orchestration is mechanical (run script, fan out, relay one
# line) — pinning it keeps refreshes fast and cheap regardless of the user's
# default model. Sub-agents still use their own frontmatter models.
# --output-format json (v0.14): gives us the run's token usage + cost in a structured
# envelope, so the dashboard's "Refresh done" banner can report how many tokens the
# refresh spent. The orchestrator's STEP 4 confirmation line comes back in `.result`.
ERRFILE="$(mktemp 2>/dev/null || echo "/tmp/refresh-headless.$$.err")"
RAW=$(sed "s|{{SKILL_DIR}}|$SCRIPT_DIR|g" "$PROMPT_FILE" \
  | claude -p \
      --model sonnet \
      --output-format json \
      --permission-mode bypassPermissions \
      --no-session-persistence 2>"$ERRFILE")
status=$?
ERR=$(cat "$ERRFILE" 2>/dev/null); rm -f "$ERRFILE" 2>/dev/null || true

if [ -n "${WORKDIR:-}" ] && [ "$WORKDIR" != "/tmp" ]; then
  rm -rf "$WORKDIR" 2>/dev/null || true
fi

if [ "$status" -ne 0 ] && printf '%s\n%s' "$RAW" "$ERR" | grep -qi "bypass"; then
  echo "refresh-headless: your Claude Code settings do not allow bypassPermissions" >&2
  echo "(often disabled by org-managed settings). The dashboard's zero-prompt refresh" >&2
  echo "needs it. Ask your admin about 'disableBypassPermissionsMode', or run the" >&2
  echo "refresh interactively and approve the prompts." >&2
  echo "--- original error: ---" >&2
  printf '%s\n%s\n' "$RAW" "$ERR" >&2
  exit "$status"
fi

# Print the orchestrator's confirmation line (from .result), then a machine-readable
# usage line that serve.py parses out for the banner. If the output isn't JSON (older
# CLI), pass it through verbatim so nothing is lost.
printf '%s' "$RAW" | python3 -c '
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    sys.stdout.write(raw)
    sys.exit(0)
text = (d.get("result") or d.get("text") or "").strip()
if text:
    print(text)
u = d.get("usage") or {}
tok = sum(int(u.get(k, 0) or 0) for k in (
    "input_tokens", "output_tokens",
    "cache_read_input_tokens", "cache_creation_input_tokens"))
cost = d.get("total_cost_usd")
cost_s = ("%.4f" % cost) if isinstance(cost, (int, float)) else ""
print("__REFRESH_USAGE__ tokens=%d cost=%s" % (tok, cost_s))
' 2>/dev/null || printf '%s\n' "$RAW"
exit "$status"
