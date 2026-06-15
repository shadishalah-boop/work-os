#!/usr/bin/env bash
# slack-prep.sh — prints the values the dashboard-slack agent needs when it runs
# in the INTERACTIVE session (not the headless subprocess).
#
# Why interactive: the Slack MCP's `slack_search_public_and_private` requires user
# consent, which a headless `claude -p` subprocess cannot give — so Slack is the one
# source fetched from the interactive `/dashboard` session. This script just emits
# the cache dir + absolute search dates + server/workspace names for the kickoff.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_config.sh"   # sets DATA_DIR
mkdir -p "$DATA_DIR"

since() { date -v-"${1}"d '+%Y-%m-%d' 2>/dev/null || date -d "-${1} days" '+%Y-%m-%d'; }

echo "DATA_DIR=$DATA_DIR"
echo "TODAY=$(date '+%Y-%m-%d')"
echo "SINCE_WINDOW=$(since 7)"
echo "SINCE_1D=$(since 1)"
echo "SINCE_30D=$(since 30)"
echo "MCP_SLACK=$(_cfg mcp.slack 'Slack')"
echo "WORKSPACE=$(_cfg slack.workspace '')"
echo "TZNAME=$(python3 "$SCRIPT_DIR/tzresolve.py" "$CONFIG_FILE" 2>/dev/null)"
