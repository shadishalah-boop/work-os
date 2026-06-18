You are the headless executor for the Work Dashboard refresh. Run the steps below
EXACTLY and in order. Do not ask questions — you run non-interactively. Do NOT
invoke the `/dashboard` skill: you ARE the refresh, and invoking it would recurse.
Your only stdout must be what STEP 4 specifies.

`{{SKILL_DIR}}` below is the absolute path to the dashboard skill directory (the
launcher substitutes it before you see this).

---

## STEP 1 — prep

Run this Bash command and read its KEY=VALUE stdout:

```
bash {{SKILL_DIR}}/prep.sh
```

It prints: `TODAY`, `TOMORROW`, `NOW` (HH:MM), `WINDOW_DAYS`, `SINCE_ISO`,
`SINCE_EPOCH`, `SINCE_WINDOW`, `SINCE_1D`, `SINCE_30D`, `START_TS`, `TZNAME`,
`DATA_DIR`, `DASH_DIR`, `RUN_AGENTS`, `SKIP_AGENTS`, `CONFIG`, `BUNDLE`, and the
per-source MCP server names `MCP_CALENDAR`, `MCP_GMAIL`, `MCP_SLACK`, `MCP_DRIVE`,
`MCP_GRANOLA`. (`SINCE_ISO`/`SINCE_EPOCH`/`SINCE_WINDOW` are the incremental cutoff —
the exact moment of the last refresh, or a 14-day/7-day fallback — pass them to the
agents so they only fetch what's new.)

Capture every value. `prep.sh` has already created the data dir, synced the
static bundle if needed, and DELETED each RUN_AGENTS output file (so every agent
does a fresh-create Write). It does NOT delete `slack.json`. Do NOT run prep.sh's
sub-steps yourself.

## STEP 1b — refresh Slack YOURSELF (inline; not a sub-agent)

You run with `--permission-mode bypassPermissions`. Fetch Slack yourself (the main
context can reach the managed connector; a spawned sub-agent may not). **Time-box it:
if a Slack tool call doesn't return promptly, or no Slack tool resolves, STOP and move
on** — do NOT wait indefinitely; the overall run is also capped by the caller.

1. Resolve the Slack search tool, in order: `mcp__<MCP_SLACK>__slack_search_public_and_private`
   (MCP_SLACK from STEP 1, often `claude_ai_Slack`) → `mcp__claude_ai_Slack__slack_search_public_and_private`
   → `mcp__Slack__slack_search_public_and_private` → else `ToolSearch` with
   `query: "slack search messages"`.
2. Run 4 searches, each with `response_format: "concise"`, `limit: 20`,
   `include_context: false` (keeps responses under the token limit):
   `to:me after:<SINCE_WINDOW>` · `from:me after:<SINCE_1D>` (questions = those with `?`)
   · `from:me after:<SINCE_1D>` (shipped) · `incident after:<SINCE_WINDOW>`.
3. Build `slack.json` per the schema + scope rules in
   `{{SKILL_DIR}}/../../agents/dashboard-slack.md`. **On success**, Write it to
   `<DATA_DIR>/slack.json` (Read it first if it already exists, then Write).
   **On ANY failure or stall**, do NOT write — leave the existing `slack.json` untouched
   so the last good Slack data is preserved. Do not block the rest of the refresh.

## STEP 2 — fan out in ONE tool block (agents in parallel + the merge waiter)

Issue a SINGLE tool-use block containing BOTH:

1. One `Agent` call for EACH agent name in `RUN_AGENTS` (omit any not listed —
   those are cached). Use `subagent_type` = `dashboard-<name>`, and the kickoff
   prompt below with the captured values substituted. **Always tell each agent the
   absolute output path** `<DATA_DIR>/<name>.json` (drive: `<DATA_DIR>/drive-raw.json`).
2. One `Bash` call to `wait-and-merge.sh` (same block, runs in parallel).

Kickoff prompts — include only the ones whose agent is in RUN_AGENTS:

- `dashboard-calendar`: `Refresh calendar data. TODAY=<TODAY>; TOMORROW=<TOMORROW>; NOW=<NOW> (HH:MM); timezone=<TZNAME>. These were computed live seconds ago — use them and ignore any other date in your context. Your calendar MCP server is named <MCP_CALENDAR>. List today's events (startTime=<TODAY>T00:00:00, endTime=<TOMORROW>T00:00:00, timezone <TZNAME>). Write the JSON to <DATA_DIR>/calendar.json.`
- `dashboard-granola`: `Refresh granola data INCREMENTALLY. SINCE=<SINCE_ISO> (only process meetings that started after this; meetings before it were already captured). Today is <TODAY>; timezone=<TZNAME>; ignore any other date in your context. Your granola MCP server is named <MCP_GRANOLA>. Per your spec: one list_meetings call; if there are no meetings since SINCE, write the existing granola.json back unchanged WITHOUT calling get_meetings; otherwise get_meetings for the new IDs only, then merge into the existing JSON (dedupe, drop items >14d old). Build meetingHistory from the merged set (cap 30, newest first). Write the JSON to <DATA_DIR>/granola.json.`
- `dashboard-gmail`: `Refresh gmail data INCREMENTALLY. SINCE_EPOCH=<SINCE_EPOCH>; SINCE=<SINCE_WINDOW> (fetch only threads with activity after this). Today is <TODAY>; timezone=<TZNAME>. Your gmail MCP server is named <MCP_GMAIL>. Per your spec: read the existing gmail.json, fetch only new threads, and merge (dedupe by thread id, drop items >14d old); if nothing is new, write the existing JSON back unchanged. Write the JSON to <DATA_DIR>/gmail.json.`
- `dashboard-drive`: `Refresh drive data with files modified in the last 14 days. Today is <TODAY>. Your drive MCP server is named <MCP_DRIVE>. Dump the raw recent-files response with the Write tool to <DATA_DIR>/drive-raw.json and stop — the orchestrator runs the transform.`
- `dashboard-wellness`: `Refresh wellness data for this week. Today is <TODAY>; NOW=<NOW> (HH:MM); timezone=<TZNAME>. Your calendar MCP server is named <MCP_CALENDAR>. Write the JSON to <DATA_DIR>/wellness.json.`

(Slack is NOT a sub-agent in this fan-out — you already fetched it inline in STEP 1b,
so `slack.json` is on disk and the merge reads it.)

The Bash call (always include it, in the SAME block), with a 360000 ms timeout:

```
bash {{SKILL_DIR}}/wait-and-merge.sh <START_TS> <RUN_AGENTS>
```

Substitute `<START_TS>` and `<RUN_AGENTS>` (the space-separated agent list) from
STEP 1. If `RUN_AGENTS` is empty, still issue the wait-and-merge.sh call with
`<START_TS>` and NO agent args, and spawn no agents.

`wait-and-merge.sh` polls until every expected agent's JSON is fresh, runs
drive-transform.py (if drive ran), then build-overrides.py, which prints the
final confirmation line.

## STEP 3 — (nothing to do)

wait-and-merge.sh already did the waiting, drive transform, and merge.

## STEP 4 — output

Output ONLY the final confirmation line that `wait-and-merge.sh` printed (the
build-overrides.py line, e.g. `Dashboard refreshed · …`). No preamble, no
commentary, no markdown fences, no recap. Just that one line — with two
exceptions, appended to the same line when they apply:

- If STEP 1's `BUNDLE` was not `ok` (e.g. `synced to v0.5.0`), append
  ` · bundle <BUNDLE> — hard-reload the tab (Cmd/Ctrl+Shift+R)`.
- If STEP 1's `CONFIG` was not `ok`, append ` · config: <CONFIG>`.
