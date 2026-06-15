---
name: dashboard
description: Refresh the Work Dashboard with live data. Runs the whole orchestration (6 parallel agents — calendar, granola, gmail, slack, drive, wellness — then a merge into data-override.jsx + drive-index.jsx) inside a single headless subprocess, so the interactive session never sees a permission prompt. Invoke when the user says "/dashboard", "refresh dashboard", "update dashboard", or "pull fresh data".
---

# Work Dashboard — refresh skill

Orchestrator. One allowlisted call launches a headless subprocess that fans out to
6 agents and merges their JSON into `data-override.jsx` + `drive-index.jsx` for the
local React-in-browser dashboard. All per-user identity and paths come from
`~/.claude/dashboard-config.local` (created by the `dashboard-setup` skill).

## Architecture

```
<skill-dir>/refresh-headless.sh                  ← the ONE call /dashboard makes
   └─ claude -p --permission-mode bypassPermissions  (headless subprocess)
        ├─ prep.sh            → date/window/cache + pre-delete + MCP server names
        ├─ 6 agents (parallel) → <dataCacheDir>/{calendar,granola,gmail,slack,drive,wellness}.json
        └─ wait-and-merge.sh  → drive-transform.py + build-overrides.py
              └─ <dashboardDir>/data-override.jsx + drive-index.jsx  (+ cache-bust the HTML)
```

## How to refresh — two steps: interactive Slack, then the headless call

### Step 1 — refresh Slack (interactive; required, because Slack search needs consent)

Slack's MCP search (`slack_search_public_and_private`) requires **user consent**,
which the headless subprocess can't give — so Slack is fetched here, in the
interactive session, BEFORE the headless step. (You may see a one-time Slack
consent prompt; that's expected and is the whole reason this step exists.)

1. Get the cache dir + dates:
   ```
   Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/slack-prep.sh",
        description: "Slack prep (paths + dates)")
   ```
   Capture `DATA_DIR`, `TODAY`, `SINCE_WINDOW`, `SINCE_1D`, `SINCE_30D`, `MCP_SLACK`,
   `WORKSPACE`, `TZNAME`.
2. Spawn ONE `dashboard-slack` agent with the captured values:
   ```
   Agent(subagent_type: "dashboard-slack",
         prompt: "Refresh slack data. Today is <TODAY>; timezone=<TZNAME>. Your Slack
                  MCP server is named <MCP_SLACK>; workspace=<WORKSPACE>. Absolute
                  dates for Slack search operators: SINCE_WINDOW=<SINCE_WINDOW>;
                  SINCE_1D=<SINCE_1D>; SINCE_30D=<SINCE_30D>. Write the JSON to
                  <DATA_DIR>/slack.json.")
   ```
   If the user has no Slack connector or declines consent, continue anyway — the
   agent writes `sourceOk:false` and the rest of the dashboard renders fine. Do not
   block the refresh on Slack.

> Scheduled/headless refreshes (launchd/cron) skip this step — they can't get
> consent — so they keep the **last** `slack.json` from an interactive run. Run
> `/dashboard` yourself to refresh Slack.

### Step 2 — the one headless call (everything else + merge)

Then run exactly this, and relay its stdout to the user verbatim:

```
Bash(
  command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/refresh-headless.sh",
  timeout: 480000,   # 8 min — the headless run fans out 5 agents + merge
  description: "Refresh dashboard (headless bypass)"
)
```

(If `${CLAUDE_PLUGIN_ROOT}` is not expanded in your environment, use the absolute
path to this skill's directory.)

That command runs the rest of the orchestration — prep, the 5-agent fan-out
(calendar/gmail/granola/drive/wellness), and the merge (which reads the `slack.json`
from Step 1) — inside a headless `claude -p --permission-mode bypassPermissions`
subprocess, so your interactive session never sees a permission prompt for those.

> **Why a subprocess for the other five?** Three independent prompt sources defeat an
> in-session fan-out and can't be fixed by allowlist rules or `tools:` frontmatter:
> (a) the Write tool flags writes under `~/.claude/` as "sensitive"; (b) small agents
> shell out via `cat <<EOF` / `python3 <<EOF` / `cp`, unparseable by the analyzer;
> (c) overwrite-needs-Read fallbacks. A non-interactive `claude -p` runs them ungated.

**Do NOT** run `prep.sh`, the headless `Agent` fan-out, `drive-transform.py`,
`wait-and-merge.sh`, or `build-overrides.py` yourself from the interactive session —
that reintroduces every prompt this design removes. The subprocess owns all of it.
(The Slack agent in Step 1 is the deliberate exception — it MUST be interactive.)

### What the subprocess does (reference — you don't run these)

The headless `claude -p` reads `headless-prompt.md` and executes:

1. **`prep.sh`** — computes `TODAY`/`TOMORROW`/`NOW`/`WINDOW_DAYS`/`SINCE_*`/`START_TS`,
   resolves `DATA_DIR`/`DASH_DIR`/timezone/per-source MCP server names from config,
   decides `RUN_AGENTS` vs `SKIP_AGENTS` via the per-agent TTL cache, and deletes each
   running agent's stale output (fresh Write). It does NOT touch `slack.json`.
2. **Fan-out** — one `Agent` call per agent in `RUN_AGENTS` (parallel) + one
   `wait-and-merge.sh` call in the same tool block. Each agent is told its absolute
   output path so nothing is hardcoded.
3. **`wait-and-merge.sh`** — polls until every expected JSON is fresh, runs
   `drive-transform.py` (if drive ran), then `build-overrides.py`, which writes the
   JSX overlays from the agent JSONs (including the interactive `slack.json`) + the
   config static blocks, bumps cache versions, and prints the confirmation line.

`headless-prompt.md` is the source of truth for the kickoff prompts — edit it (not
this section) if the fan-out logic changes.

**Window auto-adjusts** to elapsed time since the last refresh (same-day → 1;
Monday after Friday → 3; >1 week → capped at 7; first-ever → 7). **Per-agent TTL
cache:** calendar/gmail always run; granola 2h, drive/wellness 4h reuse cached
JSON, so a 2nd-of-day refresh may run fewer agents.

If any agent fails, its JSON gets `sourceOk:false`, the merge falls back to empty
arrays for its fields, and the confirmation line appends `· failed: <agents>`.

## Where per-user content lives

All identity/team/OKRs/pins/paths come from `~/.claude/dashboard-config.local`
(see `templates/dashboard-config.local.example` and the `dashboard-setup` skill).
`build-overrides.py` reads it on every refresh — **edit the config file, never
`data-override.jsx`** (it's overwritten each run). The shipped repo contains only
generic placeholders.

## Requirements

- The `claude` CLI on `PATH` (the subprocess is `claude -p`).
- MCP servers for calendar / gmail / slack / drive / granola. **No servers are
  bundled** — the agents use whatever connectors the user already has (defaults:
  the standard managed connectors `Google_Calendar`, `Gmail`, `Slack`,
  `Google_Drive`, `Granola`). Different server names can be set in the config's
  `mcp` section; the agents also fall back to a ToolSearch capability lookup,
  so renamed servers still work.

## Rules & gotchas

- **One call only.** The interactive refresh is the single `refresh-headless.sh`
  Bash call — never reconstruct prep/fan-out/merge inline, or the prompts return.
- **Static blocks live in `~/.claude/dashboard-config.local`**, read by
  `build-overrides.py`. Update the config to change roster / OKRs / pins / greeting.
- **Never bump the other cache params.** The merge bumps only `data-override.jsx`
  and `drive-index.jsx`.
- **`nextMeeting` is computed at load time** from `SEED.calendar`, so the countdown
  stays accurate even if the tab is opened hours later.
- **Never render HTML, never open the browser** — the dashboard is its own HTML file;
  this skill only feeds it data. The user reloads the tab manually.
- **Zero prompts comes from the headless subprocess, not the agents.** Don't rely on
  `tools:` frontmatter to restrict agents (it doesn't, in this runtime).
