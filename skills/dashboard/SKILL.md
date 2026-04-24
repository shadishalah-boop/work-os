---
name: dashboard
description: Refresh the Work Dashboard with live data. Fans out to 6 parallel agents (calendar, granola, gmail, slack, drive, wellness), merges their JSON into a local HTML bundle, and cache-busts the browser. Invoke when the user says "/dashboard", "refresh dashboard", "update dashboard", or "pull fresh data".
---

# Work Dashboard — refresh skill

Orchestrator. Reads a local config file, fans out to 6 data agents, merges their JSON, and writes the result into a user-writable HTML bundle that the user keeps open in a browser tab.

## Architecture

```
${CLAUDE_PLUGIN_ROOT}/public/*                            ← plugin-bundled HTML/JSX/CSS
         ↓ copied to (first run only)
<output.dashboardDir>/                                     ← user's writable copy
         ↓ this skill writes every refresh
<output.dashboardDir>/data-override.jsx                    (dynamic SEED overlay)
<output.dashboardDir>/drive-index.jsx                      (Find palette index)
<output.dashboardDir>/Work Dashboard.html                  (cache-busted on every run)

<output.dataCacheDir>/{calendar,granola,gmail,slack,drive,wellness}.json
                                                            ← each agent writes one file
```

## Step 0 — Read user config and filters

Use `Bash cat` (fast, no parsing overhead):

1. **Config** — `cat ~/.claude/dashboard-config.local 2>/dev/null`
   - If the file doesn't exist: print a helpful message to the user and stop. Tell them: "No config found. Copy `${CLAUDE_PLUGIN_ROOT}/templates/dashboard-config.local.example` to `~/.claude/dashboard-config.local` and edit it, then rerun `/dashboard`."
   - If the file exists: parse as JSON. All fields are optional — missing fields fall back to the example defaults (see Step 4 "Fallbacks" table).
   - Resolve `~` in `output.dashboardDir` and `output.dataCacheDir` to the user's home.

2. **Filters** — `cat ~/.claude/dashboard-filters.local 2>/dev/null`
   - If present: parse line-by-line (skip `#` comments and blank lines). Store as an array of lowercase patterns.
   - If missing: empty array (no filtering).

3. **Output dirs** — `mkdir -p <output.dashboardDir> <output.dataCacheDir>` (idempotent).

4. **First-run bundle copy** — if `<output.dashboardDir>/Work Dashboard.html` does not exist:
   - `cp -R ${CLAUDE_PLUGIN_ROOT}/public/. <output.dashboardDir>/`
   - Print: "First run — bundle copied to <output.dashboardDir>. Open `<output.dashboardDir>/Work Dashboard.html` in your browser."

## Step 1 — Fan out to all 6 agents in parallel

Issue **one** tool-use block with 6 Agent calls. Pass the resolved `<output.dataCacheDir>` and a brief user-context snippet (name, email, tz, senior stakeholders, workspace) in each prompt so agents can personalize their queries without reading the config themselves.

```
Agent(subagent_type="dashboard-calendar", prompt="Refresh calendar.json. User: <name> <<email>> (<tz>). Output dir: <output.dataCacheDir>.")
Agent(subagent_type="dashboard-granola",  prompt="Refresh granola.json. User: <name>. Senior stakeholders: <seniorStakeholders>. Output dir: <output.dataCacheDir>.")
Agent(subagent_type="dashboard-gmail",    prompt="Refresh gmail.json. User: <name> <<email>>. Senior stakeholders: <seniorStakeholders>. Output dir: <output.dataCacheDir>.")
Agent(subagent_type="dashboard-slack",    prompt="Refresh slack.json. User: <name> (slack id: <slack.userId>). Workspace: <slack.workspace>. High-signal channels: <slack.highSignalChannels>. Output dir: <output.dataCacheDir>.")
Agent(subagent_type="dashboard-drive",    prompt="Refresh drive.json. User: <name> <<email>>. Output dir: <output.dataCacheDir>.")
Agent(subagent_type="dashboard-wellness", prompt="Refresh wellness.json. User: <name>. Working hours: <workingHours>. Focus target: <focusTarget>h. Output dir: <output.dataCacheDir>.")
```

If any agent returns an error, continue — its JSON file will have `sourceOk: false` and the merge step falls back to empty arrays.

## Step 2 — Read the 6 JSON outputs

```
Read <output.dataCacheDir>/calendar.json
Read <output.dataCacheDir>/granola.json
Read <output.dataCacheDir>/gmail.json
Read <output.dataCacheDir>/slack.json
Read <output.dataCacheDir>/drive.json
Read <output.dataCacheDir>/wellness.json
```

Parse each. Track which `sourceOk` flags are false for the final confirmation line.

## Step 3 — Merge overlapping fields

| SEED field | Source(s) | Merge rule |
|---|---|---|
| `SEED.calendar` | calendar.events | Map each event → `{id: 'c'+i, time, duration, title, type, who: attendees.map(firstName).slice(0,6)}`. If `attendees.length > 6`, append `'+N'` to `who`. |
| `SEED.nextMeeting` | (computed at load time) | Skip — the IIFE in Step 4's template picks the first future event from `SEED.calendar`. |
| `SEED.top3` | granola.top3 | Pass through (cap 3). |
| `SEED.overdue` | granola.overdue + gmail.overdue | Concatenate; re-id `o1..`; cap 5. |
| `SEED.dueSoon` | granola.dueSoon + gmail.dueSoon | Concatenate; re-id `d1..`; cap 10. |
| `SEED.blocked` | granola.blocked | Pass through; cap 5. |
| `SEED.shipped` | slack.shipped | Pass through; cap 5. |
| `SEED.blockers` | granola.blockers + slack.blockers | Concatenate. Sort by severity: `high` before `medium`. Cap 5. |
| `SEED.projects` | granola.projects | Pass through; cap 8. |
| `SEED.decisions` | granola.decisions + gmail.decisions | Concatenate; re-id `dec1..`; cap 5. Prefer gmail decisions (they include `href`). |
| `SEED.inbox` | gmail.inbox | Pass through; cap 6. |
| `SEED.slack` | slack.{workspace,tabs,channels,activeThreads} | Pass through. |
| `SEED.personalSignals` | wellness.* | Pass through all fields. |
| `DRIVE_INDEX` | drive.files | Pass through (separate file, Step 5). |

**Static blocks come from the user's config** (Step 0):
- `SEED.user` ← `config.user` (add `managerLine: "Reports to " + org.manager.name` if manager set)
- `SEED.greeting` ← built from `config.user.name`: `Morning, <em>NAME</em>.` / `Afternoon, <em>NAME</em>.` / `Evening, <em>NAME</em>.`
- `SEED.team` ← `config.org.team`
- `SEED.okrs` ← `config.dashboard.okrs`
- `SEED.pins` ← `config.dashboard.pins`
- `SEED.weather` ← build with `config.dashboard.weather.city` + stub 3-day forecast (live weather is a later iteration)
- `SEED.org` ← `{ company: config.org.company }` (used by module labels)

**Fallbacks** when config is missing a field:

| Config field | Fallback |
|---|---|
| `user.name` | `"User"` |
| `user.fullName` | same as `user.name` |
| `user.role` | `""` |
| `user.timezone` | `"UTC"` |
| `org.company` | `""` |
| `org.team` | `{ attention: "", people: [] }` |
| `dashboard.okrs` | `[]` |
| `dashboard.pins` | `[]` |
| `dashboard.weather.city` | `""` |

**Apply filters** (safety net): drop any item from `SEED.inbox`, `SEED.decisions`, `SEED.overdue`, `SEED.dueSoon`, `SEED.shipped`, `SEED.projects` whose `from`, `who`, `title`, `label`, `meta`, or `name` field matches any pattern from the filters list (case-insensitive substring).

If any agent's JSON has `sourceOk: false`, treat its fields as empty arrays for that merge.

## Step 4 — Write `data-override.jsx`

Path: `<output.dashboardDir>/data-override.jsx`. Use the Write tool.

Build the file as one string. Template (substitute each `{{...}}` with the JSON-stringified merged value, 2-space indent):

```jsx
/* global React, window */
// =============================================================================
// LIVE OVERRIDE — auto-regenerated by the `dashboard` skill.
// Dynamic blocks come from the 6 data agents.
// Static blocks come from ~/.claude/dashboard-config.local.
// DO NOT hand-edit — changes will be lost on the next /dashboard refresh.
// =============================================================================

(function () {
  // --- User identity (from config) --------------------------------------
  window.SEED.user = {{USER_JSON}};
  window.SEED.greeting = {{GREETING_JSON}};
  window.SEED.org = {{ORG_JSON}};

  // --- Calendar (from calendar.json) ------------------------------------
  window.SEED.calendar = {{CALENDAR_JSON}};

  // Next upcoming meeting, computed from live clock
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

  // --- Team (from config) -----------------------------------------------
  window.SEED.team = {{TEAM_JSON}};

  // --- Projects (from granola.json) -------------------------------------
  window.SEED.projects = {{PROJECTS_JSON}};

  // --- OKRs (from config) -----------------------------------------------
  window.SEED.okrs = {{OKRS_JSON}};

  // --- Decisions pending (granola + gmail merged) -----------------------
  window.SEED.decisions = {{DECISIONS_JSON}};

  // --- Pins (from config) -----------------------------------------------
  window.SEED.pins = {{PINS_JSON}};

  // --- Personal signals / Wellness (from wellness.json) ----------------
  window.SEED.personalSignals = {{PERSONALSIGNALS_JSON}};

  // --- Inbox (from gmail.json) ------------------------------------------
  window.SEED.inbox = {{INBOX_JSON}};

  // --- Slack (from slack.json) ------------------------------------------
  window.SEED.slack = {{SLACK_JSON}};

  // --- Weather (from config · stub forecast, replace w/ agent later) ---
  window.SEED.weather = {{WEATHER_JSON}};

  console.log('[dashboard] live override applied · {{SOURCES_OK_SUMMARY}}');
})();
```

**`{{SOURCES_OK_SUMMARY}}`** — string like `calendar✓ granola✓ gmail✗ slack✓ drive✓ wellness✓` showing which agents succeeded.

## Step 5 — Write `drive-index.jsx`

Path: `<output.dashboardDir>/drive-index.jsx`.

```jsx
/* global window */
// Auto-generated by the `dashboard` skill from drive.json.
// Used by the Find palette + voice mic "open [file]" fuzzy-match.
window.DRIVE_INDEX = {{DRIVE_FILES_JSON}};
```

If `drive.sourceOk === false`, write `window.DRIVE_INDEX = [];` and skip bumping drive-index.jsx's cache version in Step 6.

## Step 6 — Bump cache versions in `Work Dashboard.html`

Path: `<output.dashboardDir>/Work Dashboard.html`.

Read the file, find each `?v=N` suffix for `data-override.jsx` and `drive-index.jsx`, and increment by 1 via Edit. Do **not** touch the cache params for other files (CSS, other JSX) — the skill doesn't modify them.

## Step 7 — Confirm

Output exactly one line:

```
Dashboard refreshed · {{ok_count}}/6 sources · {{summary_metrics}} · reload the browser tab
```

Example:
```
Dashboard refreshed · 6/6 sources · 7 events · 3 top3 · 4 blockers · 12 slack threads · 42 drive files · reload the browser tab
```

If any source failed, append `· failed: <names>`.

## Rules & gotchas

- **Always fan out in parallel (Step 1)** — sequential agent calls waste 5–6× the wall time.
- **All user-specific content lives in `~/.claude/dashboard-config.local`.** Never hardcode names, team rosters, OKRs, or URLs in this skill or in `data-override.jsx` — the user edits their config file instead.
- **`nextMeeting` is computed at load time** from `SEED.calendar` (see Step 4's IIFE) — keeps countdowns accurate even if the dashboard is opened hours after the refresh.
- **Sort blockers by severity**: `high` before `medium` after merging granola + slack sources.
- **Filters are a safety net, not a substitute** for the agents doing their own filtering — agents should drop items by sender/channel before writing their JSON; the merge step catches anything that leaked through.
- **Never render HTML** — the dashboard lives in its own HTML file; this skill only feeds it data.
- **Never open the browser** — the user keeps the tab open and reloads manually.
- **Scheduled auto-refresh** is NOT shipped in this plugin. See the README for setting up a cron-style recurring refresh on your own machine.
