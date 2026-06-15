# Changelog

Versions of the Work OS plugin. Each release is also tagged in git — to roll back to a specific version:

```bash
gh repo clone shadishalah-boop/work-os /tmp/work-os
cd /tmp/work-os
git checkout v0.1.0   # or whichever version
# Then install from local path:
# /plugin install /tmp/work-os
```

Local timestamped backups also live at `~/Documents/Claude/backups/work-os-vX.Y.Z-YYYYMMDD.tar.gz`.

---

## v0.5.2 — 2026-06-15

**Frictionless onboarding.** Setup now detects almost everything instead of asking:
your timezone from the computer, and your identity from the accounts you've already
connected.

### Auto-filled identity

- `/dashboard-setup` Step 2 pulls **name, work email, role/title, and company** from
  your connectors — primarily one read-only `slack_read_user_profile` call (current
  user), with Granola `get_account_info` and Google Calendar `list_calendars`
  (primary calendar id = your email) as fallbacks, and company derived from your
  email domain. You confirm a pre-filled summary and fill only the gaps (usually
  just an optional manager). Falls back to manual entry if no connector is reachable.

### Team & OKRs moved out of setup

First-run no longer asks for your team roster or OKRs — they start empty and the
dashboard's People and OKR cards show a one-line prompt to add them later ("tell
Claude Code 'add my team to the dashboard'"). The setup skill's Appendix handles
those on-demand requests. This trims onboarding to: confirm identity → pick file
location → see real data. (The People card gained the same empty-state CTA the OKR
card already had.)

### Automatic timezone

The dashboard detects your timezone from your computer and re-detects it on
**every refresh** — so when you travel, your meeting times, "now" line, and
relative labels follow your laptop with no action from you.

- New `skills/dashboard/tzresolve.py` — one shared resolver used by `prep.sh`
  (passed to all agents), `build-overrides.py`, and `drive-transform.py`.
  Resolution order: an explicit IANA zone in `user.timezone` **pins** a fixed zone;
  otherwise the live system zone is auto-detected (via `$TZ`, `/etc/localtime`,
  `/etc/timezone`, or `timedatectl`); otherwise UTC. Dependency-free, macOS + Linux.
- `/dashboard-setup` no longer asks for an IANA timezone string (the sharpest
  friction point for non-technical users). It detects the zone, shows it for
  confirmation, and stores `"timezone": "auto"` by default.
- The old hardcoded `Europe/Madrid` fallback is gone from `build-overrides.py` and
  `drive-transform.py`; both now route through the resolver (UTC as neutral
  fallback) and never crash on an unknown zone name.
- To pin a fixed zone (e.g. always HQ time), set `user.timezone` to an IANA name.

---

## v0.5.1 — 2026-06-11

**Hands-free refresh.** New `skills/dashboard/schedule.sh` sets up (and removes)
scheduled auto-refresh in one command — launchd LaunchAgent on macOS, tagged
crontab on Linux. Defaults to weekdays 08:00 + 13:00 (`--times` to change), runs
the same headless refresh `/dashboard` uses, logs to
`~/.claude/dashboard-refresh.log`, and `status` shows the schedule + last log
lines. Optional `--serve` runs a localhost-only HTTP server for the dashboard
folder so the open tab auto-reloads (Chrome blocks the reload poller on `file://`
pages). `/dashboard-setup` now offers this at the end of onboarding, and the
README's hand-edit-a-plist instructions are replaced with the one-liner.

---

## v0.5.0 — 2026-06-11

**MCP-only release.** The plugin now works with the MCP connectors you already
have — no bundled servers, no custom Slack app, no Google Cloud OAuth, no macOS
Keychain. This makes a fresh install on a colleague's machine zero-auth-setup.

### Bundled `.mcp.json` removed (it was breaking installs)

- The bundled community npx servers are gone. One of them (`granola-mcp`) was
  **unpublished from npm** and could never start on a fresh install; the calendar
  server required a per-user Google Cloud OAuth `credentials.json` that stopped
  most installs cold. `.mcp.json` and `.mcp.json.example` are deleted.
- Agents now default to the standard managed connector names
  (`Google_Calendar`, `Gmail`, `Slack`, `Google_Drive`, `Granola`), keep the old
  lowercase names as a fallback, and fall back further to a ToolSearch capability
  lookup. A new **`mcp` config section** (see the example template) lets you map
  any source to a differently-named server.

### Slack agent → Slack MCP (Keychain + curl removed)

- `dashboard-slack` now runs its own searches through the Slack MCP
  (`slack_search_public_and_private`) instead of `slack-fetch.sh` + an `xoxp-`
  user token in the macOS Keychain. `slack-fetch.sh` is deleted, `prep.sh` no
  longer pre-fetches Slack, and the agent works on any OS with zero per-user
  Slack setup. Output schema unchanged — `build-overrides.py` untouched.
- Existing users can delete the old token:
  `security delete-generic-password -s slack_token`.

### Setup wizard verifies connectors live

- `/dashboard-setup` Step 8 no longer prints a static (and stale) auth table —
  it checks each of the 5 sources against the tools actually available in the
  session, records non-default server names into the config's `mcp` section,
  and prints a live ✓/✗ table with exact fix-it steps for anything missing.
- Fixed stale `work-dashboard` plugin-name references in the setup skill.

### Timezone unhardcoded

- `Europe/Madrid` was baked into 5 of the 6 agents. The orchestrator now passes
  `user.timezone` from the config (`TZNAME`) in every kickoff prompt, plus
  absolute Slack search dates (`SINCE_WINDOW`/`SINCE_1D`/`SINCE_30D`) computed by
  `prep.sh`. The wellness agent's hardcoded `focusTarget: 4` now reads
  `dashboard.focusTarget` from config too.

### Sample data is now labeled (bundle scrub, round 2)

- **Demo banner** — until the first `/dashboard` refresh, the dashboard renders
  the bundled "Alex" sample dataset. It now shows a dismissible banner ("You're
  looking at sample data — run /dashboard to load yours"); the generated
  `data-override.jsx` switches it off. No more "whose data is this?" on a fresh
  install.
- Removed the last real colleague names from code comments and the `?prep-test=1`
  debug helper; the greeting fallback and the legacy sidebar logo now derive from
  the configured user name instead of hardcoded "Alex" / "S"; favicon is a generic
  "W" mark (`favicon.svg`); the Blockers module's fake fallback rows are replaced
  with a real empty state.

### OKRs — config-driven and easier to enter

- The OKR tagging system (pill labels, colors, keyword auto-suggest, review-notes
  digest) no longer assumes exactly 3 OKRs with ids `k1/k2/k3`, and the
  maintainer's personal keyword sets are gone from the code. Any number of OKRs;
  per-OKR optional `short` (pill label) and `keywords` (auto-tagging) fields in
  the config — see the example template.
- `/dashboard-setup` OKR step is now skip-by-default and conversational: describe
  your OKRs in plain words and the wizard structures them (id/pct/trend/short/
  keywords) for you. With no OKRs configured, the dashboard shows a hint where
  they'd go instead of an empty section.

### Install hardening

- **Bundle auto-sync** — the refresh now copies the static bundle when it's
  missing (manual installs used to get data files with no HTML) and re-syncs it
  when the plugin version changes (upgrades used to strand users on old JSX
  forever). Generated data and the new **`custom.css`** (your visual overrides,
  loaded last, never overwritten) are preserved.
- **Linux fix (critical)** — the `stat -f || stat -c` mtime pattern returned
  filesystem info instead of failing on GNU stat, crashing `prep.sh` on Linux
  whenever a prior refresh existed. GNU order now tried first.
- **Self-diagnosing refresh line** — failed agents now report *why* (the JSON's
  `error` field), and a typo'd `dashboard-config.local` is called out loudly
  instead of silently using defaults.
- **Cheaper, friendlier headless run** — the orchestrator subprocess is pinned to
  `--model sonnet`, and an org-disabled `bypassPermissions` now produces a human
  explanation instead of raw stderr.
- **Docs/setup truthfulness** — removed nonexistent `claude plugin root` /
  `claude plugin info` commands (setup uses `${CLAUDE_PLUGIN_ROOT}`); setup now
  opens the dashboard at the end and offers to run the first refresh; README
  leads with a 3-step colleague quickstart; the Slack Ask panel and meeting
  modal no longer instruct token/OAuth setup for optional features.

### Update path for users on v0.4.x

```
/plugin update work-os
/dashboard
```

The refresh re-syncs the bundle automatically. Make sure the five standard
connectors show in `/mcp`, optionally add the `mcp` section to
`~/.claude/dashboard-config.local` (only needed for non-default server names),
and delete the old Slack Keychain entry.

---

## v0.4.2 — 2026-05-29

**Static bundle scrub.** Removes the last personal data from the shipped `public/`
bundle — the item v0.4.1 flagged as pending.

- Removed the maintainer's avatar photo (`ds/assets/shadi.jpg`). The favicon and
  topbar avatar now use the generic `ds/assets/favicon-s.svg` / `avatar-default.svg`.
- `app.jsx` / `modules-a.jsx` / `modules-b.jsx`: the user name, Slack workspace,
  OKR-sheet link, greeting fallbacks, and example placeholders are now config-driven
  (resolved from `window.SEED`, populated from `dashboard-config.local`) or generic.
- The OKR-classification keyword sets and the task-prioritization seniority cues are
  now generic, tunable defaults — no hardcoded colleague names.
- **Intentionally retained:** the Preply design system + brand fonts under `public/ds/`.
  The plugin's audience is internal colleagues and the repo is private, so these are
  appropriate; de-branding would only be needed for a public release.

---

## v0.4.1 — 2026-05-29

**Zero-prompt refresh.** Builds directly on v0.4.0. The refresh now runs entirely
inside a headless subprocess, so the interactive session never shows a permission
prompt — plus a real fix for Slack returning empty.

### Prompt-free refresh (headless bypass)

- `/dashboard` now makes a single call to `skills/dashboard/refresh-headless.sh`,
  which runs the whole orchestration (prep → 6-agent fan-out → merge) inside
  `claude -p --permission-mode bypassPermissions`. v0.4.0's in-session fan-out still
  tripped manual approvals three independent ways — the Write tool guarding
  `~/.claude/` as a "sensitive file", the lightweight agents shelling out via
  unparseable heredocs, and overwrite-needs-Read fallbacks — none of which an
  allowlist rule or `tools:` frontmatter could suppress. Running it non-interactively
  is the reliable fix. **Requires the `claude` CLI on your `PATH`.**
- New files: `prep.sh` (date/window/TTL + pre-delete + slack pre-fetch, extracted
  from SKILL.md), `headless-prompt.md` (the subprocess's orchestration prompt),
  `_config.sh` (path resolution), `drive-transform.py`, `slack-fetch.sh`.

### Slack fetch fixed (it was returning empty)

- `slack-fetch.sh`'s queries silently matched nothing. Two bugs: relative dates
  (`after:Nd`) are Gmail syntax that Slack ignores — switched to absolute
  `after:YYYY-MM-DD`; and `<@U…>` is the in-message mention encoding, not a valid
  search-operator value — switched to `from:me` / `to:me`. The authed user's own ID
  is resolved via `auth.test` and passed to the agent for @-mention detection. The
  Slack radar now populates.

### Other

- Agents resolve their MCP tools by the configured server name **with a ToolSearch
  capability fallback**, so renamed servers — and the headless subprocess, which can
  expose tools under different names — still resolve.
- `build-overrides.py` is fully config-driven and now reports the Slack **channel**
  count in the confirmation line (was the always-empty `activeThreads`).

### Note

- The static `public/` bundle still carries personal data and Preply-proprietary
  design-system assets from earlier versions; the repository is kept **private**
  pending that scrub. The skill + agents in this release are clean.

---

## v0.4.0 — 2026-05-27

**The speed-and-cost release.** Refresh time and cost both down ~80% with no
loss of fidelity. New programmatic merge step, per-agent TTL cache, MCP-free
Slack agent, browser auto-reload, and a real fix for the calendar agent's
broken MCP names.

### Speed & cost wins

- **Programmatic merge** — `skills/dashboard/build-overrides.py` (new) reads
  the 6 agent JSONs and writes `data-override.jsx` + `drive-index.jsx` in
  ~0.2s. Replaces ~5 min of orchestrator-LLM hand-writing JSX every refresh.
- **Wait-and-merge wrapper** — `skills/dashboard/wait-and-merge.sh` (new)
  polls for fresh JSONs in parallel with agent fan-out, then runs the merge
  in the same tool block. Collapses two orchestrator turns into one. Saves
  ~30-60s of "post-completion thinking" latency per refresh.
- **Per-agent TTL cache** — same-day reruns now skip granola/drive/wellness
  (2-4h TTL) if their JSON is fresh and `sourceOk: true`. Cache poisoning
  from prior failed runs is detected and retried.
- **WINDOW_DAYS auto-detect** — lookback window is now derived from the
  mtime of `data-override.jsx`. Same-day rerun → 1 day. Monday after
  Friday → 3 days. Long absence → capped at 7. No more guessing.
- **Haiku on cheap agents** — `dashboard-calendar`, `dashboard-drive`,
  `dashboard-wellness` now run on Haiku via `model: haiku` frontmatter.
  ~5× cheaper for those agents, same output quality.
- **Single-character agent output** — agents now emit just `✓` or `✗` (was
  a verbose line per agent). Smaller `tool_result` payload = faster
  orchestrator turn.
- **Slack agent rewrite — MCP-free** — `dashboard-slack` now uses the
  Slack web API directly with an OAuth token from macOS Keychain. Two
  wins: (1) works in headless `claude -p` (launchd) where the Slack MCP
  doesn't load, (2) one fewer MCP server to install. Setup is one
  `security add-generic-password -s slack_token`. See README's "Slack
  setup" section.
- **Slack scope filter** — Slack agent now scopes to DMs + channels the
  user has posted in within the last 30 days, plus `#incident-*`. Active
  channel list is cached for 24h. Skips the long tail of channels the
  user is a member of but doesn't engage with.
- **Drive cap 25 / 14d** — was 50 files over 30 days. The Find palette
  doesn't need more.

### Bug fixes

- **Calendar MCP names** — v0.3.0 shipped with hash-based MCP IDs
  (`mcp__e57d94a3-...`) that only worked on the maintainer's machine.
  Fixed: now uses the generic `mcp__calendar__list_events` /
  `mcp__calendar__list_calendars` names that match `.mcp.json.example`.
  Without this fix the calendar agent would silently fail for every
  other install.
- **Cache poisoning** — failed agent runs writing `sourceOk: false` JSONs
  were being served from the new TTL cache as if fresh. Fixed: cache is
  only valid if BOTH mtime < TTL AND `sourceOk: true`.

### Browser UX

- **Auto-reload banner** — `Work Dashboard.html` now polls itself every
  30s for cache-version bumps. When the dashboard skill writes a new
  `data-override.jsx`, the open tab either silent-reloads (if hidden) or
  shows a "Fresh data available — click to reload" banner (if visible).
  No more remembering to Cmd+Shift+R after a refresh.

### Personalization architecture (formalized)

- **All user-specific data now lives in `~/.claude/dashboard-config.local`.**
  This was already the design in v0.3.0 but several files were leaking
  hardcoded values. v0.4.0 cleans them all up:
  - `build-overrides.py` reads user/team/OKRs/pins/weather/paths from
    config.local (with sensible defaults if missing)
  - All 6 agent files reference "the user" generically; identity comes
    via the orchestrator's kickoff prompts, which `SKILL.md` Step 0 reads
    from config.local
  - No hardcoded `/Users/<name>/...` paths anywhere — `$HOME`,
    `~/...`, or self-locating paths throughout

### Files changed

- `skills/dashboard/SKILL.md` — full rewrite: Step 0 config load, Step 1
  fan-out with TTL cache + wait-and-merge, Step 2 just relays output
- `skills/dashboard/build-overrides.py` — NEW (~370 lines)
- `skills/dashboard/wait-and-merge.sh` — NEW (~85 lines)
- `agents/dashboard-calendar.md` — MCP names fix, `model: haiku`, single-char output
- `agents/dashboard-slack.md` — full rewrite: MCP-free curl + Keychain
- `agents/dashboard-{granola,gmail,drive,wellness}.md` — single-char output,
  N-day window from prompt, Haiku where appropriate, drive cap 25/14d,
  granola: no transcript pulls
- `public/Work Dashboard.html` — auto-reload banner block

### Update path for users on v0.3.0

```
/plugin uninstall work-os@work-os
/plugin install work-os@work-os
```

Then if you want the Slack speedup, add your Slack OAuth token to
Keychain (see README). Your `~/.claude/dashboard-config.local` is
preserved across updates.

---

## v0.3.0 — 2026-04-28

Big release. Eight new product surfaces, a responsive layout, a config-driven
people registry, and a generic Quick Capture pipeline (no more hardcoded
personal data in the plugin).

### New product surfaces

- **What-changed strip** — slim banner at the top showing diffs since you last
  viewed the dashboard ("3 new tasks · 2 inbox replies · 1 blocker"), with a
  "mark seen" button. Resets daily.
- **Meeting prep card** — when a meeting is ≤60 min away, surfaces a contextual
  card with that meeting's attendees cross-referenced against your open Gmail
  threads, owed actions, and pending decisions. Hides itself when no meeting
  is imminent.
- **Stakeholder Lens** — click any teammate (in the People module, the new
  topbar pinned-people strip, or any name mention in tasks/decisions/inbox)
  → side drawer slides in showing every owed action, open thread, decision,
  blocker, today's meetings, and recent meetings together for that person.
  Powered by the new `meetingHistory` field from the granola agent + the
  new `knownPeople` / `pinnedPeople` config fields.
- **Auto-prioritization for Top-3** — algorithm scores every open task by
  deadline pressure × stakeholder seniority × OKR alignment × priority field.
  Surfaces a one-line "Algo suggests: <task>" hint below the Top-3 if any
  open item beats the lowest-scoring Top-3 entry.
- **Commitments tracker** — new draggable module that surfaces every owed
  task/decision grouped by recipient (each stakeholder you owe something to),
  sorted by aging within each stakeholder. Click a recipient row → opens
  the Stakeholder Lens for them.
- **Quick Capture** — silent global hotkey (⌃⌘T by default) to add a task
  from anywhere. Pure HTTP push to dashboard-helper at `/quickcapture` →
  helper writes a queue file → dashboard polls every 4s and dispatches the
  task into the live state. **No Chrome interaction, no URL change, no focus
  shift.** Confirmation toast shows when the task lands. Requires the new
  `dashboard-helper` `/quickcapture` + `/quickcapture/pending` endpoints
  (server v0.2.0+).
- **Decision archive** — "Log" button on every pending decision opens a modal
  capturing what was decided + why + outcome (Approved/Declined/Deferred).
  Saved to `localStorage.dashboard.decisionArchive.v1` (no TTL — full
  traceability when stakeholders ask "why X over Y three weeks ago"). New
  Pending/Archive tabs on the Decisions section.
- **Read-only share URL + section-selectable digest** — Share button in
  topbar opens a modal with: section checkboxes (Top-3, Overdue, Due soon,
  Blocked, Decisions, Blockers, Projects, Q2 OKRs), Markdown/Plain format
  radios, and a live preview textarea. The OKRs section synthesizes a one-
  paragraph narrative per OKR ("Done this week: …; In progress: …; Blocked:
  …") from your tagged + keyword-suggested items. Plus `?view=read` URL mode
  that strips edit affordances for screenshots/screen-share.

### Layout & responsive

- **Responsive layout** — viewport meta unlocked from `width=1440` to
  `width=device-width`. At ≥1280px the canvas keeps its pixel-perfect
  drag layout; below 1280px modules reflow into a single full-width
  stacked column (vertical scroll only — no horizontal overflow at
  any width). Stat tiles use `auto-fit minmax(220px, 1fr)` so they
  wrap from 4 → 3 → 2 → 1 columns gracefully.
- **Toggle/draggable sidebar** — chevron button on the rail's right
  edge collapses to 56px icon-only mode; drag the right edge to set
  any width between 56–360px. Persisted to
  `localStorage.dashboard.railWidth.v1`.
- **Reorganized canvas defaults** — `DEFAULT_D_BOXES` rebalanced so
  both columns end at the same y. Top-3 + Calendar above the fold,
  text-heavy modules left (720px), list-style modules right (400px),
  Pins as a full-width footer strip. Existing custom layouts are
  preserved (load merges old positions with new defaults); click
  Reset to apply the new arrangement.

### Config-driven people registry (BREAKING)

- **`knownPeople` and `pinnedPeople`** moved from hardcoded in-file
  arrays to `dashboard-config.local` JSON config. Empty by default —
  the plugin no longer ships any name data. The dashboard skill
  expands these into `window.SEED.knownPeople` /
  `window.SEED.pinnedPeople` on every refresh. See the example
  template for the schema.
- The `data-override.jsx` is now generated with `knownPeople` and
  `pinnedPeople` arrays alongside the existing static blocks.
- The "Reports to {manager}" hardcode in the rail user card now reads
  from `SEED.user.role`.

### Granola agent

- New `meetingHistory` output field — last-14-days flat list of
  `{date, title, attendees}` per meeting. Powers the Stakeholder Lens
  "Recent meetings together" + "Last met" hints.
- Output schema bumped (additive — old fields unchanged).

### Migration

```bash
/plugin update work-os
```

After install, copy the new fields from `dashboard-config.local.example`
into your `~/.claude/dashboard-config.local`:

```json
"knownPeople":  [ ... ],
"pinnedPeople": [ ... ]
```

Then run `/dashboard` to regenerate `data-override.jsx`. Hard-reload the
dashboard tab. The Stakeholder Lens, click-a-name, and pinned-people
strip will activate as soon as you've populated those arrays.

### Required helper version

Quick Capture requires `dashboard-helper-svc` v0.2.0+ (adds
`/quickcapture` + `/quickcapture/pending` endpoints). Restart the helper
after pulling.

---

## v0.2.1 — 2026-04-28

Bug-fix release.

- **Done state TTL bumped from 12 hours → 7 days.** Tasks marked complete were
  reappearing the next morning when the agent re-suggested them from
  Granola/Gmail (the source hadn't been updated). 7 days gives a realistic
  buffer; if a task is still in source after a week, it'll surface again — a
  signal worth showing.
- **No other code changes.** Same UI, agents, MCPs, and config schema.

Update: same one-line install — `/plugin install work-os@work-os` — picks up
the new version. Hard-reload the dashboard tab to apply.

---

## v0.2.0 — 2026-04-27

**Renamed** plugin from `work-dashboard` → `work-os` (was conflicting with prior installations on colleague machines).

### OKR linking (Layers 1+2+3)
- Tag any task / Top-3 / decision / shipped row to one of the 3 OKRs with a one-click chip + picker. localStorage-persisted, keyed on normalized title (survives `/dashboard` refreshes).
- OKR rows in Projects module are expandable — click to see linked evidence (manual tags + auto-suggested via keyword classifier).
- "Generate review notes" button compiles a markdown summary per OKR to clipboard. Drop-in for weekly 1:1s.

### Task UX
- × button (hover-revealed) dismisses tasks for 14 days (localStorage TTL). "X hidden · restore" link in module header.
- Checking off a task pulses green for 4s, then auto-archives (12h TTL). Stronger done-state visual: ✓ done pill replaces priority flag, full row dims to 55%, strikethrough on title + meta.
- New tasks added via "New task" button now persist to localStorage and survive `/dashboard` refreshes (previously vanished on reload).
- Dismissing or completing a user-added task fully deletes it (vs hide-with-TTL for agent-sourced tasks).

### Hero
- Time-of-day greeting auto-detects from system clock (was hardcoded `afternoon`). Re-checks every 5 min so it flips at hour boundaries.
- Subtitle now derived from live state (priorities left, decisions pending, shipped count) instead of hardcoded text. Updates as state changes without reload.

### Calendar agent fix
- Sub-agents inherit a stale `currentDate` from session start that goes stale within a day. Calendar agent now requires Bash `date` check at Step 0 and explicitly distrusts context-injected currentDate.
- Dashboard skill orchestrator now passes today's date in every agent prompt (belt-and-suspenders).
- Agent type vocabulary tightened: no more `type: "done"` — done-ness is computed at render time from the live clock.
- Defensive title fallback when Reclaim/Motion-scheduled blocks have no `summary` field (was silently dropping events).

### Slack helper integration (browser side)
- `helper-client.jsx` exposes `window.DashboardHelper` with one-click send + queue-aware polling. Falls back to clipboard + open-in-Slack when the local helper service is offline.
- Slack module's "Suggested" buttons + compose box now route through the helper. Status pill shows live/offline mode in module header.
- Helper service itself (Node bridge to Slack) is per-machine setup, not bundled in plugin yet.

### Files changed
- `public/app.jsx` (+~400 lines)
- `public/modules-a.jsx` (+~130 lines · new OkrTagger component)
- `public/modules-b.jsx` (+~190 lines · expandable OKR rows + Slack helper hooks)
- `public/dashboard.css` (+~360 lines · chips, pickers, toasts, evidence panels)
- `public/helper-client.jsx` (NEW)
- `agents/dashboard-calendar.md` (date discipline rewrite)
- `skills/dashboard/SKILL.md` (orchestrator passes date to agents)
- `.claude-plugin/plugin.json` (renamed `work-dashboard` → `work-os`, version → 0.2.0)
- `README.md` (updated install commands)

### Update path for users on v0.1.0
```
/plugin uninstall work-dashboard@work-dashboard
/plugin marketplace remove work-dashboard
/plugin marketplace add shadishalah-boop/work-os
/plugin install work-os@work-os
```
Then hard-reload the dashboard browser tab (Cmd+Shift+R). Google/Slack OAuth tokens and `~/.claude/dashboard-config.local` persist — no reconfiguration needed.

---

## v0.1.0 — 2026-04-24

Initial public release as `work-dashboard`.

- Six parallel data agents (calendar, granola, gmail, slack, drive, wellness)
- `/dashboard` orchestrator skill
- `/dashboard-setup` interactive onboarding wizard
- Local React-in-browser dashboard
- `.mcp.json` auto-registers 5 MCP servers
- Templates for `dashboard-config.local` and `dashboard-filters.local`
- 2-command install via marketplace
