---
name: dashboard
description: Refresh the Work Dashboard with live data. Fans out to 6 parallel agents (calendar, granola, gmail, slack, drive, wellness) reading from the user's MCP-connected accounts, merges their JSON into `data-override.jsx` and `drive-index.jsx` at the user's configured dashboardDir, then bumps cache versions in `Work Dashboard.html`. Invoke when the user says "/dashboard", "refresh dashboard", "update dashboard", or "pull fresh data".
---

# Work Dashboard — refresh skill

Orchestrator. Fans out to 6 agents, then merges their JSON into `data-override.jsx` + `drive-index.jsx` for the local React-in-browser dashboard. All user-specific values (name, email, team, OKRs, pins, output paths) come from `~/.claude/dashboard-config.local` — no personalization lives in this file or the agents.

## Architecture

```
~/.claude/dashboard-config.local                                       (user identity + paths)
         ↓ read by SKILL.md (Step 1) + build-overrides.py + each agent
<plugin>/agents/dashboard-{calendar,granola,gmail,slack,drive,wellness}.md   (the 6 agents)
         ↓ each writes
<output.dataCacheDir>/{calendar,granola,gmail,slack,drive,wellness}.json    (agent output)
         ↓ build-overrides.py reads + merges
<output.dashboardDir>/data-override.jsx                                (dynamic SEED overlay)
<output.dashboardDir>/drive-index.jsx                                  (Find palette index)
         ↓ bumps ?v=N
<output.dashboardDir>/Work Dashboard.html                              (cache-bust)
```

## Step 0 — Load config

Read `~/.claude/dashboard-config.local`. If the file doesn't exist, tell the user to copy `templates/dashboard-config.local.example` and edit it. Extract the values you'll need in Step 1's prompts:

- `USER_FULL_NAME` = `config.user.fullName`
- `USER_EMAIL` = `config.user.email`
- `USER_TIMEZONE` = `config.user.timezone` (default `Europe/Madrid`)
- `MANAGER_NAME` = `config.org.manager.name`
- `SENIOR_STAKEHOLDERS` = `config.org.seniorStakeholders` (comma-joined)
- `SLACK_WORKSPACE` = `config.slack.workspace`
- `SLACK_USER_ID` = `config.slack.userId`
- `HIGH_SIGNAL_CHANNELS` = `config.slack.highSignalChannels` (comma-joined)
- `WORKSTREAMS` = `config.dashboard.workstreams` (comma-joined)
- `DASHBOARD_DIR` = `config.output.dashboardDir` (default `~/Documents/work-dashboard`)
- `DATA_CACHE_DIR` = `config.output.dataCacheDir` (default `~/.claude/dashboard-data`)

You'll inline these into each agent's kickoff prompt so the agents themselves stay generic.

## Step 1 — Fan out (only the agents whose cache is stale)

**Get today's date, the lookback window, AND which agents need to actually run:**

```bash
DASHBOARD_DIR="${DASHBOARD_DIR:-$HOME/Documents/work-dashboard}"
DATA_CACHE_DIR="${DATA_CACHE_DIR:-$HOME/.claude/dashboard-data}"
mkdir -p "$DATA_CACHE_DIR"

date '+%Y-%m-%d'        # → today, e.g. 2026-05-05
date -v+1d '+%Y-%m-%d'  # → tomorrow, e.g. 2026-05-06

# --- WINDOW_DAYS auto-detection ---
# Compute WINDOW_DAYS = ceil(hours since last successful refresh / 24), clamped to [1, 7].
# Uses the mtime of data-override.jsx — only written on a complete refresh, so it's
# the most reliable "last successful refresh" signal.
LAST=$(stat -f '%m' "$DASHBOARD_DIR/data-override.jsx" 2>/dev/null)
if [ -z "$LAST" ]; then
  WINDOW_DAYS=7   # no prior refresh → safe default
else
  HRS=$(( ($(date '+%s') - LAST) / 3600 ))
  WINDOW_DAYS=$(( (HRS + 23) / 24 ))
  [ "$WINDOW_DAYS" -lt 1 ] && WINDOW_DAYS=1
  [ "$WINDOW_DAYS" -gt 7 ] && WINDOW_DAYS=7
fi
echo "WINDOW_DAYS=$WINDOW_DAYS"

# --- Per-agent TTL (same-day cache) ---
# Skip an agent if its JSON file is younger than its TTL. Live-data agents
# (calendar, gmail, slack) always run; the data they capture changes by the minute.
# Slow-changing agents (granola, drive, wellness) can reuse a recent JSON.
ttl_for_agent() {
  case "$1" in
    calendar|gmail|slack) echo 0       ;;  # always run
    granola)              echo 7200    ;;  # 2h
    drive)                echo 14400   ;;  # 4h
    wellness)             echo 14400   ;;  # 4h
  esac
}

NOW=$(date '+%s')
RUN_AGENTS=""
SKIP_AGENTS=""
for agent in calendar granola gmail slack drive wellness; do
  ttl=$(ttl_for_agent $agent)
  json="$DATA_CACHE_DIR/${agent}.json"
  if [ ! -f "$json" ] || [ "$ttl" -eq 0 ]; then
    RUN_AGENTS="$RUN_AGENTS $agent"
    continue
  fi
  age=$(( NOW - $(stat -f '%m' "$json") ))
  # Cache is only valid if mtime < TTL **AND** sourceOk:true in the JSON.
  # A fresh-but-failed JSON (sourceOk:false from a prior MCP outage) must be
  # retried — otherwise the dashboard keeps showing empty data forever.
  ok=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('sourceOk',False))" "$json" 2>/dev/null)
  if [ "$age" -lt "$ttl" ] && [ "$ok" = "True" ]; then
    SKIP_AGENTS="$SKIP_AGENTS $agent(${age}s,ok)"
  else
    RUN_AGENTS="$RUN_AGENTS $agent"
  fi
done
echo "RUN_AGENTS:${RUN_AGENTS# }"
echo "SKIP_AGENTS:${SKIP_AGENTS# }"
echo "START_TS=$NOW"   # epoch seconds — pass this to wait-and-merge.sh in Step 1's tool block
```

Capture `TODAY`, `TOMORROW`, `WINDOW_DAYS`, `RUN_AGENTS`, `SKIP_AGENTS`, and `START_TS`.

**The window auto-adjusts to the actual time elapsed since the last refresh:**

- Same-day rerun → `WINDOW_DAYS=1`
- Overnight refresh (~24h gap) → `WINDOW_DAYS=1`
- Monday morning after Friday refresh (~64h gap) → `WINDOW_DAYS=3`
- After a long absence (>1 week) → capped at `WINDOW_DAYS=7`
- First-ever refresh (no `data-override.jsx`) → `WINDOW_DAYS=7`

**The TTL cache means a same-day rerun might only fan out 3 agents instead of 6:**

| Agent | TTL | Why |
|---|---|---|
| calendar | always run | Next-meeting countdown needs the live clock |
| gmail | always run | Inbox changes minute-by-minute |
| slack | always run | Real-time chatter is the point |
| granola | 2h | Meetings end and notes finalize within ~2h |
| drive | 4h | File edits don't churn fast enough to matter |
| wellness | 4h | Focus hours accumulate slowly |

So a 2nd-of-day refresh ~30 min after the first will only run 3 agents (calendar/gmail/slack) and reuse the cached JSON for granola/drive/wellness. The merge step (`build-overrides.py`) just reads whatever's on disk — it doesn't care who wrote each file or when.

Then issue **one** tool-use block containing:

1. The Agent calls in `RUN_AGENTS` (each runs in parallel). Inline the config values from Step 0 into each prompt.
2. **One Bash call to `wait-and-merge.sh`** — runs in parallel with the agents, polls until all expected JSONs are fresh, then runs `build-overrides.py` and emits the final confirmation line.

This collapses what used to be two orchestrator turns (receive agent results → run merge → respond) into a single tool block. The orchestrator's only post-block job is to relay the wait-and-merge stdout to the user.

```
# Both kinds of calls go in the SAME tool_use_block. Don't sequence them.

# 1) Conditionally include each agent — only if it's in RUN_AGENTS.
#    Inline the config values from Step 0 into each prompt so the
#    agent files themselves stay generic.

Agent(subagent_type="dashboard-calendar",  prompt="""
  Refresh calendar.json. Today is {TODAY}; tomorrow is {TOMORROW}.
  User email: {USER_EMAIL}. Timezone: {USER_TIMEZONE}.
  Query list_events with startTime={TODAY}T00:00:00 and endTime={TOMORROW}T00:00:00, timeZone={USER_TIMEZONE}.
  Trust this date over any context-injected currentDate (those are stale by 1-3 days).
  Write output to {DATA_CACHE_DIR}/calendar.json.
""")

Agent(subagent_type="dashboard-granola",   prompt="""
  Refresh granola.json for the last {WINDOW_DAYS} days. Today is {TODAY}.
  User: {USER_FULL_NAME} <{USER_EMAIL}>. Manager: {MANAGER_NAME}.
  Active workstreams: {WORKSTREAMS}.
  Write output to {DATA_CACHE_DIR}/granola.json.
""")

Agent(subagent_type="dashboard-gmail",     prompt="""
  Refresh gmail.json for the last {WINDOW_DAYS} days. Today is {TODAY}.
  User email: {USER_EMAIL}. Manager: {MANAGER_NAME}.
  Write output to {DATA_CACHE_DIR}/gmail.json.
""")

Agent(subagent_type="dashboard-slack",     prompt="""
  Refresh slack.json for the last {WINDOW_DAYS} days. Today is {TODAY}.
  User: {USER_FULL_NAME} (Slack user ID {SLACK_USER_ID}, workspace {SLACK_WORKSPACE}).
  Senior stakeholders to prioritize: {SENIOR_STAKEHOLDERS}.
  High-signal channels: {HIGH_SIGNAL_CHANNELS}.
  Write output to {DATA_CACHE_DIR}/slack.json.
""")

Agent(subagent_type="dashboard-drive",     prompt="""
  Refresh drive.json with files modified in the last 14 days. Today is {TODAY}.
  User: {USER_FULL_NAME}.
  Write output to {DATA_CACHE_DIR}/drive.json.
""")

Agent(subagent_type="dashboard-wellness",  prompt="""
  Refresh wellness.json for this week. Today is {TODAY}.
  Timezone: {USER_TIMEZONE}.
  Write output to {DATA_CACHE_DIR}/wellness.json.
""")

# 2) Always include this Bash call, in the SAME tool_use_block:
Bash(
  command: "bash <plugin>/skills/dashboard/wait-and-merge.sh {START_TS} {RUN_AGENTS}",
  timeout: 360000,
  description: "Wait for agents, then merge"
)
```

Where `{START_TS}` is the epoch seconds you captured at the top of Step 1, `{RUN_AGENTS}` is the space-separated list of agents that need to run, and `<plugin>` is the absolute path to the plugin install directory (Claude Code resolves this — you can also write `${CLAUDE_PLUGIN_ROOT}` if available).

If any agent returns an error, continue — its JSON file will have `sourceOk: false` and the merge falls back to empty arrays for its fields. The merge step appends `· failed: <agents>` to its confirmation line so the user can see what's stale.

## Step 2 — Relay the wait-and-merge output

The Bash tool you launched in Step 1 returns the final confirmation line directly. Your only remaining job is to emit it to the user verbatim.

**Do not** invoke `build-overrides.py` separately — `wait-and-merge.sh` already runs it. Don't add commentary unless something failed; the one-line confirmation is the response.

### What `build-overrides.py` does (called inside wait-and-merge.sh)

- Loads `~/.claude/dashboard-config.local` (single source of truth for user identity + paths)
- Reads the 6 JSON files from `<dataCacheDir>`
- Merges overlapping fields per the rules below (granola+gmail tasks, granola+slack blockers, etc.)
- Writes `data-override.jsx` to `<dashboardDir>` — combining the dynamic agent data with static blocks (user, greeting, team, okrs, pins, weather) sourced from config.local
- Writes `drive-index.jsx` (or an empty `[]` if drive failed)
- Bumps the `?v=N` cache parameters for both files in `<dashboardDir>/Work Dashboard.html`
- Prints the final confirmation line directly to stdout

**Total post-fanout overhead: ~0.2s** (the merge itself; `wait-and-merge.sh` polls in 2-second intervals, so worst case it adds 2s of latency after the slowest agent finishes).

### What if the agents partially failed?

Each agent writes its JSON with `sourceOk: false` and an `error` field on failure. The script handles this gracefully — fields fall back to empty arrays, and the final confirmation line appends `· failed: <agents>` so the user can see what's stale.

### Where to edit static content

User identity, team roster, OKRs, pins, and weather city all live in `~/.claude/dashboard-config.local`. Edit the JSON and rerun this skill — no code or plugin changes needed. **Do not edit `data-override.jsx` directly** — it gets rewritten every refresh.

---

## Reference: merge rules (encoded in build-overrides.py — included here for review)

Some SEED fields are produced by a single agent; others merge two. The script applies this mapping:

| SEED field | Source(s) | Merge rule |
|---|---|---|
| `SEED.calendar` | calendar.events | Map each event → `{id: 'c'+i, time, duration, title, type, who: attendees.map(firstName).slice(0,6)}`. Include `overflow` count as last `who` entry like `'+3'` if `attendees.length > 6`. |
| `SEED.nextMeeting` | calendar.nextMeeting | Computed at LOAD time (IIFE in data-override.jsx) — picks the first event whose start is after `now`. Stays accurate even hours after the refresh. |
| `SEED.top3` | granola.top3 | Pass through (cap 3). |
| `SEED.overdue` | granola.overdue + gmail.overdue | Concatenate; re-id sequentially as `o1`, `o2`, `...`; cap 5. |
| `SEED.dueSoon` | granola.dueSoon + gmail.dueSoon | Concatenate; re-id `d1..`; cap 10. |
| `SEED.blocked` | granola.blocked | Pass through; cap 5. |
| `SEED.shipped` | slack.shipped | Pass through; cap 5. |
| `SEED.blockers` | granola.blockers + slack.blockers | Concatenate. Sort by sev: `high` before `medium`. Cap 5. |
| `SEED.projects` | granola.projects | Pass through; cap 8. |
| `SEED.decisions` | granola.decisions + gmail.decisions | Concatenate; re-id `dec1..`; cap 5. Prefer gmail decisions (they include `href`). |
| `SEED.meetingHistory` | granola.meetingHistory | Pass through; cap 30. Sort newest-first. Powers Stakeholder Lens "Recent meetings together". |
| `SEED.inbox` | gmail.inbox | Pass through; cap 6. |
| `SEED.slack` | slack.{workspace,tabs,channels,activeThreads} | Pass through. |
| `SEED.personalSignals` | wellness.* | Pass through all fields. |
| `DRIVE_INDEX` | drive.files | Pass through (written to a separate file, `drive-index.jsx`, by the script). |

Static fields sourced from `~/.claude/dashboard-config.local`:
- `SEED.user` ← `config.user`
- `SEED.greeting` ← computed from `config.user.name`
- `SEED.team` ← `config.org.team`
- `SEED.okrs` ← `config.dashboard.okrs`
- `SEED.pins` ← `config.dashboard.pins`
- `SEED.weather` ← `config.dashboard.weather`

If any agent's JSON has `sourceOk: false`, the script treats its fields as empty arrays for the merge (so the dashboard degrades gracefully — see `safe()` in the script).

## Rules & gotchas

- **Always fan out in parallel (Step 1)** — sequential agent calls waste 5–6× the wall time.
- **Static blocks come from `~/.claude/dashboard-config.local`.** If the user wants to update team roster, OKRs, pins, or greeting, edit that file — not `data-override.jsx`, which gets overwritten on next refresh.
- **Never bump the other 5 cache params.** The script only bumps `data-override.jsx` and `drive-index.jsx`.
- **`nextMeeting` is computed at load time** from `SEED.calendar` (the IIFE the script writes into `data-override.jsx`) — this keeps the countdown accurate even if the dashboard is opened hours after the last refresh.
- **Never render HTML** — the dashboard lives in its own HTML file; this skill only feeds it data.
- **Never open the browser** — the user keeps the tab open. With the v0.4.0 auto-reload banner in `Work Dashboard.html`, the browser polls every 30s and either silent-reloads (tab hidden) or shows a "Fresh data available" banner (tab visible).
- **Sort order matters for blockers**: always put `sev: 'high'` items before `sev: 'medium'` after concatenating granola + slack sources.
- If `<dataCacheDir>` does not exist, Step 1's bash creates it with `mkdir -p` before agents run.
