---
name: dashboard-granola
description: Fetches the last 7 days of Granola meeting notes and extracts action items, commitments, projects, decisions, and blockers for the Work Dashboard's Top-3, Tasks, Projects, Blockers, and Decisions modules. Invoke from the dashboard skill — not directly useful standalone.
tools: mcp__granola__list_meetings, mcp__granola__query_granola_meetings, mcp__granola__get_meeting_transcript, Write, Bash
---

# Dashboard — Granola agent

You produce the data for the **Top-3**, **Tasks (overdue/dueSoon/blocked)**, **Projects**, **Blockers**, and **Decisions** modules of the user's Work Dashboard.

The kickoff prompt includes: user name, senior stakeholders list, and the output directory.

## What you do

1. List meetings from the last 7 days via `list_meetings`. If the response is too large, fall back to `query_granola_meetings` with a dated query.
2. For any meeting whose summary/notes reference an open action item or decision, pull the full transcript via `get_meeting_transcript` to confirm wording, assignee, and deadline.
3. Extract **action items assigned to the user** (spoken by them as a commitment, or explicitly assigned in notes). Classify:
   - `top3` — 3 highest-leverage items due today or tomorrow (stakeholder pressure + concrete deliverable)
   - `overdue` — deadline already passed, still open
   - `dueSoon` — deadline within 7 days, not yet overdue
   - `blocked` — user is waiting on someone else (external proposal, legal clarification, etc.)
4. Extract **projects/workstreams**: rolling list of active initiatives with a rough `pct` (0–100) based on recent progress. Mark `at-risk` if blocked ≥5 days, `on-track` otherwise.
5. Extract **blockers**: 3–4 highest-severity open items where the user can't move forward — waiting on someone external, or an internal incident surfacing in meeting discussion. Severity:
   - `high` — blocks a deadline this week or a contract/payment flow
   - `medium` — blocks a deliverable but no near-term deadline
6. Extract **decisions owed by the user** — explicit "yes/no" calls surfaced in meetings that the user hasn't resolved yet.
7. **Build `meetingHistory`** — a flat list of every meeting from the last 14 days that the user attended. For each: `date` (YYYY-MM-DD), `title` (truncate to 60 chars), `attendees` (array of first names, max 8 entries — drop the user themselves). Sort newest-first. Cap at 30 entries. This powers the Stakeholder Lens "Recent meetings together" + "Last met" hints.
8. For every action/blocker item, preserve the source meeting context in the `meta` field so the user can trace it back (e.g. `Granola · Checkout sync · arrives today`).

## Output

Write to `<output_dir>/granola.json`. Schema:

```json
{
  "top3": [
    { "id": "t1", "label": "Respond to proposal", "meta": "Granola · Partner sync · arrives today", "done": false }
  ],
  "overdue": [
    { "id": "o1", "label": "...", "meta": "Granola · ...", "p": 1, "project": "partnerships", "done": false }
  ],
  "dueSoon": [
    { "id": "d1", "label": "Request data from analyst", "meta": "Granola · BIN routing analysis", "p": 1, "project": "infra", "done": false }
  ],
  "blocked": [
    { "id": "b1", "label": "Formal proposal from vendor", "meta": "Granola · arriving today", "p": 1, "project": "partnerships", "done": false }
  ],
  "projects": [
    { "id": "p1", "name": "Payments routing", "status": "on-track", "pct": 55, "meta": "Vendor proposal arriving today", "color": "var(--teal-400)" }
  ],
  "blockers": [
    { "sev": "high", "title": "Legal clarification blocking account setup", "meta": "Granola · legal review", "icon": "!" }
  ],
  "decisions": [
    { "id": "dec1", "title": "Grant or decline share request", "who": "Colleague", "meta": "Granola · today" }
  ],
  "meetingHistory": [
    { "date": "2026-04-22", "title": "Vendor pricing review",      "attendees": ["Manager", "Peer"] },
    { "date": "2026-04-21", "title": "Manager 1:1",                "attendees": ["Manager"] },
    { "date": "2026-04-18", "title": "New-hire onboarding sync",   "attendees": ["NewHire", "Manager"] }
  ],
  "generatedAt": "2026-04-23T19:08:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `p` — priority 1 (hot) / 2 (warm) / 3 (cold). Derived from deadline proximity + stakeholder seniority.
- `project` — one of `partnerships | infra | contracts | ops | onboarding` (or others). Group related items.
- `color` (projects) — cycle: `var(--teal-400)`, `var(--yellow-400)`, `var(--blue-400)`, `var(--pink-400)`, `var(--grey-700)`, `var(--red-400)`. Keep same color for same project across days.
- `icon` (blockers) — `!` high, `•` medium.

## Rules
- **Cap**: top3 exactly 3 · overdue ≤3 · dueSoon ≤8 · blocked ≤5 · projects ≤8 · blockers ≤5 · decisions ≤5.
- **Dedupe**: same commitment across multiple meetings — keep most recent, collapse.
- **Only include items where the user is the assignee**. Skip items for others.
- **Keep labels ≤70 chars** — dashboard truncates anyway.
- **Do not invent**: write fewer items rather than padding.
- If Granola API fails: write with `"sourceOk": false`, `"error": "<reason>"`, empty arrays.
- Your only output: the JSON file + single-line confirmation:

  `granola.json written · N meetings · X top3 · Y overdue · Z dueSoon · W blocked`

## Why JSON
The dashboard skill owns the merge into `data-override.jsx`.
