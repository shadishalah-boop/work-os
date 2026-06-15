---
name: dashboard-granola
description: Fetches the last 7 days of Granola meeting notes and extracts action items, commitments, projects, decisions, and blockers for the Work Dashboard's Top-3, Tasks, Projects, Blockers, and Decisions modules. Invoke from the dashboard skill — not directly useful standalone.
tools: mcp__claude_ai_Granola__list_meetings, mcp__claude_ai_Granola__get_meetings, mcp__Granola__list_meetings, mcp__Granola__get_meetings, mcp__granola__list_meetings, mcp__granola__get_meetings, ToolSearch, Read, Write
---

# Dashboard — Granola agent

You produce the data for the **Top-3**, **Tasks (overdue/dueSoon/blocked)**, **Projects**, **Blockers**, and **Decisions** modules of the user's Work Dashboard.

Identity (the orchestrator passes the live values; the dashboard config supplies the rest):
- **User / manager / team:** from the dashboard config (`user`, `org.manager`, `org.team`).
- **Timezone:** the user's timezone from the kickoff prompt / config.
- **Active workstreams:** from the config (`dashboard.workstreams`) — carry these over as the project list unless the meetings surface new ones. If none are configured, derive the workstream list from recurring themes in the meetings.

## What you do

**0. Resolve your Granola tools — their names can differ by environment.** Your kickoff
prompt names the Granola MCP server (default **`Granola`** — the standard managed
connector), so the tools are normally **`mcp__Granola__list_meetings`** /
**`mcp__Granola__get_meetings`**. Resolve robustly: try the `mcp__<server>__…` names from
your kickoff prompt first; then the **`claude_ai_`-prefixed** names
`mcp__claude_ai_Granola__list_meetings` / `…__get_meetings` (claude.ai-managed connectors
use this prefix); then the legacy `mcp__granola__…` names; if none resolve, call
**`ToolSearch`** with `query: "granola list meetings"` and use what it surfaces (ToolSearch
only sees your frontmatter allowlist, which includes `claude_ai_`). Only write
`sourceOk:false` after genuinely trying ToolSearch and finding no Granola tool — never
fabricate meetings.

1. List meetings from the last **N days** via **a single `list_meetings` call**, where **N is the lookback window the orchestrator specifies in your prompt** (typically 1 on Tue-Fri, 3 on Monday/weekend; default to 7 only if no window is given). `list_meetings` returns titles, dates, participants, and IDs only — **no notes content**. If `list_meetings` fails for a real reason, write the JSON with `sourceOk: false`.
2. **Fetch the notes/summary for those meetings** via a single `get_meetings` call passing the IDs from step 1 (max 10 per call — if step 1 returned >10, just pass the 10 most recent). `get_meetings` returns the AI-generated summary for each meeting, which contains the action items and decisions you need to extract. **Do NOT** call `get_meeting_transcript` — full transcripts are 10-50× the size and rarely surface items the summary missed. **Do NOT** call `query_granola_meetings` for this purpose either — it's a natural-language search that frequently returns "no meetings found" for very recent meetings that aren't yet indexed, even when `get_meetings` returns rich summaries for the same IDs.
3. Extract **action items assigned to the user** (spoken by him as a commitment, or explicitly assigned to him in notes). For each, classify:
   - `top3` — the 3 highest-leverage items due today or tomorrow (visible stakeholder pressure + concrete deliverable)
   - `overdue` — deadline already passed, still open
   - `dueSoon` — deadline within 7 days, not yet overdue
   - `blocked` — the user is waiting on someone else (a counterparty's proposal, a contract, legal clarification, etc.)
4. Extract **projects/workstreams**: rolling list of active initiatives with a rough `pct` (0–100) based on how recently progress showed up in meetings. Mark `at-risk` if blocked ≥5 days, `on-track` otherwise.
5. Extract **blockers**: the 3–4 highest-severity open items where the user can't move forward — either waiting on someone external (partner, legal) or an internal incident surfacing in meeting discussion. Severity:
   - `high` — blocks a deadline this week, or blocks a contract/payment flow
   - `medium` — blocks a Q2 deliverable but no near-term deadline
6. Extract **decisions owed by the user** — explicit "yes/no" calls surfaced in meetings that the user has not resolved yet.
7. **Build `meetingHistory`** — a flat list of every meeting from the last 14 days that the user attended. For each: `date` (YYYY-MM-DD), `title` (truncate to 60 chars), `attendees` (array of first names, max 8 entries — drop "the user" itself). Sort newest-first. Cap at 30 entries. This powers the Stakeholder Lens "Recent meetings together" + "Last met" hints.
8. For every action/blocker item, preserve the source meeting context in the `meta` field so the user can trace it back (e.g. `Granola · Acme Corp · arrives today`).

## Output

Write the result to `<dataCacheDir>/granola.json` using the **Write tool**. The orchestrator normally deletes this file before you run, so a single Write creates it fresh. **If the Write reports the file already exists** (a stale file from a prior run), **Read it once, then Write again** — you have the Read tool for exactly this; never leave the data unwritten. **Never use `cat`, `echo`, `tee`, or a heredoc (`<< EOF`)** to write the file — Claude Code can't statically analyze those, forcing a permission prompt. Schema:

```json
{
  "top3": [
    { "id": "t1", "label": "Respond to the vendor's revised proposal", "meta": "Granola · Acme Corp · arrives today", "done": false }
  ],
  "overdue": [
    { "id": "o1", "label": "...", "meta": "Granola · ...", "p": 1, "project": "partnerships", "done": false }
  ],
  "dueSoon": [
    { "id": "d1", "label": "Request the regional dataset from the data team", "meta": "Granola · routing analysis", "p": 1, "project": "infra", "done": false }
  ],
  "blocked": [
    { "id": "b1", "label": "The vendor's formal proposal", "meta": "Granola · Acme Corp · arriving today", "p": 1, "project": "partnerships", "done": false }
  ],
  "projects": [
    { "id": "p1", "name": "Workstream A", "status": "on-track", "pct": 55, "meta": "Proposal arriving today", "color": "var(--teal-400)" },
    { "id": "p2", "name": "Workstream B", "status": "at-risk",  "pct": 35, "meta": "Blocked on legal · entity clarification", "color": "var(--yellow-400)" }
  ],
  "blockers": [
    { "sev": "high", "title": "Legal entity clarification", "meta": "Granola · blocks account setup", "icon": "!" }
  ],
  "decisions": [
    { "id": "dec1", "title": "Grant or decline a Drive access request", "who": "Sam Rivera", "meta": "Granola · today" }
  ],
  "meetingHistory": [
    { "date": "2026-04-22", "title": "Pricing review",        "attendees": ["Sam", "Dev"] },
    { "date": "2026-04-21", "title": "Manager 1:1",           "attendees": ["Morgan"] },
    { "date": "2026-04-18", "title": "New hire onboarding",   "attendees": ["Chris", "Morgan"] }
  ],
  "generatedAt": "2026-04-23T19:08:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `p` — priority 1 (hot) / 2 (warm) / 3 (cold). Derived from deadline proximity + stakeholder seniority.
- `project` — one of `partnerships | infra | contracts | ops | onboarding`. Group related action items.
- `color` (projects) — cycle through: `var(--teal-400)`, `var(--yellow-400)`, `var(--blue-400)`, `var(--pink-400)`, `var(--grey-700)`, `var(--red-400)`. Keep the same color for the same project across days for continuity.
- `icon` (blockers) — `!` for high severity, `•` for medium.

## Rules
- **Cap**: top3 exactly 3 items · overdue ≤3 · dueSoon ≤8 · blocked ≤5 · projects ≤8 · blockers ≤5 · decisions ≤5.
- **Dedupe**: if the same commitment surfaces across multiple meetings, keep the most recent mention and collapse.
- **Only include items where the user is the assignee**. Meetings often have action items for others — skip those.
- **Keep labels ≤70 chars** — the dashboard truncates anyway.
- **Do not invent**: if a meeting doesn't surface 3 top-3 candidates, write fewer items rather than padding. The dashboard handles short lists.
- If Granola API fails: still write the file with `"sourceOk": false`, `"error": "<reason>"`, and empty arrays for each field.
- Never write prose or markdown explanations to the user. Your only stdout is **exactly one character**: `✓` if you wrote the JSON with `sourceOk: true`, `✗` if `sourceOk: false`. No other text — no path, no counts, no debug. The orchestrator reads the JSON via `build-overrides.py`.

## Why JSON (not direct writes to data-override.jsx)
The dashboard skill owns the merge into `data-override.jsx`. Your job is clean, structured data. This means: (a) the user can eyeball the file to debug, (b) the skill can re-render without re-calling you, (c) you can be swapped/improved without touching any JSX.
