---
name: dashboard
description: Refresh Shadi's Work Dashboard prototype with live data. Fans out to 6 parallel agents (calendar, granola, gmail, slack, drive, wellness), merges their JSON into `data-override.jsx` and `drive-index.jsx` at `~/Documents/Claude/design_handoff_work_dashboard_c/`, then bumps cache versions in `Work Dashboard.html`. Invoke when Shadi says "/dashboard", "refresh dashboard", "update dashboard", or "pull fresh data".
---

# Work Dashboard — refresh skill

Orchestrator. Fans out to 6 agents, then merges their JSON into `data-override.jsx` + `drive-index.jsx` for the local React-in-browser dashboard at `~/Documents/Claude/design_handoff_work_dashboard_c/`.

**User:** Shadi Shalah · Strategy & Planning Manager at Preply · Europe/Madrid.

## Architecture

```
~/.claude/agents/dashboard-{calendar,granola,gmail,slack,drive,wellness}.md   (the 6 agents)
         ↓ each writes
~/.claude/dashboard-data/{calendar,granola,gmail,slack,drive,wellness}.json   (agent output)
         ↓ this skill reads + merges
~/Documents/Claude/design_handoff_work_dashboard_c/data-override.jsx           (dynamic SEED overlay)
~/Documents/Claude/design_handoff_work_dashboard_c/drive-index.jsx             (voice mic file index)
         ↓ skill bumps ?v=N
~/Documents/Claude/design_handoff_work_dashboard_c/Work Dashboard.html         (cache-bust)
```

## Step 1 — Fan out to all 6 agents in parallel

**First, get today's actual date from the system clock** (sub-agents inherit a stale `currentDate` from the parent session's start — they cannot be trusted to derive "today" correctly):

```bash
date '+%Y-%m-%d'        # → today, e.g. 2026-04-27
date -v+1d '+%Y-%m-%d'  # → tomorrow, e.g. 2026-04-28
```

Capture as `TODAY` and `TOMORROW`. Then issue **one** tool-use block containing 6 Agent calls. Each prompt embeds the explicit date so agents don't have to derive it. Don't batch sequentially.

```
Agent(subagent_type="dashboard-calendar",  prompt="Refresh calendar.json. Today is {TODAY}; tomorrow is {TOMORROW}. Query list_events with startTime={TODAY}T00:00:00+02:00 and endTime={TOMORROW}T00:00:00+02:00, timeZone=Europe/Madrid. Trust this date over any context-injected currentDate (those are stale by 1–3 days).")
Agent(subagent_type="dashboard-granola",   prompt="Refresh granola.json for last 7 days. Today is {TODAY}. Use this for any date math; ignore any other date in your context.")
Agent(subagent_type="dashboard-gmail",     prompt="Refresh gmail.json for last 7 days. Today is {TODAY}.")
Agent(subagent_type="dashboard-slack",     prompt="Refresh slack.json for last 7 days. Today is {TODAY}.")
Agent(subagent_type="dashboard-drive",     prompt="Refresh drive.json with recent files. Today is {TODAY}.")
Agent(subagent_type="dashboard-wellness",  prompt="Refresh wellness.json for this week. Today is {TODAY}.")
```

If any agent returns an error, continue — its JSON file will have `sourceOk: false` and the merge step falls back to empty arrays for its fields (see Step 3).

## Step 2 — Read the 6 JSON files

```
Read /Users/shadi.shalah/.claude/dashboard-data/calendar.json
Read /Users/shadi.shalah/.claude/dashboard-data/granola.json
Read /Users/shadi.shalah/.claude/dashboard-data/gmail.json
Read /Users/shadi.shalah/.claude/dashboard-data/slack.json
Read /Users/shadi.shalah/.claude/dashboard-data/drive.json
Read /Users/shadi.shalah/.claude/dashboard-data/wellness.json
```

Parse each. Track which `sourceOk` flags are false for the final confirmation line.

## Step 3 — Merge overlapping fields

Some SEED fields are produced by a single agent; others merge two. Apply this mapping:

| SEED field | Source(s) | Merge rule |
|---|---|---|
| `SEED.calendar` | calendar.events | Map each event → `{id: 'c'+i, time, duration, title, type, who: attendees.map(firstName).slice(0,6)}`. Include `overflow` count as last `who` entry like `'+3'` if `attendees.length > 6`. |
| `SEED.nextMeeting` | calendar.nextMeeting | Map `{title, with, room: time, startsIn: minutesUntil}`. If null, use `{title:'Nothing else today', startsIn:0, with:'you', room:'—'}`. |
| `SEED.top3` | granola.top3 | Pass through (cap 3). |
| `SEED.overdue` | granola.overdue + gmail.overdue | Concatenate; re-id sequentially as `o1`, `o2`, `...`; cap 5. |
| `SEED.dueSoon` | granola.dueSoon + gmail.dueSoon | Concatenate; re-id `d1..`; cap 10. |
| `SEED.blocked` | granola.blocked | Pass through; cap 5. |
| `SEED.shipped` | slack.shipped | Pass through; cap 5. |
| `SEED.blockers` | granola.blockers + slack.blockers | Concatenate. Sort by sev: `high` before `medium`. Cap 5. |
| `SEED.projects` | granola.projects | Pass through; cap 8. |
| `SEED.decisions` | granola.decisions + gmail.decisions | Concatenate; re-id `dec1..`; cap 5. Prefer gmail decisions (they include `href`). |
| `SEED.inbox` | gmail.inbox | Pass through; cap 6. |
| `SEED.slack` | slack.{workspace,tabs,channels,activeThreads} | Pass through. |
| `SEED.personalSignals` | wellness.* | Pass through all fields. |
| `DRIVE_INDEX` | drive.files | Pass through (separate file, see Step 5). |

Static fields preserved by this skill (hardcoded in Step 4 template — they rarely change):
- `SEED.user` · `SEED.greeting` · `SEED.team` · `SEED.okrs` · `SEED.pins` · `SEED.weather`

If any agent's JSON has `sourceOk: false`, treat its fields as empty arrays for the merge (fall back to seed values from `data.jsx`).

## Step 4 — Write `data-override.jsx`

Use the Write tool. Path: `/Users/shadi.shalah/Documents/Claude/design_handoff_work_dashboard_c/data-override.jsx`.

Build the file contents as one string using `JSON.stringify(mergedValue, null, 2)` for each dynamic block. Template:

```jsx
/* global React, window */
// =============================================================================
// LIVE OVERRIDE — auto-regenerated by the `dashboard` skill.
// Dynamic blocks come from ~/.claude/dashboard-data/*.json.
// Static blocks (user, greeting, team, okrs, pins, weather) are preserved below.
// Hand-edit the static blocks in ~/.claude/skills/dashboard/SKILL.md.
// =============================================================================

(function () {
  // --- User identity (static) -------------------------------------------
  window.SEED.user = { name: 'Shadi', role: 'Strategy & Planning Manager', tz: 'Europe/Madrid' };
  window.SEED.greeting = {
    morning:   'Morning, <em>Shadi</em>.',
    afternoon: 'Afternoon, <em>Shadi</em>.',
    evening:   'Evening, <em>Shadi</em>.',
  };

  // --- Calendar (from calendar.json) ------------------------------------
  window.SEED.calendar = {{CALENDAR_JSON}};

  // Compute next upcoming meeting from live clock (overrides agent's nextMeeting
  // so the dashboard always reflects now, not the moment the agent ran).
  (function pickNext() {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
    const upcoming = window.SEED.calendar.find(e => toMin(e.time) > nowMin);
    if (upcoming) {
      const startMin = toMin(upcoming.time);
      window.SEED.nextMeeting = {
        title: upcoming.title,
        startsIn: startMin - nowMin,
        with: (upcoming.who && upcoming.who.length) ? upcoming.who.slice(0,3).join(', ') : 'you',
        room: upcoming.time,
      };
    } else {
      window.SEED.nextMeeting = { title: 'Nothing else today', startsIn: 0, with: 'you', room: '—' };
    }
  })();

  // --- Top-3 today (from granola.json) ---------------------------------
  window.SEED.top3 = {{TOP3_JSON}};

  // --- Tasks (granola + gmail merged) -----------------------------------
  window.SEED.overdue  = {{OVERDUE_JSON}};
  window.SEED.dueSoon  = {{DUESOON_JSON}};
  window.SEED.blocked  = {{BLOCKED_JSON}};
  window.SEED.shipped  = {{SHIPPED_JSON}};

  // --- Blockers (granola + slack merged) --------------------------------
  window.SEED.blockers = {{BLOCKERS_JSON}};

  // --- Team (static · Preply org · Strategic Finance under Jose Ferreira) ---
  window.SEED.team = {
    attention: '<b>Hitesh</b> & <b>Kate</b> (both onboarding), <b>Christopher Rogan</b> (pre-align call owed before he starts).',
    people: [
      { name: 'Jose Ferreira',     status: 'active', note: 'Manager · VP Strategic Finance',          ooo: false, manager: true  },
      { name: 'Chermain Ang',      status: 'active', note: 'Sr. Strategy & Revenue Mgr',              ooo: false, manager: false },
      { name: 'Hitesh Pankhania',  status: 'active', note: 'Onboarding · Sr. Strategy & Ops',         ooo: false, manager: false },
      { name: 'Kate Jones',        status: 'active', note: 'Onboarding · Lead Exec Assistant',        ooo: false, manager: false },
      { name: 'Cristina Rundall',  status: 'active', note: 'Personal Assistant · Jose',               ooo: false, manager: false },
      { name: 'Nabila Ramadhyan',  status: 'active', note: 'Strategic Finance PM · under Chermain',   ooo: false, manager: false },
    ],
  };

  // --- Projects (from granola.json) -------------------------------------
  window.SEED.projects = {{PROJECTS_JSON}};

  // --- Q2 OKRs (static · from Preply OKR sheet) -------------------------
  // Source: https://docs.google.com/spreadsheets/d/1JCV36oLjUwu0orX2ZVxGN-jJe5DodNiwPkc2e_ofGX0
  window.SEED.okrs = [
    { id: 'k1', name: 'AI: Build 4\u20135 strategy-team workflows',                   pct: 10, trend: 'behind'  },
    { id: 'k2', name: 'Fintech: Support Payments & Treasury roadmap',                  pct: 35, trend: 'on-pace' },
    { id: 'k3', name: 'Additional: Bandwidth for CEO initiatives (B2B FR, Corp Dev)',  pct: 20, trend: 'on-pace' },
  ];

  // --- Decisions pending (granola + gmail merged) -----------------------
  window.SEED.decisions = {{DECISIONS_JSON}};

  // --- Pins / Quick access (static · Shadi's daily tools) ---------------
  window.SEED.pins = [
    { id: 'pn1', label: 'Q2 OKRs sheet',   sub: 'Sheets · Strategy team', letter: 'O', bg: 'var(--teal-100)',   href: 'https://docs.google.com/spreadsheets/d/1JCV36oLjUwu0orX2ZVxGN-jJe5DodNiwPkc2e_ofGX0/edit?gid=1707884311' },
    { id: 'pn2', label: 'Granola',         sub: 'Meeting notes',          letter: 'G', bg: 'var(--pink-100)',   href: 'https://app.granola.ai' },
    { id: 'pn3', label: 'Gmail',           sub: 'Inbox',                  letter: 'M', bg: 'var(--red-100)',    href: 'https://mail.google.com/mail/u/0/#inbox' },
    { id: 'pn4', label: 'Google Calendar', sub: 'Week view',              letter: 'C', bg: 'var(--blue-100)',   href: 'https://calendar.google.com/calendar/u/0/r/week' },
    { id: 'pn5', label: 'Slack · Preply',  sub: 'Workspace',              letter: '#', bg: 'var(--yellow-100)', href: 'https://preply.slack.com' },
    { id: 'pn6', label: 'Google Drive',    sub: 'Files',                  letter: 'D', bg: 'var(--grey-100)',   href: 'https://drive.google.com' },
  ];

  // --- Personal signals / Wellness (from wellness.json) ----------------
  window.SEED.personalSignals = {{PERSONALSIGNALS_JSON}};

  // --- Inbox (from gmail.json) ------------------------------------------
  window.SEED.inbox = {{INBOX_JSON}};

  // --- Slack (from slack.json) ------------------------------------------
  window.SEED.slack = {{SLACK_JSON}};

  // --- Weather (static · Barcelona · replace with an agent later) -------
  window.SEED.weather = {
    city: 'Barcelona',
    days: [
      { label: 'Today', high: 20, low: 15, cond: 'Overcast' },
      { label: 'Fri',   high: 18, low: 11, cond: 'Overcast' },
      { label: 'Sat',   high: 19, low: 10, cond: 'Overcast' },
    ],
  };

  console.log('[dashboard] live override applied · {{SOURCES_OK_SUMMARY}}');
})();
```

Replace each `{{...}}` placeholder with the JSON stringification (pretty-printed, 2-space indent) of the merged value. Example for TOP3_JSON:
```
merged.top3 = granola.top3;                       // from Step 3
TOP3_JSON   = JSON.stringify(merged.top3, null, 2).replace(/^/gm, '  ').trimStart();
```

**`{{SOURCES_OK_SUMMARY}}`** — replace with something like `calendar✓ granola✓ gmail✗ slack✓ drive✓ wellness✓` showing which agents succeeded.

## Step 5 — Write `drive-index.jsx`

Use the Write tool. Path: `/Users/shadi.shalah/Documents/Claude/design_handoff_work_dashboard_c/drive-index.jsx`.

Template:
```jsx
/* global window */
// Auto-generated by the `dashboard` skill from ~/.claude/dashboard-data/drive.json.
// Used by the Find palette + voice mic "open [file]" fuzzy-match.
window.DRIVE_INDEX = {{DRIVE_FILES_JSON}};
```

Where `{{DRIVE_FILES_JSON}}` = `JSON.stringify(drive.files, null, 2)`. If `drive.sourceOk === false`, write `window.DRIVE_INDEX = [];` and skip bumping drive-index.jsx's cache version in Step 6.

## Step 6 — Bump cache versions in `Work Dashboard.html`

Use the Edit tool on `/Users/shadi.shalah/Documents/Claude/design_handoff_work_dashboard_c/Work Dashboard.html`.

For each file just rewritten, increment its `?v=N` suffix by 1:
- `data-override.jsx?v=N` → `?v=(N+1)` — always bump
- `drive-index.jsx?v=N`  → `?v=(N+1)` — bump only if Step 5 wrote new content

First read the HTML to see current version numbers (they change between runs — grep the `?v=` for each file). Use Edit with `old_string` = current version line and `new_string` = bumped version.

Do **not** bump other files (dashboard-d.css, gcal.jsx, modules-a.jsx, modules-b.jsx, app.jsx, data.jsx) — the skill doesn't touch them, so their cache stays valid.

## Step 7 — Confirm to user

Output exactly one line. Format:

```
Dashboard refreshed · {{ok_count}}/6 sources · {{summary_metrics}} · reload the browser tab
```

Example:
```
Dashboard refreshed · 6/6 sources · 7 events · 3 top3 · 4 blockers · 12 slack threads · 42 drive files · reload the browser tab
```

If any source failed, append which ones, e.g. `· failed: slack (auth expired)`.

## Rules & gotchas

- **Always fan out in parallel (Step 1)** — sequential agent calls waste 5–6× the wall time.
- **Static blocks live in this SKILL.md template.** If Shadi asks to update his team roster, OKRs, pins, or greeting, edit this file — not `data-override.jsx`, which will be overwritten on next refresh.
- **Never bump the other 5 cache params.** Only `data-override.jsx` and `drive-index.jsx` change per run.
- **`nextMeeting` is computed at load time** from `SEED.calendar` (see Step 4's IIFE) — this gives accurate countdowns even if the dashboard is opened hours after the last refresh.
- **Never render HTML** — the dashboard lives in its own HTML file; this skill only feeds it data.
- **Never open the browser** — Shadi keeps the tab open and will reload manually.
- **Sort order matters for blockers**: always put `sev: 'high'` items before `sev: 'medium'` after concatenating granola + slack sources.
- If `~/.claude/dashboard-data/` does not exist, create it with `mkdir -p` before agents run (they'll error otherwise).
