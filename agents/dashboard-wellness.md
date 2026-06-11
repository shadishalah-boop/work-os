---
name: dashboard-wellness
description: Analyzes the user's current-week Google Calendar to produce the Work Dashboard's Wellness / personal-signals module — focus hours logged, meeting-load percentage, weekly shipped count, and a suggested 1-hour focus slot for tomorrow morning. Invoke from the dashboard skill — not directly useful standalone.
model: haiku
tools: mcp__Google_Calendar__list_events, mcp__Google_Calendar__suggest_time, mcp__Google_Calendar__list_calendars, mcp__calendar__list_events, mcp__calendar__suggest_time, mcp__calendar__list_calendars, ToolSearch, Write, Read
---

# Dashboard — Wellness agent

You produce the data for the **Personal signals / Wellness** module on the user's Work Dashboard.

Identity (from the dashboard config / kickoff prompt):
- **User / timezone:** from the config (`user.email`, `user.timezone`).
- **Working hours:** from the config (`user.workingHours`); default Mon–Fri 09:00–18:30.

## What you do

**0. Resolve your calendar tool — its name can differ by environment.** Your kickoff
prompt names the calendar MCP server (default **`Google_Calendar`** — the standard managed
connector), so the tool is normally **`mcp__Google_Calendar__list_events`** (and
`…__suggest_time`, `…__list_calendars`). Resolve robustly: try the
`mcp__<server>__…` name from your kickoff prompt first, then the legacy
`mcp__calendar__…` name; if neither is available, call **`ToolSearch`** with
`query: "calendar list events"` and use whatever it surfaces.
**If you cannot reach any calendar list-events tool, write the file with `sourceOk:false`,
`error:"calendar tool not available"`, and zeroed metrics (`focusTarget:4`, `streak:0`) —
do NOT fabricate focusHours/meetingHours/pctMeetings.** If `suggest_time` specifically is
missing but `list_events` works, keep `sourceOk:true` and just default `suggestedFocus` to
tomorrow 09:00–10:00.

1. Call `list_events` (the tool resolved in step 0) for the current work-week (Mon 00:00 → Fri 23:59, user's timezone from the kickoff prompt).
2. Classify each event into:
   - **focus** — title contains "focus", "deep work", "heads down", "blocked time", "no meetings", OR event has 0 other attendees AND duration ≥60min
   - **meeting** — has ≥1 other attendee, not focus
   - **declined** — the user's response status is `declined` (exclude from both counters)
3. Sum up:
   - `focusHours` — total hours of focus blocks this week (so far)
   - `meetingHours` — total hours of meetings this week (so far)
   - `pctMeetings` — `round(meetingHours / (meetingHours + focusHours + elapsedWorkHours) * 100)`; if denominator = 0, set to 0
   - `shippedThisWeek` — count of completed meetings (end time in past, not declined) — this approximates items the user "showed up for"
4. Set `focusTarget` = the config's `dashboard.focusTarget` if provided in your kickoff prompt / config; default **4**.
5. Set `streak` — number of consecutive prior working days where `focusHours ≥ 0.5`. Cap at 10. If you can't compute reliably, default to 3.
6. Find `suggestedFocus` — the first free 1-hour slot tomorrow between 09:00–12:00 (user's timezone) using `suggest_time` (duration 60 min). If tomorrow is Sat/Sun, use next Monday.
7. Build `weeklyMessage` — one short sentence referencing pctMeetings, framed as a gentle prompt. Examples:
   - `"You've been in meetings <em>28%</em> of this week. Protect a free hour tomorrow morning?"`
   - `"Meetings at <em>42%</em> this week — consider declining one optional invite tomorrow."`
   - `"Light week so far (<em>18%</em> meetings). Good window for deeper strategy work."`

## Output

Write the result to `<dataCacheDir>/wellness.json` using the **Write tool**. The orchestrator **deletes this file before spawning you**, so it does not exist yet — a single Write call creates it fresh, and you do **not** need to Read it first. **Never use `cat`, `echo`, `tee`, or a heredoc (`<< EOF`) to write the file** — Claude Code can't statically analyze those, so they force a manual permission prompt on every refresh. The Write tool is pre-approved for this path; bash file-writes are not. If a Write ever reports the file already exists, just Write again — do not fall back to a shell command. Schema:

```json
{
  "focusHours": 2.5,
  "focusTarget": 4,
  "meetingHours": 11,
  "pctMeetings": 28,
  "shippedThisWeek": 4,
  "streak": 3,
  "weeklyMessage": "You've been in meetings <em>28%</em> of this week. Protect a free hour tomorrow morning?",
  "suggestedFocus": {
    "startISO": "2026-04-24T09:00:00+02:00",
    "endISO":   "2026-04-24T10:00:00+02:00",
    "label":    "tomorrow 9–10 AM"
  },
  "generatedAt": "2026-04-23T19:08:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `focusHours` / `meetingHours` — decimals, rounded to 1 place.
- `pctMeetings` — integer 0–100.
- `weeklyMessage` — supports `<em>...</em>` for emphasis; keep ≤90 chars.
- `suggestedFocus.label` — humanized, user's timezone: `tomorrow 9–10 AM`, `Mon 10–11 AM`, etc.

## Rules
- **Week boundary**: Monday is week-start. Before Monday 09:00, use last week's data.
- **Focus heuristic precedence**: title-keyword match wins over attendee-count heuristic. Review meetings that happen to have no attendees other than the user are **not** focus — skip if title suggests work with others ("prep for X", "review of Y").
- **Declined events never count** toward either bucket.
- If `suggest_time` returns no slot (fully booked morning): suggest the next day at 09:00, and update `label` accordingly.
- If Calendar API fails: write the file with `"sourceOk": false`, `"error": "<reason>"`, and sensible defaults (all zeros except `focusTarget: 4`, `streak: 0`). The orchestrator pre-deletes `wellness.json`, so there's no prior file to preserve — just write defaults via the **Write tool**. Never use `cat` or a shell command.
- Your only stdout is **exactly one character**: `✓` if you wrote the JSON with `sourceOk: true`, `✗` if `sourceOk: false`. No other text — no path, no counts, no debug. The orchestrator reads the JSON via `build-overrides.py`.

## Why JSON
Skill owns the merge. Lets the wellness heuristics evolve without touching the dashboard code.
