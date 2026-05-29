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
        ├─ prep.sh            → date/window/cache + pre-delete + slack pre-fetch
        ├─ 6 agents (parallel) → <dataCacheDir>/{calendar,granola,gmail,slack,drive,wellness}.json
        └─ wait-and-merge.sh  → drive-transform.py + build-overrides.py
              └─ <dashboardDir>/data-override.jsx + drive-index.jsx  (+ cache-bust the HTML)
```

## How to refresh — ONE allowlisted call (headless bypass)

Run exactly this, then relay its stdout to the user verbatim:

```
Bash(
  command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/refresh-headless.sh",
  timeout: 480000,   # 8 min — the headless run fans out 6 agents + merge
  description: "Refresh dashboard (headless bypass)"
)
```

(If `${CLAUDE_PLUGIN_ROOT}` is not expanded in your environment, use the absolute
path to this skill's directory.)

That single command runs the **entire** orchestration — prep, the 6-agent fan-out,
and the merge — inside a headless `claude -p --permission-mode bypassPermissions`
subprocess. **This is the point:** your interactive session sees only this one Bash
call and therefore **never** a permission prompt. The writes under your data cache
dir, the lightweight agents' heredoc shell-outs, and any overwrite fallbacks that
otherwise force manual approvals all run **ungated inside the subprocess**.

> **Why a subprocess and not an inline fan-out?** Three independent prompt sources
> defeat the in-session approach and can't be fixed by allowlist rules or `tools:`
> frontmatter: (a) the Write tool flags writes under `~/.claude/` as "sensitive" and
> prompts anyway; (b) small agents shell out via `cat <<EOF` / `python3 <<EOF` / `cp`,
> which the static analyzer can't parse; (c) overwrite-needs-Read fallbacks. Moving
> the orchestration into a non-interactive `claude -p` is the reliable zero-prompt fix.

**Do NOT** run `prep.sh`, the `Agent` fan-out, `slack-fetch.sh`, `drive-transform.py`,
`wait-and-merge.sh`, or `build-overrides.py` yourself from the interactive session —
that reintroduces every prompt this design removes. The subprocess owns all of it.

### What the subprocess does (reference — you don't run these)

The headless `claude -p` reads `headless-prompt.md` and executes:

1. **`prep.sh`** — computes `TODAY`/`TOMORROW`/`NOW`/`WINDOW_DAYS`/`START_TS`,
   resolves `DATA_DIR`/`DASH_DIR` from config, decides `RUN_AGENTS` vs `SKIP_AGENTS`
   via the per-agent TTL cache, deletes each running agent's stale output (fresh
   Write), and pre-fetches Slack via `slack-fetch.sh` when slack will run.
2. **Fan-out** — one `Agent` call per agent in `RUN_AGENTS` (parallel) + one
   `wait-and-merge.sh` call in the same tool block. Each agent is told its absolute
   output path so nothing is hardcoded.
3. **`wait-and-merge.sh`** — polls until every expected JSON is fresh, runs
   `drive-transform.py` (if drive ran), then `build-overrides.py`, which writes the
   JSX overlays from the agent JSONs + the config static blocks, bumps cache
   versions, and prints the confirmation line.

`headless-prompt.md` is the source of truth for the kickoff prompts — edit it (not
this section) if the fan-out logic changes.

**Window auto-adjusts** to elapsed time since the last refresh (same-day → 1;
Monday after Friday → 3; >1 week → capped at 7; first-ever → 7). **Per-agent TTL
cache:** calendar/gmail/slack always run; granola 2h, drive/wellness 4h reuse cached
JSON, so a 2nd-of-day refresh may only run 3 agents.

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
- MCP servers configured for calendar / gmail / slack / drive / granola (see
  `.mcp.json.example`). The agents resolve their tools by the configured server
  name, falling back to a capability search — so renamed servers still work.
- Slack uses a user token (`xoxp-…`, `search:read` scope) in the macOS keychain
  under `slack_token` — no Slack MCP needed (works headless).

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
