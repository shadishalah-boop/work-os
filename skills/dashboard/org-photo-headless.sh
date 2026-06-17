#!/usr/bin/env bash
# org-photo-headless.sh — turn a screenshot of a Personio (or any) team / org chart
# into structured people JSON, via a headless `claude -p --permission-mode
# bypassPermissions` subprocess that READS the image with its vision capability.
#
# Backs serve.py's POST /import-org-photo, so the "Your people" card can accept a
# dropped org-chart image and populate the team WITHOUT an interactive session — the
# same headless mechanism as the refresh button.
#
# Usage:  org-photo-headless.sh <image-file>
# Prints: a JSON array of people on stdout (and nothing else, ideally):
#   [{"name","role","group","status"}]   status ∈ "in" | "ooo" | "onboarding"
set -uo pipefail

IMG="${1:-}"
if [ -z "$IMG" ] || [ ! -f "$IMG" ]; then
  echo "org-photo: missing image file" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "org-photo: 'claude' CLI not found on PATH" >&2
  exit 1
fi

# cwd must not be inside ~/.claude (see refresh-headless.sh). Throwaway dir.
WORKDIR="$(mktemp -d 2>/dev/null || echo /tmp)"
cd "$WORKDIR" 2>/dev/null || cd /tmp

read -r -d '' PROMPT <<EOF || true
Read the image file at this exact path: ${IMG}

It is a screenshot of a team org chart or people directory (e.g. from Personio).
Extract EVERY person shown. For each, capture:
  - name  : their full name (required; skip any card with no readable name)
  - role  : their job title / position (e.g. "Chief Technical Officer")
  - group : the team/department/section they sit in (e.g. "Leadership", "B2B",
            "People") — use "" if not shown
  - status: "onboarding" if the card is tagged Onboarding/New; "ooo" if it shows
            Out of Office/On leave; otherwise "in"

Output ONLY a JSON array, no prose, no markdown fences. Example:
[{"name":"Jordan Lee","role":"VP Engineering","group":"Leadership","status":"in"}]
If you cannot read any people, output exactly: []
EOF

OUT=$(claude -p "$PROMPT" \
        --permission-mode bypassPermissions \
        --no-session-persistence 2>&1)
status=$?

if [ -n "${WORKDIR:-}" ] && [ "$WORKDIR" != "/tmp" ]; then
  rm -rf "$WORKDIR" 2>/dev/null || true
fi

if [ "$status" -ne 0 ] && echo "$OUT" | grep -qi "bypass"; then
  echo "org-photo: bypassPermissions not allowed (often org-managed) — can't parse the photo headlessly. Add your team via /dashboard instead." >&2
  exit "$status"
fi

echo "$OUT"
exit "$status"
