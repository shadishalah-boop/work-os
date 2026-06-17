---
name: dashboard
description: Refresh the Work Dashboard with live data. Fetches calendar, granola, gmail, slack, drive, wellness (and, when configured, custom Looker/Snowflake metrics) in THIS interactive session — because claude.ai-managed MCP connectors aren't available to a headless subprocess — then merges into data-override.jsx + drive-index.jsx. Invoke when the user says "/dashboard", "refresh dashboard", "update dashboard", or "pull fresh data".
---

# Work Dashboard — refresh skill

Orchestrator. Runs entirely in the **interactive session** (claude.ai-managed
connectors only exist here): a prep call, an in-session fan-out to the data agents +
inline Slack, then a merge into `data-override.jsx` + `drive-index.jsx` for the local
React-in-browser dashboard. All per-user identity and paths come from
`~/.claude/dashboard-config.local` (created by the `dashboard-setup` skill).

## Architecture

```
(interactive session — connectors live here)
  bash prep.sh            → dates/window/cache + pre-delete + MCP server names
  fan out, in-session:
    ├─ 5 agents (parallel) → <dataCacheDir>/{calendar,granola,gmail,drive,wellness}.json
    └─ Slack (inline, main session, not a sub-agent) → <dataCacheDir>/slack.json
  bash wait-and-merge.sh  → drive-transform.py + build-overrides.py
        └─ <dashboardDir>/data-override.jsx + drive-index.jsx  (+ cache-bust the HTML)
```

> The old headless `refresh-headless.sh` / `headless-prompt.md` path is **deprecated**
> — a headless `claude -p` can't see claude.ai-managed connectors, so it fetched
> nothing. Kept only for environments whose connectors load headlessly.

## How to refresh — runs in THIS Claude Code session

> **Why in-session?** claude.ai-managed MCP connectors (named like
> `claude_ai_Google_Calendar`, `claude_ai_Slack`) live in the Claude Code session
> context, not in a raw `claude -p` subprocess spawned by launchd/cron. So the refresh
> runs here, in the session. **To automate it**, a *Claude Code scheduled task* that
> runs `/work-os:dashboard` works great — it executes in an authenticated session, so
> the connectors are available (run `allowlist.sh` first so it doesn't stop on a
> prompt). The deprecated `refresh-headless.sh` (raw `claude -p`) is the thing that may
> not carry the connectors — prefer the in-session flow below / a scheduled task.
>
> **First-run prompts:** the first refresh asks you to approve each connector tool
> once — choose **"don't ask again"** and subsequent refreshes are prompt-free. To
> skip the click-through entirely, run
> `bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/allowlist.sh` once (it writes the
> read-only allow-rules to `~/.claude/settings.json`; effective next session).

### Step 1 — prep (one bash call)

```
Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/prep.sh", description: "Dashboard prep")
```

Capture `TODAY`, `TOMORROW`, `NOW`, `WINDOW_DAYS`, `SINCE_*`, `START_TS`, `TZNAME`,
`DATA_DIR`, `DASH_DIR`, `RUN_AGENTS`, the per-source server names `MCP_CALENDAR`
/ `MCP_GMAIL` / `MCP_DRIVE` / `MCP_GRANOLA` (these come from config and are typically
the `claude_ai_`-prefixed names), `MCP_ZOOM` (optional Zoom notes source merged into the
granola agent), plus `MCP_LOOKER` / `MCP_SNOWFLAKE` / `HAS_METRICS` / `METRICS_DEFS` for
the custom Metrics card. prep.sh is plain bash (no MCP) and allowlistable.

### Step 2 — refresh Slack YOURSELF, in this session (do NOT spawn a sub-agent)

Slack must be fetched by **you, the main interactive assistant** — NOT via the
`Agent`/sub-agent tool. Two reasons, both confirmed in the field:
- **Sub-agents are sandboxed** to the bare `mcp__Slack__*` tool names and CANNOT
  reach this session's managed connector, which is often exposed under a prefix like
  `mcp__claude_ai_Slack__…`. A spawned `dashboard-slack` agent therefore finds no
  Slack tool and fails. The MAIN session CAN reach the prefixed connector.
- Slack's `slack_search_public_and_private` needs **user consent**, which only an
  interactive session can grant (you may see a one-time consent prompt — expected).

Do this yourself, inline:

1. Get paths/dates: `Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/slack-prep.sh", description: "Slack prep")`.
   Capture `DATA_DIR`, `SINCE_WINDOW`, `SINCE_1D`, `SINCE_30D`, `MCP_SLACK`, `WORKSPACE`, `TZNAME`.
2. **Resolve the Slack search tool in THIS session**, in order:
   `mcp__<MCP_SLACK>__slack_search_public_and_private` (MCP_SLACK from config may be
   `claude_ai_Slack`) → `mcp__claude_ai_Slack__slack_search_public_and_private` →
   `mcp__Slack__slack_search_public_and_private` → else `ToolSearch` with
   `query: "slack search messages"`. Use whatever resolves.
3. Run the 4 searches (absolute dates). **Keep responses small** to avoid the
   "result exceeds maximum allowed tokens" error: pass `response_format: "concise"`,
   `limit: 20`, and `include_context: false` on every search.
   `to:me after:<SINCE_WINDOW>` · `from:me after:<SINCE_1D>` (questions = those
   containing `?`) · `from:me after:<SINCE_1D>` (shipped) · `incident after:<SINCE_WINDOW>`.
3b. **Fetch the user's Slack avatar for the tab favicon.** Try hard — the profile shape
   varies, so check several places:
   1. `mcp__<MCP_SLACK>__slack_search_users` with the config `user.email` (then `user.name`)
      → take the matching user; OR `mcp__<MCP_SLACK>__slack_read_user_profile` for the
      authed user. (Resolve the tool name with the usual `claude_ai_`/bare/ToolSearch fallback.)
   2. From whatever it returns, pull the FIRST present of these image fields, checking both
      the top level and a nested `profile` object: `image_512`, `image_192`, `image_72`,
      `image_1024`, `image_original`, `image_48`. Accept any `https://…` value.
   3. Put that URL in `slack.json` as `userAvatar`. If you truly can't find one after both
      tools, set `"userAvatar": ""` and continue (the tab falls back to the default icon).
   Do not give up after a single tool/field — the image is usually under `profile.image_192`.
4. Build `slack.json` following the schema + scope/classification rules in
   `${CLAUDE_PLUGIN_ROOT}/agents/dashboard-slack.md` (Read it for the exact schema —
   apply the scope filter: DMs + channels you posted in + `#incident-*`; include the
   `userAvatar` from 3b). **Write** it to `<DATA_DIR>/slack.json`.
5. If no Slack tool resolves at all, Write `slack.json` with `"sourceOk": false` and
   continue — the rest of the dashboard renders fine. Never block the refresh on Slack.

> The headless/button refresh (`refresh-headless.sh`) fetches Slack too — under
> `--permission-mode bypassPermissions` (see `headless-prompt.md` STEP 1b). It's
> time-boxed: if the Slack call stalls it's skipped and the last good `slack.json` is
> kept, so Slack never blocks the run. The whole refresh is capped by `serve.py`
> (`REFRESH_TIMEOUT`), so a stuck refresh always resolves and reports a result.

### Step 3 — fetch the other sources, in this session (one tool block)

In a SINGLE tool-use block, spawn one `Agent` per agent in `RUN_AGENTS`
(`subagent_type: dashboard-<name>` for calendar / gmail / granola / drive / wellness).
They run in THIS session, so they can reach the `claude_ai_`-prefixed connectors. Tell
each its server name and absolute output path. Kickoffs (substitute captured values):

- `dashboard-calendar`: `Refresh calendar data. TODAY=<TODAY>; TOMORROW=<TOMORROW>; NOW=<NOW>; timezone=<TZNAME>. Your calendar MCP server is named <MCP_CALENDAR> — resolve mcp__<MCP_CALENDAR>__list_events (else ToolSearch "calendar list events"). Write <DATA_DIR>/calendar.json.`
- `dashboard-gmail`: `Refresh gmail for the last <WINDOW_DAYS> days. Today=<TODAY>; timezone=<TZNAME>. Your gmail MCP server is named <MCP_GMAIL>. Write <DATA_DIR>/gmail.json.`
- `dashboard-granola`: `Refresh meeting notes (7-day lookback) from Granola AND Zoom, merged/deduped. Today=<TODAY>; timezone=<TZNAME>. Your granola MCP server is named <MCP_GRANOLA>; your zoom MCP server is named <MCP_ZOOM> (optional — skip Zoom silently if it doesn't resolve). Write <DATA_DIR>/granola.json.`
- `dashboard-drive`: `Refresh drive (files modified last 14 days). Today=<TODAY>. Your drive MCP server is named <MCP_DRIVE>. Write the raw response to <DATA_DIR>/drive-raw.json.`
- `dashboard-wellness`: `Refresh wellness for this week. Today=<TODAY>; NOW=<NOW>; timezone=<TZNAME>. Your calendar MCP server is named <MCP_CALENDAR>. Write <DATA_DIR>/wellness.json.`

**Custom Metrics card — REQUIRED when `HAS_METRICS=yes`.** You MUST spawn
`dashboard-metrics` in this same fan-out block (it's easy to forget — don't). Skipping it
means the user's saved metrics never get values. If the sub-agent can't reach the data
connector, run its spec inline in the main session (same fallback as below).
- `dashboard-metrics`: `Fetch the custom Metrics-card numbers. Read definitions from <METRICS_DEFS> (or config metrics.items). Snowflake server=<MCP_SNOWFLAKE>; Looker server=<MCP_LOOKER>. timezone=<TZNAME>. For each metric, fetch the current value + a prior-period value per agents/dashboard-metrics.md (Snowflake "nl" metrics: discover the schema and write the SQL yourself), then Write <DATA_DIR>/metrics.json.`
  (Snowflake is a normal MCP a sub-agent can usually reach; Looker may be a desktop/local connector — if unreachable, do the metric inline in the main session.)

**Fallback (important):** if a spawned agent reports it can't reach its connector
(some environments don't expose claude.ai connectors to sub-agents), perform that
agent's spec **yourself inline** in this session — you, the main assistant, can
always reach the connectors. Read `${CLAUDE_PLUGIN_ROOT}/agents/dashboard-<name>.md`, fetch, and Write the
JSON. Do the same for any agent that writes `sourceOk:false` with a "tool not found"
error. Never leave a source failed just because the sub-agent couldn't see the tool.

### Step 4 — merge (one bash call)

```
Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/wait-and-merge.sh <START_TS> <RUN_AGENTS>",
     timeout: 360000, description: "Merge dashboard data")
```

Substitute `<START_TS>` and the space-separated `<RUN_AGENTS>`. It runs
`drive-transform.py` (if drive ran) then `build-overrides.py`, which merges every
agent JSON (including the `slack.json` from Step 2) + the config static blocks into
`data-override.jsx` / `drive-index.jsx`, bumps cache versions, and prints the
confirmation line. **Relay that line.** No MCP — allowlistable, never prompts after
the first approval.

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

- MCP connectors for calendar / gmail / slack / drive / granola, available **in this
  interactive session**. **No servers are bundled** — the agents use whatever
  connectors the user has. Names are read from the config `mcp` section (set by
  setup; commonly `claude_ai_Google_Calendar` etc.), with `claude_ai_`/bare/legacy
  variants in agent frontmatter and a ToolSearch fallback.
- (Only the deprecated headless path needs the `claude` CLI on `PATH`; the in-session
  refresh does not.)

## Rules & gotchas

- **Runs in-session, not headless.** Fetch all sources in this session (prep →
  in-session agents + inline Slack → merge). A headless `claude -p` can't see
  claude.ai connectors, so don't route the fetch through `refresh-headless.sh`.
- **First refresh prompts once per connector tool** — tell the user to pick "don't
  ask again"; after that it's silent. This is unavoidable for session-scoped
  connectors and is the trade for them working at all.
- **Static blocks live in `~/.claude/dashboard-config.local`**, read by
  `build-overrides.py`. Update the config to change roster / OKRs / pins / greeting.
- **Never bump the other cache params.** The merge bumps only `data-override.jsx`
  and `drive-index.jsx`.
- **`nextMeeting` is computed at load time** from `SEED.calendar`, so the countdown
  stays accurate even if the tab is opened hours later.
- **Never render HTML, never open the browser** — the dashboard is its own HTML file;
  this skill only feeds it data. The user reloads the tab (or the server auto-reloads).
