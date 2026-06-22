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

## v0.15.2 — 2026-06-22

**Fix: drag-to-promote genuinely works now.** Two bugs kept v0.15.0/v0.15.1 from ever
working in the browser:

1. **Stale cached JS (the big one).** The dashboard cache-busts its scripts with `?v=N`
   in the HTML, but v0.15.0/v0.15.1 changed `app.jsx` / `modules-a.jsx` / `dashboard.css`
   without bumping those numbers — so browsers kept serving the *old* cached bundle that
   had no drag code at all. Bumped `modules-a.jsx?v=24`, `app.jsx?v=62`, `dashboard.css?v=28`.
2. **`dataTransfer.types` during `dragover`.** The Top-3 drop zone only called
   `preventDefault()` (which is what *allows* a drop) when the custom `application/x-dash-task`
   MIME type was visible during `dragover` — but Safari and some setups don't expose custom
   types until `drop`, so the drop was silently rejected. Now a global flag set on the task
   row's `dragstart` (with the payload stashed as a fallback) drives the zone, which is
   reliable across browsers.

If a drag still doesn't take after updating, re-run `/dashboard` so the bundle re-syncs
(the `?v=` bump then forces the browser to fetch the new scripts).

---

## v0.15.1 — 2026-06-21

**Top-3 promotions are now portable, not just browser-local.** A dragged-in promotion
(v0.15.0) was localStorage-only — it lived in one browser and Claude Code couldn't see it.
Now it also writes back to `~/.claude/dashboard-tasks.local`, the same file the
`dashboard-task` skill manages.

- **New server endpoint** `POST /promote-task` (`{action: "promote"|"unpin", task}`),
  mirroring `/task-status`: it edits the task file but doesn't rebuild the dashboard —
  the UI already updated optimistically and the next refresh reconciles.
  - *promote*: moves an existing file task into the `top3` bucket (remembering its prior
    bucket), or appends a row for an agent-sourced task that isn't in the file yet
    (tagged `added_by:"promote"`).
  - *unpin*: deletes a row we added, or restores a moved task to its previous bucket.
- **Frontend** fires this best-effort alongside the localStorage write — no-op on
  `file://` / offline, so the optimistic layer still works everywhere.
- **Cross-bucket dedup** in `build-overrides.py`: a task in the `top3` bucket is now
  filtered out of overdue/dueSoon/blocked at merge time (Top-3 wins), so a machine
  *without* the localStorage pin still shows each task once.

Caveat: localStorage remains the optimistic layer, so an un-pin made on one machine
won't retroactively clear a stale pin cached in another browser until that browser's
storage is cleared; the file (and thus a fresh `/dashboard`) is the source of truth.

---

## v0.15.0 — 2026-06-21

**Drag a task into "What actually matters today."** Grab any task row in the Tasks card
and drop it onto the Top-3 card to promote it. The `.drag-grip` affordance that was already
on every task row is now live.

- **Drag source**: task rows are HTML5-draggable and carry the task + its source bucket
  under a private `application/x-dash-task` MIME type (so the Top-3 drop zone can tell a
  promotion apart from an internal Top-3 reorder). Done rows aren't draggable.
- **Drop zone**: the Top-3 card highlights while a task is dragged over it and shows a
  "Drop to make it matter today" hint. On drop it fires a `dash:promote-top3` window event
  (same pattern as `dash:task-added`), so it works in every layout without prop plumbing.
- **Persisted + reversible**: promotions are saved to `localStorage`
  (`dashboard.top3Pins.v1`, no TTL) so they survive reloads and `/dashboard` refreshes,
  and the promoted task is filtered out of its original bucket so it never shows twice.
  Hover a promoted item and click **×** to un-pin it back to its source list.
- Read-only shared snapshots can't drag/promote (guarded), matching the rest of the
  read-only behavior.

---

## v0.14.7 — 2026-06-19

**Fix the misleading "tokens per refresh" readout.** The banner summed all four usage
categories — `input + output + cache_read + cache_creation` — at face value, which read
as 350k–400k "tokens" per refresh. That number was real but misleading: cache-read tokens
dominate it (a multi-turn orchestration re-reads its cached prompt prefix every turn, easily
300k+) yet bill at only ~0.1×, so the headline overstated the actual work by roughly 10×. It
also mixed scopes — `total_cost_usd` covers the whole run incl. sub-agents, but the token sum
reflected only the orchestrator.

- **Cost is now the headline** (`$X.XX`) — billing-correct and whole-run.
- The token figure, when shown, is **new tokens only** (`input + output`); cache reads/writes
  are excluded. Typical real figure is tens of k, not hundreds.
- `refresh-headless.sh` computes the new-tokens sum; `app.jsx` leads with cost and labels the
  secondary figure "new tokens".

Note: this readout only appears on the button/headless refresh path (via `serve.py`); a plain
in-session `/dashboard` doesn't emit a usage line.

---

## v0.14.6 — 2026-06-19

**Retry once on a transient blip, fast-fail on everything else.** v0.14.5's fast-fail was
too blunt — it bailed on *any* connector error, including a transient `503`/reset that a
single retry would have fixed. Retries only pay off for transient failures; for deterministic
ones (auth, permission, not-found) the recovery rate is ≈0% and a retry is pure waste. So
every agent now classifies the error:

- **Transient network error** (`5xx`/`503`, connection reset, `429` rate-limit) → **retry
  once** after a brief pause, honoring `Retry-After` on a 429. The first retry captures the
  bulk of what ever recovers; further retries have steeply diminishing returns.
- **Deterministic error** (auth `401`/`403`, permission/consent denied) → fast-fail, 0 retries.
- **Timeout** → fast-fail too: retrying a timeout just burns another full timeout window,
  the worst case for a wall-clock-capped refresh.
- After a failed retry or a deterministic error → write `sourceOk:false` and stop.

Applies to calendar, gmail, drive, granola, metrics, and slack (granola still per-source;
slack retries only search #1). Worst case is now **two** calls on a dead connector, not eight.

---

## v0.14.5 — 2026-06-19

**Fast-fail on a dead connector across every data agent.** When a connector was down
(auth/connection error), agents used to grind through retries, server-name fallbacks, and
per-item attempts before giving up — e.g. the metrics agent spent ~8 tool calls and ~11k
tokens of churn on a Snowflake connector that was simply unreachable. Now every agent
treats its **first** call to a *resolved* tool as the liveness check and bails on the spot.

- **Distinguishes two failures**: *tool not found* (resolution — still try the next
  server-name variant / ToolSearch, cheap and expected) vs. *tool found but the call errors*
  (auth, connection/network, "connector unavailable", timeout, permission denied — the
  connector is **down**). Only the latter triggers fast-fail.
- **On a down connector**: no retries, no other-name variants (a different name won't revive
  a dead backend), no further calls. Write the agent's JSON with `sourceOk:false` +
  `error:"<server> connector unavailable: …"` and stop. One call, not a spiral.
- **metrics** adds a one-shot `SELECT 1` Snowflake probe before any discovery/fetch.
- **granola** applies it per-source: Granola and Zoom are independent, so a dead Granola
  still tries Zoom (and vice-versa); only both-down sets `sourceOk:false`.
- **slack** (inline in the orchestrator): if search #1 errors on a down connector, the other
  three searches are skipped.
- Applies to calendar, gmail, drive, granola, metrics, and slack. Wellness is unaffected
  (it makes no MCP calls). A down source no longer slows the whole refresh.

---

## v0.14.4 — 2026-06-18

**Cache the Slack avatar + workspace for 30 days.** These almost never change, so
calling `slack_search_users` on every refresh was pure waste (~2–3k tokens + one
tool call). Now:

- First refresh (or every 30 days): fetch the profile, save to
  `~/.claude/dashboard-slack-profile.json` (`userAvatar` + `workspace`).
- Subsequent refreshes within 30 days: skip the `slack_search_users` call and read
  the cached file.
- To force a re-fetch (changed your photo, joined a different workspace): delete
  `~/.claude/dashboard-slack-profile.json` and run `/dashboard`.

`prep.sh` exposes `SLACK_PROFILE_FRESH=yes|no` + `SLACK_PROFILE_FILE` so the
orchestrator's Slack inline step can branch cleanly.

## v0.14.3 — 2026-06-18

**Wellness reads what calendar already fetched — saves ~12k tokens per refresh.**
The wellness agent used to call `list_events` itself for the whole work-week,
duplicating what the calendar agent already did for today. Now the calendar agent
expands its single API call to cover the entire work-week, writes both
`calendar.json` (today, unchanged) AND a new `calendar-week.json` (the full week),
and wellness just **reads the week file** — no MCP calls, no `list_events`, no
`suggest_time`. The human-sounding `weeklyMessage` (the reason wellness has an LLM
at all) is preserved — wellness still references specific meetings/attendees from
the week.

- `agents/dashboard-calendar.md` — fetches `WEEK_START` → `WEEK_END` in one
  list_events call; writes `calendar.json` (today's slice for the Calendar module)
  and `calendar-week.json` (the full week for wellness).
- `agents/dashboard-wellness.md` — tools narrowed to `Read, Write` (was 9 MCP
  tools). Reads `calendar-week.json`, classifies focus vs meetings, sums hours,
  picks a focus slot heuristically, and writes the contextual weeklyMessage.
- `prep.sh` — computes `WEEK_START`/`WEEK_END` (Mon → Sat) and pre-deletes both
  calendar files when calendar runs.
- `SKILL.md` — Step 3 now uses **two tool blocks**: block 1 spawns calendar +
  gmail + granola + drive in parallel; block 2 spawns wellness alone after block 1
  returns (so `calendar-week.json` is guaranteed to be on disk).

Net effect: calendar agent grows ~11.6k → ~14k (week vs today, one call regardless);
wellness drops ~20k → ~5k (no raw API response in its input). **Save ~12k tokens per
refresh** while keeping the personalized insight that makes the module worth having.

## v0.14.2 — 2026-06-18

**Slack refresh: fewer calls, no stale-file Write fallback.**

- **Drop `response_format: "concise"` from the Slack searches.** The concise format
  strips permalinks, which the schema requires — forcing the orchestrator to re-fetch
  every search in detailed format. Net result: 8 calls where 4 should suffice. Now
  uses the default detailed format with the same `limit: 20` and `include_context:
  false` — fits comfortably under the response cap and keeps real permalinks.
- **Pre-delete `slack.json` in `prep.sh`.** Slack is the only agent whose output file
  wasn't being cleared before its run, so the inline Step 2 Write would hit "file
  exists" and fall back to a Read-then-Write. Now it's a clean CREATE every time —
  one fewer tool call per refresh.

## v0.14.1 — 2026-06-18

**Notion task backend follow-up: snappier done-toggle + warning when the sync hasn't run.**

- **`/task-status` no longer rebuilds `data-override.jsx` synchronously.** The previous
  implementation ran `python3 build-overrides.py` (a 1–3s rebuild) on every checkbox
  click, blocking the HTTP response. Removed — the dashboard already updates its UI
  optimistically, and the next refresh / Notion sync reconciles. Result: ticking a
  task is now instant.
- **Notice banner when the Notion backend is on but no tasks loaded.** When
  `dashboard.tasks.backend == "notion"` and `dashboard-tasks.local` is empty/missing
  (almost always: the user enabled the backend but hasn't run `/dashboard-notion-sync`
  yet), the dashboard now surfaces a small top banner telling them what to do.
  Previously they saw empty task lists with no explanation.

## v0.14.0-Notion — 2026-06-18 (PR #22)

**Opt-in: make a personal Notion "Tasks" DB the source of truth for dashboard tasks.**
Off by default — set `dashboard.tasks.backend: "notion"` in `dashboard-config.local`
to enable; `"local"` (default) keeps the existing behavior unchanged.

- `build-overrides.py` — when enabled, task buckets are sourced only from the
  Notion-synced `dashboard-tasks.local` (no agent task merge, to avoid duplication);
  otherwise identical to before. Manual tasks now also carry `href`/`notion_id`/
  `sync_key` through to the UI.
- New `skills/dashboard-notion-sync` skill — creates dashboard/Granola/Gmail action
  items in Notion (deduped by a `Sync key`), pulls open Notion tasks into the
  dashboard, and pushes status changes back. Runs interactively (needs connectors).
- `serve.py` — new `POST /task-status` endpoint; the dashboard done-toggle posts the
  change so it reconciles to Notion on the next sync. No-op for non-Notion tasks.
- Docs: `tasks` block added to `dashboard-config.local.example`.

## v0.14.0 — 2026-06-18

**Incremental refresh — only fetch what's new.** Each refresh now uses the **exact
timestamp of the previous refresh** as its lookback cutoff (`SINCE_ISO` /
`SINCE_EPOCH` / `SINCE_WINDOW`), instead of re-pulling a fixed 1–7 day window every
time. The reasoning: source history before the last refresh can't have changed, so
re-reading it only burns tokens. Fallbacks: a **fresh install backfills 14 days** (so
it's not empty), and a **gap of >7 days caps catch-up at 7 days**.

- **Gmail + Granola refresh incrementally.** Their prior JSON is kept (not deleted) so
  they read it, fetch only what's new since `SINCE`, merge (dedupe by id; drop items
  >14 days old), and write. If nothing is new, they write the existing data back
  unchanged.
- **Granola skips its expensive call when idle.** `list_meetings` is cheap; if no
  meeting started after `SINCE`, the agent does **not** call `get_meetings` (the call
  that reads full AI summaries) at all.
- **Lighter models + longer caches.** Gmail now runs on Haiku (joining calendar, drive,
  wellness; only Granola stays on Sonnet for extraction quality). Per-agent TTLs
  loosened where safe: calendar 30 min, drive 8 h (was 4 h), granola 2 h, wellness 4 h.

**Token usage in the "Refresh done" banner.** The one-press refresh now reports how
many tokens the run spent — the headless helper runs with `--output-format json` and
the dashboard shows `⚡ 48k tokens · $0.08` under the success message. (Tokens are the
run's reported usage; the cost figure covers the whole run including sub-agents.)

---

## v0.13.0 — 2026-06-17

**Time-based auto theme.** The "Auto" theme setting now switches between light
and dark based on time of day — light from 7 AM to 7 PM, dark from 7 PM to
7 AM — instead of following the browser's `prefers-color-scheme`. A 60-second
check ensures the theme flips automatically at the transition hours without
needing a page reload. The Settings button label now reads "Auto (day/night)"
to make the behavior clear.

---

## v0.12.9 — 2026-06-17

**Cross-source deduplication at merge time.** Multiple agents (Granola, Slack,
Gmail) often surface the same business item with different wording. The merge
step now runs a conservative token-set comparison with a small synonym table
(`agreement↔contract↔deal`, `meeting↔call↔sync`) over every list (top-3,
overdue, due-soon, blocked, blockers, decisions, shipped, inbox) and collapses
items whose normalized titles are equivalent, a strict subset of each other, or
share ≥70% of significant tokens. Survivors carry a `_dedupedFrom` list of the
sources they absorbed, surfaced in the UI as a small "↔ N sources" badge.

The bias is intentionally conservative: when two items look different but
genuinely could be related (e.g. "Pioneer rev-share" vs "Payoneer not closed"),
the heuristic leaves both visible — context-free auto-merge of distinct proper
nouns risks false positives. For those edge cases the user knows are dupes:

**Blockers card now has a dismiss ×** (same UX as Tasks), persisted in
localStorage with a 14-day TTL, plus a "N hidden · restore" strip when any are
hidden.

`skills/dashboard/dedupe.py` — new module with the comparison rules and a
self-test you can run with `python3 skills/dashboard/dedupe.py` to validate
behaviour against examples.

---

## v0.12.8 — 2026-06-17

**Better DM fallback.** When the permalink is missing/fake and the item is a DM,
the click now opens `in:dm from:<person>` instead of a generic name search — so
the actual DM thread is the top result and the user can click in to reply.
(Real fix is still the agent emitting real permalinks per v0.12.7; this just
makes the fallback land in the right place for DMs.)

---

## v0.12.7 — 2026-06-17

**Fix: Slack "There's been a glitch…" on click.** A colleague's refresh produced
DM permalinks like `https://preply.slack.com/archives/D_shadi` — the Slack agent
had fabricated the channel ID from the recipient's name instead of using the
real one from the search result. Clicking landed on Slack's error page.

- Agent spec (`agents/dashboard-slack.md`): explicit rule that permalinks must
  match `[CDG][A-Z0-9]{8,10}` (real Slack channel IDs), never invented from a
  name. If no real ID is available, the item is omitted entirely instead of
  shipping a broken link.
- Client-side guard (`SlackMod`): any permalink that doesn't match the real-ID
  regex is routed through a workspace search for the recipient/channel name
  instead of being opened directly. The dedupe key now also requires a real
  permalink so fabricated IDs can't collide.

---

## v0.12.6 — 2026-06-17

Layout, settings and People fixes from the follow-up review:

1. **Boxes can't be dropped on top of each other.** Move/resize now rejects any
   change that would overlap another visible card — it snaps to the last valid
   position instead of stacking.
2. **Hidden modules reflow to the top.** When you uncheck modules in Settings the
   remaining cards repack into a tight 2-column grid (left = 720, right = 400),
   no more leftover gaps where a hidden card used to live.
3. **Settings has Select all / Select none.** Plus a short hint explaining the
   reflow behaviour.
4. **Calendar "Nothing else today / 0m" card is gone** when there's no upcoming
   meeting. The countdown only shows when there's something to count down to.
5. **Risks & blockers "Open" actually opens.** The button is now a link that goes
   to the source permalink (or a workspace search as a fallback). The Slack
   agent now emits a `permalink` on each blocker.
6. **People: remove + drop self.** Each card has a × to remove someone (persisted
   in localStorage, with a "restore" link). The Personio import drops the
   dashboard owner (their card on the org chart is them, not a teammate to
   track) — both client-side and in `build-overrides.py` / `serve.py` so the
   self-filter holds across refreshes.

---

## v0.12.5 — 2026-06-17

**Photo import "server out of date" fix.** The root cause: `/dashboard` (refresh)
never restarted the local server — only the "open the dashboard" flow did — so after
a plugin update the browser loaded the new bundle while `serve.py` kept running the
old code (missing `/import-org-photo`). Now a refresh self-heals: `wait-and-merge.sh`
restarts the server whenever the recorded server version differs from the plugin
version. Also corrected the in-app error to point at the action that actually
restarts the server ("open the dashboard").

---

## v0.12.4 — 2026-06-17

Polish pass on the v0.12.3 feedback:

1. **Fixed sidebar + topbar.** Switched Layout D to a proper app shell (desktop):
   the left rail and top bar stay put while only the content area scrolls.
2. **Scrollbars match the design.** Thin, rounded, theme-aware scrollbars; the
   Top-3 list uses a translucent light thumb so it sits cleanly on the dark card.
3. **Dark-mode icons visible.** Topbar / rail / module-header icons (black-stroke
   SVGs) are now inverted to light in dark mode — brand app logos and avatars are
   explicitly excluded so they keep their colour.
4. **Metric tile is readable without opening it.** Each tile now shows the
   timeframe, the value's as-of date, a min/max y-hint on the sparkline, the
   period's start/end on the x, and "▲0.9% vs <start>" context.
5. **Metric chart x-axis has middle labels.** Up to 5 evenly-spaced period labels
   (with faint vertical gridlines), not just the two extremes.
6. **Slack shows the time for today's messages.** Agent now formats `updated` as a
   clock time (`14:30`) for same-day messages, `Yesterday 14:30`, `Tue 09:15`, or a
   short date for older — never the bare word "today".
7. **Photo import "not served" fixed.** Server detection now uses `/refresh-status`
   (present in every server version) instead of the new endpoint, so the importer
   no longer wrongly says "open over localhost." If the running server predates the
   import endpoint, it now tells you to run `/dashboard` once to restart it.

---

## v0.12.3 — 2026-06-17

Round two on the v0.12 feedback:

1. **Dark mode — inverted "spotlight" cards fixed.** The Top-3 ("What actually
   matters today") and the next-meeting countdown card are intentionally dark in
   light mode (grey-900 base); the ramp-flip was turning them into white cards with
   dark text. They're now pinned to an explicit dark surface with light text, placed
   last in the stylesheet so they win over earlier overrides. Calendar, wellness and
   any stray light module surfaces also forced dark.

2. **Metric chart — readable Y-axis + instant timeframe switching.** The axis now
   picks enough decimals that adjacent gridlines read as DIFFERENT numbers
   (2.50% / 2.48% / 2.45% instead of "2.4%" three times), with 5 evenly-spaced ticks.
   Switching timeframe now re-renders the chart immediately client-side (zooming into
   the loaded series' recent window) — no /dashboard refresh needed to see a change.
   Finer-grained data still arrives on the next refresh.

3. **Density actually does something.** Compact vs Comfortable now visibly changes
   padding, gaps and row sizing across modules, stats, tasks, Slack, KPIs and people
   (previously density only touched two selectors).

4. **Top-3 scrolls.** The list region scrolls inside its box with the header pinned,
   matching the Tasks card.

5. **Commitments populates automatically.** When no `knownPeople` is configured it
   now derives stakeholders from your team roster (full + first names), both
   client-side and in build-overrides. So tasks that mention a teammate surface here
   without any extra setup.

6. **People — import from a Personio org-chart photo.** The "Your people" card has a
   drop zone (and an "Import photo" action): drop a screenshot of your Personio org
   chart and the local server reads it headlessly (vision) into structured people —
   name, role, group, onboarding/OOO status — then persists them so they survive
   /dashboard refreshes and feed Commitments + name detection.

---

## v0.12.1 — 2026-06-17

Six quality-of-life improvements:

1. **Scroll on "What actually matters today"** — the Top-3 section now scrolls when content
   overflows (max-height 340px), matching the Tasks module behavior.

2. **Metrics: client-side timeframe switching** — if the agent pre-fetches multi-timeframe data
   (`seriesAll` / `seriesLabelsAll`), clicking a timeframe in the chart modal switches the chart
   instantly without requiring a dashboard refresh. For single-timeframe data, the preference is
   saved and the footer clarifies "chart updates on next /dashboard refresh."

3. **Slack: 5th DM in demo data** — added a fifth DM (Lena G.) so the DMs tab always shows at
   least 5 conversations out of the box.

4. **Commitments box now populates** — `CommitmentsMod` used `window.KNOWN_PEOPLE` which was
   empty when `SEED.knownPeople` hadn't loaded yet. Fixed to fall back to `SEED.knownPeople`
   directly. Also added demo `knownPeople` entries so the card works with sample data.

5. **Left rail "coming soon" labels** — non-functional sidebar buttons (Tasks, Calendar, Messages,
   Projects, Metrics, People, Library) now show a subtle "soon" tag and display a brief toast
   ("Calendar — coming soon") on click, instead of doing nothing.

6. **Slack avatar in sidebar** — both the top logo-mark and the bottom user avatar in the rail
   now use the Slack profile photo (`SEED.user.avatar`) when available, instead of showing a
   letter initial or the default avatar SVG.

---

## v0.12.0 — 2026-06-16

**Settings panel (⚙ in the topbar).** Click the gear (left of the bell) to open Dashboard
settings — all four approved options, all matching the current aesthetic:

- **Theme** — Auto / Light / **Dark**. Dark flips the grey ramp so the whole dashboard
  (surfaces, text, borders) goes dark while brand/accent colors stay; Auto follows your OS.
- **Density** — Comfortable / Compact (tightens card padding + grid gaps).
- **Accent** — Pink / Blue / Teal / Yellow (recolors buttons, active tabs, highlights).
- **Show / hide modules** — checkboxes to hide any card (Top 3, Tasks, Metrics, Slack, …);
  hidden cards drop out of the layout live.

Settings persist in `localStorage` and apply **before render** (an early inline script,
so no flash), with a live `dash:settings-changed` event for module visibility.

Verified: 8 DOM checks (modal opens; theme/density/accent apply to `<html>`; hiding a
module records it + dispatches the event) + chart/bell regressions. Bumps `app.jsx` v=56,
`dashboard.css` v=22, plugin 0.12.0.

---

## v0.11.0 — 2026-06-16

**Metrics: a real, comprehensive chart.** Click any metric tile to open a full chart with
**Y-axis labels (min/mid/max, formatted), X-axis period labels, gridlines, a line + area
fill, and the latest-point marker** — not just a number. Each metric has a **timeframe**
(default **12 weeks**), shown on the chart with a **switcher** (12w / 30d / 7d / quarter /
year); changing it updates the metric definition and the new range fills on the next
`/dashboard`. The editor gains a timeframe selector too. The agent now fetches a real
`series` + `seriesLabels` over the chosen timeframe (time-bucketed); build-overrides carries
them; demo metrics ship with 12-week series.

(**Settings panel** — theme / density / accent / show-hide modules — is the next release;
specs approved.)

Verified: 12 DOM checks (tile click → chart modal, real Y/X axis labels, line drawn,
timeframe switcher active-state + persistence) + metrics-editor regression. Bumps
`modules-b.jsx` v=38, `data.jsx` v=7, `dashboard.css` v=21, plugin 0.11.0.

---

## v0.10.0 — 2026-06-16

**Slack read-state, Tasks "hidden" view, and a working notifications bell.**

- **Slack — mark as read.** Each row has a ✓ (on hover) to mark a message read; read items
  **drop out of "Missed"** and dim. ↺ marks unread again. Stored locally (`slackRead.v1`).
  Recent DMs already live in the **DMs tab** (now up to 10) — read or not.
- **Tasks — see hidden ones.** The "Open list" popup now has a **Hidden** section listing
  every dismissed/archived task with a per-item **restore**, so nothing is lost.
- **Bell = changes since last refresh.** The 🔔 next to the clock now opens a popover
  listing what's **new since you last looked** (new tasks, decisions, Slack items), with a
  dot when there's anything. (First load shows nothing — no false noise.)

Carried over: the **skill-popup truncation** was a stale local `serve.py` — v0.9.9 makes
`open.sh` restart the server on version change, so "open the dashboard" (or restarting
Claude Code) now gets the full-output server. **Metrics comprehensive chart** and **Settings
panel** are being designed with your input (see chat) — not in this release.

Verified: 9 DOM checks (bell diff incl. first-load-quiet + already-seen filtering; Slack
mark-read leaves Missed) + Slack-redesign and Tasks-modal regressions. Bumps `app.jsx`
v=55, `modules-a.jsx` v=21, `modules-b.jsx` v=37, `dashboard.css` v=20, plugin 0.10.0.

---

## v0.9.9 — 2026-06-16

**Fixes from testing.**

- **Refresh banner now clears when the data lands.** The banner could hang on
  "Refreshing…" even after the dashboard updated. The auto-reload now marks the reload as
  "fresh data arrived," so the banner resolves to "Updated just now" and **auto-dismisses
  after a few seconds** (done states also auto-dismiss now).
- **Metrics graph plots real data.** The sparkline was a fixed decorative line. It now
  draws the metric's actual recent series — the agent fetches a ~12-point `series` per
  metric (Snowflake/Looker, time-bucketed), and the card plots it. Demo metrics ship with
  real series too.
- **Tasks "Open list" works** — it now opens a popup with every task (Overdue / Due soon /
  Blocked / Shipped) in a scrollable, readable list. (It previously had no handler.)
- **Skill result popup shows the full output** — the truncation was a *stale local server*
  (the popup + full-output capture shipped together, but the running `serve.py` was older).
  Fixed systemically: **`open.sh` now restarts the server when the plugin version changed**,
  so new server endpoints/fixes take effect without you manually restarting it. (This also
  retroactively fixes the metrics save path on stale servers.)

Still pending your input: "scroll for what actually matters today" — I need a bit more on
what you'd like there (see the chat).

Verified: refresh-banner fresh-reload resolve, Sparkline real-series rendering, Tasks
open-list modal (opens/lists/closes), metrics editor + Slack regression. Bumps `app.jsx`
v=54, `modules-a.jsx` v=20, `modules-b.jsx` v=36, `data.jsx` v=6, `dashboard.css` v=19,
plugin 0.9.9.

---

## v0.9.8 — 2026-06-16

**Slack box redesigned — working tabs + a dense, readable list.** The tabs
("You missed this / Mentions / Replies owed") only ever filtered the bottom channel
sublist, so they felt broken now that DMs and the needs-reply queue had their own
sections. And rows were tall, so few fit the small card.

- **Tabs now filter everything.** DMs, channels, and the needs-reply queue are merged
  into ONE list (deduped by permalink), each item tagged, and the tabs —
  **Needs you · Missed · Mentions · Replies owed · DMs** — actually filter that list.
  Only non-empty tabs show, each with a live count; "Needs you" is the default.
- **Compact rows.** Each conversation is a single dense line — icon · name · message
  preview · time · a red dot when it needs you — so many fit at once. Click a row to
  expand the full summary, @-mentions, and the reply box (send + confirm-chip unchanged).
- Cleaner tab styling and priority accent stripes (red/amber) for at-a-glance triage.

Verified: 13 DOM checks (tabs render with counts, default "Needs you", DM/needs-reply
dedupe into one row, tab switching filters, expand→reply sends to the right target,
channel chip arm→confirm, channels-only fallback) + metrics editor regression. Bumps
`modules-b.jsx` v=35, `dashboard.css` v=18, plugin 0.9.8.

---

## v0.9.7 — 2026-06-16

**Round of fixes from real-world testing.**

- **Metrics now actually show what you defined.** Two fixes: (1) the Metrics card renders
  straight from your saved **definitions**, so a metric you add always appears (value `—`
  until fetched) instead of silently doing nothing; (2) running the `dashboard-metrics`
  agent on refresh is now a **required** step in the runbook (it was a soft note the
  refresh could skip — that's why your described metric never populated).
- **Skill results open in a readable popup.** The full skill output is captured server-side
  and shown in a modal (scrollable, copyable) when the skill finishes — not just a tiny
  one-line status in the rail. The rail line becomes "✓ … done — view result" to reopen it.
- **Refresh banner redesigned.** Gone is the big blue top bar; it's now a compact
  bottom-right card that sets the expectation up front — "Refreshing… usually about 2
  minutes" — with elapsed time, a clean result line, and dismiss.
- **Slack-avatar favicon fetch hardened.** It now checks several image fields
  (`image_512/192/72/…`, top-level and nested under `profile`) and both `slack_search_users`
  + `slack_read_user_profile`, so the profile lookup actually yields a URL instead of
  coming back empty.
- **Zoom in the meetings agent — confirmed wired.** `dashboard-granola` pulls Granola +
  Zoom and merges/dedupes; the kickoff passes your `mcp.zoom` server. (If Zoom items don't
  appear, it's because the Zoom MCP isn't reachable in the session, not the agent.)

Verified: skills server (full-output capture) + rail popup DOM tests, metrics
defs→card merge (shows `—` with no fetched value, real value when fetched), and the
existing editor tests. Bumps `app.jsx` v=53, `dashboard.css` v=17, plugin 0.9.7.

---

## v0.9.6 — 2026-06-16

**Fix: rail skills now actually run headlessly (like the refresh button).** v0.9.5 piped
the skill's slash command to `claude -p` on **stdin**, which sends it as literal model
text — so the skill often didn't expand/run. Per the headless docs, a skill runs when
`/skill-name` is in the **prompt string**, so `skill-run-headless.sh` now passes the
command as the `-p` **argument** (`claude -p "/my-skill args"`), which Claude Code expands
and executes. Added a one-time fallback that re-invokes as "Use the <name> skill…" (Skill
tool) if the slash form isn't recognized. (Refresh's `claude -p`/server machinery was
already correct — only the skill invocation form needed fixing.)

Verified: 8 server checks still pass (run-skill starts, executes, relays output). Bumps
plugin 0.9.6 (re-syncs the updated script on `/plugin update`).

---

## v0.9.5 — 2026-06-16

**Run your Claude skills from the dashboard's left rail.** A new **Skills** section in the
sidebar lets each user add their own skill shortcuts and launch them with one click —
**run headlessly via the local server, the exact same way as the refresh button**
(`POST /run-skill` → `claude -p … --permission-mode bypassPermissions` → poll
`/run-skill-status`, with an inline ▶/✓/✗ status line).

- **Add skill** form right in the rail (label + `/command`), saved to
  `~/.claude/dashboard-skills.local.json` via the server (localStorage fallback). Bare
  names are normalized to a slash command.
- New `skill-run-headless.sh` (mirrors `refresh-headless.sh`/`slack-send-headless.sh`) +
  `serve.py` `GET/POST /skills-config`, `POST /run-skill`, `GET /run-skill-status`.
- Same honest caveat as the refresh button: headless runs can't see claude.ai-managed
  connectors, so connector-dependent skills should be run in an interactive session;
  self-contained skills work one-click.

Verified: 8 server checks (skills-config round-trip + validation; run-skill starts,
executes, relays output via status poll) and 9 rail DOM checks (add → normalize → persist
→ render → run → status resolves to done). Bumps `app.jsx` v=52, `dashboard-d.css` v=21,
plugin 0.9.5.

---

## v0.9.4 — 2026-06-16

**Snowflake metrics: just describe them — no SQL required.** You can now add a Snowflake
metric by typing a plain-English description (e.g. *"weekly active learners, this week vs
last week"*); the refresh agent explores your Snowflake, writes the query, fetches the
current + prior value, and remembers the SQL it generated so later refreshes skip
re-discovery. SQL is still available for when you want exact control.

- Editor: Snowflake now has a **Describe it / SQL** toggle (Describe is the default). The
  describe box takes a sentence; the SQL box takes a query.
- Agent (`dashboard-metrics`): handles a Snowflake `nl` reference — discovers the schema
  (scoped to any database/area you name; the account can have many DBs and no default),
  writes a current-vs-prior query, runs it, and emits the `resolvedSql` it used. Reuses a
  prior `resolvedSql` when the description is unchanged.
- Config/template/README lead with the describe-it path.

Verified against the live Snowflake connector: `sql_exec` runs, and schema discovery
works (`SHOW TERSE DATABASES` enumerated the account's databases). 12 editor DOM checks
incl. the new describe→`nl` default mapping. Bumps `modules-b.jsx` v=34, plugin 0.9.4.

---

## v0.9.3 — 2026-06-16

**Fix: the Slack-photo favicon (v0.9.2) never populated.** Two bugs:

- The avatar fetch was added to the Slack *agent spec* but **not to the Step 2 runbook the
  `/dashboard` refresh actually executes** (Slack is fetched inline by the main session,
  which follows SKILL.md, not the agent file). So the refresh ran its 4 searches, never
  fetched the profile image, and `slack.json` had no `userAvatar` → `SEED.user.avatar` was
  empty → the tab kept the "W". Step 2 now has an explicit avatar-fetch step.
- Hardened the favicon script against a race: it no longer gives up the instant `SEED`
  first appears (before the override with the avatar has loaded) — it polls until the
  avatar shows up (or ~20s), then swaps.

Verified: 4 favicon DOM checks (swap on present, keep W on absent, **swap when the avatar
arrives late**). After updating, run `/dashboard` (it now captures your avatar) and
hard-reload. Bumps plugin 0.9.3.

---

## v0.9.2 — 2026-06-16

**Two additions: your Slack photo as the tab favicon, and Zoom notes in the meetings feed.**

- **Tab favicon = your Slack profile photo.** The browser tab now shows your Slack avatar
  instead of the generic "W" mark. The Slack agent grabs your profile image on each
  refresh (`userAvatar` in `slack.json`), `build-overrides.py` puts it on `SEED.user.avatar`,
  and the page swaps the favicon to it once data loads — falling back to the W if there's
  no Slack/avatar. Optional `user.avatar` config override.
- **The meetings agent now reads Granola AND Zoom.** `dashboard-granola` also pulls recent
  Zoom meeting notes/transcripts (when a Zoom MCP is connected), then **merges and dedupes**
  meetings that exist in both apps (same title + start within ~30 min → combined and tagged
  `Granola+Zoom`; otherwise tagged with its single source). Zoom is optional — if no Zoom
  connector resolves it's skipped silently, and Granola-only still works. New `mcp.zoom`
  config (default `Zoom_for_Claude`) + `MCP_ZOOM` plumbing.

Verified: 3 DOM checks of the favicon swap (swaps to the avatar, drops the type attr,
keeps the W when no avatar) and prep.sh emits `MCP_ZOOM`. Bumps plugin 0.9.2 (re-syncs
the HTML with the new favicon script).

---

## v0.9.1 — 2026-06-16

**Metrics card defaults to Snowflake; Looker is now an optional extra.** A desktop-app
Looker connector isn't visible to Claude Code, so using it would force every colleague to
hand-wire a Looker MCP — at odds with "easy to share." Snowflake is a connector you
authorize once (like Slack/Gmail) and it works in-session, so it's the team default now.

- The on-card editor's **"Add metric" defaults to Snowflake**, and Snowflake is first in
  the source dropdown.
- Bundled demo metrics are now Snowflake-sourced (so a fresh install showcases the
  zero-setup path).
- Config/template/README reordered to lead with Snowflake and label Looker as
  power-user-optional (requires `claude mcp add … --scope user` per person).

No functional removal — Looker still works for anyone who has the MCP wired into Claude
Code. Bumps `modules-b.jsx` v=33, `data.jsx` v=5.

---

## v0.9.0 — 2026-06-16

**Customizable Metrics card, powered by Looker and/or Snowflake.** You can now track
your own KPIs on the dashboard, pulled live from your data warehouse — and edit them
right on the card.

- **Source-agnostic by design.** Each metric declares its own `source` (`looker` or
  `snowflake`), so a colleague with only Snowflake, only Looker, or both all get a
  working card. The agent resolves whichever connector that person has (by name, with a
  ToolSearch fallback), so a custom connector name like `Preply Looker MCP` is found
  automatically. If someone has neither, the card keeps its demo numbers — no breakage.
- **All the ways to point at a metric.** Looker: a LookML `view.field` measure (e.g.
  `fact_payment.payment_fees_over_gmv_proceeds`), a Look URL/ID, plain-English, or a
  dashboard tile. Snowflake: a SQL query returning a `value` (and optional `prev`) column.
- **Edit on the dashboard.** The Metrics card has an **Edit** button (like the OKR
  editor): add / remove / reorder metrics, set targets and number formatting, choose the
  source + reference. Saved via the local server to `~/.claude/dashboard-metrics.local.json`;
  the numbers fill on the next `/dashboard` (the browser can't query a warehouse — the
  refresh agent does). You can also define metrics in `dashboard-config.local`'s `metrics`
  block.
- New `dashboard-metrics` agent, `metrics.json` → `SEED.kpis` wiring in `build-overrides.py`,
  `serve.py` GET/POST `/metrics-config`, and the `metrics` config block + a
  `dashboard-metrics.local.example` template.

Verified: live Snowflake fetch through the connector from a real session (confirmed the
value/prev response shape), 9 server checks (`/metrics-config` round-trip + validation,
metrics→kpis fallback) and 12 DOM checks of the editor (derives rows, add/reorder, and
Save POSTs the right ref mapping — Looker→`field`, Snowflake→`sql`). Bumps `modules-b.jsx`
v=32, `dashboard.css` v=16, `data.jsx` v=4.

---

## v0.8.8 — 2026-06-16

**Slack card grows a DM lane and a "needs your reply" queue.** The card was too thin —
DMs were buried among channels and capped. Two new sections now sit at the top, both
with the inline reply box that sends directly (the chip-confirm / compose from v0.8.5):

- **Needs your reply** — a ranked action queue of the most important things awaiting
  *your* response: unanswered DMs + @-mentions + questions owed, each tagged with why
  it's there (`awaiting yes/no`, `@you — pause or keep?`, `reply owed`) and a one-click
  reply. Up to 6 items.
- **Direct messages** — reply to *any* recent DM, not just ones awaiting you. Up to 8,
  each with a snippet and reply box. DMs are no longer mixed into the channel radar
  (which is now relabeled "Channels").

Both lists are derived from the **same 4 Slack searches** the agent already runs — no
extra MCP calls, so the refresh stays just as fast. (Inline message previews and a wider
net were considered and deliberately skipped to keep refresh time flat.)

Plumbing: the `dashboard-slack` agent emits `dms` + `needsReply`; `build-overrides.py`
passes them through; the reply UI was refactored into one shared `renderReply` used by
channels, DMs, and the queue. Bundled demo data (`data.jsx`) gains samples so the
sections show before the first refresh. Bumps `modules-b.jsx` v=31, `dashboard.css` v=15,
`data.jsx` v=3.

Verified: 18 DOM checks (both sections render with counts, DM expand-and-send targets the
right person/permalink, needs-reply chip arms-then-sends to the right `#channel`, and
backward-compat when `dms`/`needsReply` are absent — no crash) plus the existing 15
channel-reply checks still pass after the refactor.

---

## v0.8.7 — 2026-06-16

**Topbar app shortcuts now use the official brand logos.** The plain letter badges
(`C` / `M` / `#` / `D`) were unreadable — no one could tell which app was which. They're
replaced with the real Google Calendar, Gmail, Slack, and Google Drive icons, shipped as
self-contained SVG assets in `ds/assets/` (no network/CDN dependency, render offline).
The colored letter-badge styling is dropped in favor of the 22px icons. Bumps `app.jsx`
to v=51 and `dashboard-d.css` to v=20.

Verified: 15 DOM checks (each link renders its official `<img>` icon with the right
`src` + descriptive `alt`, no letter badges remain, correct hrefs + Slack workspace
substitution, all open in a new tab, no Granola) and SVG well-formedness for all four.

---

## v0.8.6 — 2026-06-16

**Source-app shortcuts moved to the topbar; the "Quick access" card is gone.** The
pinned-apps card at the bottom of the dashboard is replaced by four compact app
buttons in the top bar, right next to the refresh button:

- **Calendar, Gmail, Slack, Drive** (no Granola) — each opens the app in a new tab.
  Slack uses your configured workspace slug; the rest are the standard Google URLs.
- The **`pins` module is removed** from every layout (D default, C, and the A/B column
  layouts), and any previously-saved layout that still placed it is filtered out on
  load, so it won't reappear for existing users.
- New `AppLinks` component in the topbar + `.d-app-link*` styles in `dashboard-d.css`
  (hidden on very narrow widths). Bumps `app.jsx` to v=50 and `dashboard-d.css` to v=19.

Verified: 9 DOM checks of the new buttons (exactly four links, correct hrefs, Slack
workspace substitution + `app.slack.com` fallback, all open in a new tab, no Granola)
and static checks that `pins` is gone from all layouts/switches and AppLinks is wired in.

---

## v0.8.5 — 2026-06-16

**Dashboard reply buttons now SEND to Slack directly (no draft step).** Per your ask,
the Slack card's replies go straight out instead of staging a draft you'd review in
Slack. Sending is irreversible, so the guard moved to the dashboard itself:

- **Compose box** sends immediately on Enter / the send button — you typed it, so it
  goes.
- **One-click "suggested reply" chips** need a quick **confirm click**: the first click
  arms the chip (it turns into `Send to #channel?`), the second click sends. It
  auto-disarms after ~4s. This stops a stray click from firing a real message to
  colleagues, without making you leave the dashboard.
- `serve.py`'s `/slack-send` now calls **`slack-send-headless.sh`** (renamed from the
  draft helper) which uses `slack_send_message` — not the `_draft` variant. Status line
  is `SEND_OK`/`SEND_FAIL`.
- Inline status updated: `📨 Sending to Slack…` → `✓ Sent to #channel`. If the send
  can't go through (dashboard not served locally, or the headless Slack connector isn't
  reachable), it still **falls back to copy-to-clipboard + open Slack** so the reply
  lands. The card pill now reads `⚡ send to Slack` vs `open-in-Slack`.

The `/dashboard-slack-send` skill (interactive, confirm-first) is unchanged — it stays
the path that shows you the exact recipient + text before sending. The permission
allowlist still auto-approves only read-only Slack tools.

Verified before release: 16 `serve.py` checks (send-not-draft prompt, verbatim text,
success/fail/timeout, HTTP routing) and 15 DOM checks of the buttons (chip arms on first
click / sends on second, compose sends, fail→fallback, not-served→copy+open).

---

## v0.8.4 — 2026-06-16

**Send Slack replies from the dashboard — safely.** You asked for Slack message-sending
in Work OS. The Slack MCP can send, but sending is irreversible, so this never sends
on a click — it always confirms (interactive) or drafts (dashboard). Two paths:

- **New `dashboard-slack-send` skill** — the reliable path. Say "reply to <person> on
  Slack", "send a Slack message to <#channel>", or `/dashboard-slack-send`, and Claude
  resolves the real recipient (via `slack_search_users`/`slack_search_channels`, never a
  guessed id), **shows you the exact message + target, and only sends after you confirm**
  (or drafts/schedules if you ask). Runs in the interactive session, where the Slack
  connector works.
- **Reply buttons on the dashboard now stage a Slack DRAFT.** The Slack card's suggested
  replies and compose box POST to a new **`/slack-send` endpoint in `serve.py`** that runs
  a headless **`slack-draft-headless.sh`** to create a **draft** in the thread (draft-only
  — the worst case is an unused draft, never an accidental send). You then review and send
  it in Slack. If the dashboard isn't served locally, or the headless connector isn't
  reachable, it **falls back to copy-to-clipboard + open Slack** automatically. A small
  pill shows which mode you're in (`✎ draft to Slack` vs `open-in-Slack`) and an inline
  status reports the outcome (`✓ Draft staged…` / `📋 Copied & opened Slack…`).

The permission allowlist still does **not** auto-approve any Slack *send* tool — only
read-only ones — so a send always goes through a confirmation or a reviewable draft.

Verified before release: 16 `serve.py` checks (prompt is draft-only & verbatim, success/
fail/timeout handling, HTTP routing incl. empty-body 400 and 404) and 14 DOM checks of
the wired buttons (draft-success, fail→fallback, and not-served→copy+open paths).

---

## v0.8.3 — 2026-06-16

**"Open the dashboard" now opens localhost, not a blank file.** Asking Claude to open
the dashboard used to `open` the raw `.html` (a `file://` page → blank, since the
browser blocks Babel from loading the `.jsx`). Two fixes:

- New `skills/dashboard/open.sh` + a **`dashboard-open` skill** so "open the dashboard"
  (and similar) opens the `http://localhost:PORT/...` URL — resolving the port and
  starting the server first if needed. Setup uses it too.
- **`file://` guard in the HTML**: if the dashboard is ever opened as a file, it now
  shows a clear "open over localhost" message with a clickable link, instead of a
  blank page. (Plain JS, so it runs even when the app code can't load.)

---

## v0.8.2 — 2026-06-16

**Fix: the refresh banner now always resolves and shows the result.** A button refresh
could run with a "Refreshing…" banner that never cleared and gave no outcome. Fixed at
two levels (without removing Slack — the hang cause wasn't assumed):

- `serve.py` now hard-caps the refresh at **5 minutes** (`REFRESH_TIMEOUT`), so a stuck
  run always ends and reports `ok:false` with a clear message. `/refresh-status` also
  returns `elapsed`/`started_at`.
- The dashboard banner is rewritten to **always resolve**: it shows elapsed seconds, a
  "taking longer than usual" note after ~2.5 min, and on completion the **actual result
  line** (e.g. `✓ Refreshed — Dashboard refreshed · 6/6 sources …` or the timeout/error
  message) — and it's **dismissible** (✕). So you can always tell whether it worked.
- Slack stays in the headless refresh (STEP 1b) but is now explicitly **time-boxed**:
  if its call stalls it's skipped and the last good `slack.json` is kept, so it can't
  hang the run. `app.jsx?v=49`.

---

## v0.8.1 — 2026-06-16

**Slack now included in the headless/button refresh + a "refresh in progress" banner.**

- **Slack in headless** — the headless refresh runs under
  `--permission-mode bypassPermissions`, which clears Slack's consent gate, so the
  orchestrator now fetches Slack **inline** in `headless-prompt.md` (STEP 1b) using the
  `claude_ai_Slack` tool name and small/concise search responses. So the ↻ button and
  any headless refresh now cover all six sources. Safety: on any Slack failure it leaves
  the last good `slack.json` untouched (never blanks it); `prep.sh` doesn't pre-delete
  `slack.json`.
- **Refresh-in-progress banner** — a prominent top bar ("🔄 Refreshing your dashboard
  data…") appears whenever a refresh is running, driven by the server's
  `/refresh-status` (so it shows for the button from any tab) plus instant feedback on
  click. Turns to "✓ Dashboard refreshed" before the auto-reload swaps in the data.
  Silent if the server doesn't expose `/refresh-status`. `app.jsx?v=48`.

---

## v0.8.0 — 2026-06-16

**One-press Refresh button on the dashboard — no Claude Code session needed.**

- New `skills/dashboard/serve.py` replaces the plain `http.server`: it serves the
  bundle AND exposes `POST /refresh` (kicks off a background headless refresh via
  `refresh-headless.sh`, launched through a login shell so `claude` is on PATH under
  launchd) and `GET /refresh-status`. `schedule.sh serve` now runs it.
- The dashboard's top bar gained a **↻ Refresh** button (`app.jsx?v=47`): it POSTs
  `/refresh`, shows a spinner while running, and the existing auto-reload swaps in the
  fresh data. Because the server runs in the background (launchd), this works **even
  when the Claude Code app is closed**.
- Honest limits: needs the `claude` CLI + allowlist; a headless refresh updates the
  non-Slack sources (Slack keeps its last value — it needs interactive consent); and
  headless connector availability can vary by machine. The button gracefully shows a
  hint if the server doesn't expose `/refresh` (e.g. opened as a file).

---

## v0.7.3 — 2026-06-16

**A no-expiry "refresh while Claude Code is open" option.** Automated refresh needs an
open Claude Code session (that's where claude.ai connectors live), so it runs while the
app is open. Docs + setup now present two in-session methods clearly:

- **Exact times** — a Claude Code scheduled task running `/work-os:dashboard` (e.g.
  9/14/17). Caveat: session scheduled tasks can auto-expire (~7 days) and need
  re-arming.
- **Never expires** — `/loop 3h /work-os:dashboard`: refreshes every few hours for as
  long as the session is open, no re-arming. (The per-agent TTL cache keeps frequent
  loops cheap.)

Setup's cadence step and the README now explain both (plus OS reminders as the
closed-app fallback). No behavior change to the refresh itself.

---

## v0.7.2 — 2026-06-16

**Prominent OKR input + stop fabricating people's roles.** From a live install.

- **OKR input is now an obvious, always-present control.** The OKR section's button
  is a real button (`➕ Set OKRs` / `✏️ Edit OKRs`), and when no OKRs are set it shows
  a prominent dashed call-to-action card ("No OKRs set for this quarter — Set your
  OKRs") instead of a faint one-line link. It was always *there* (in the Projects
  card), just buried below the fold and too subtle. Paste/edit anytime to update each
  quarter. `modules-b.jsx?v=28`.
- **Setup never invents a person's title/role.** It had fabricated a manager's role
  ("CEO") from just a name and even claimed the user provided it. New rules: store
  `org.manager.role` as `""` when only a name is given, never guess titles for the
  manager or teammates, and never attribute invented values to the user.
- **Slack search size guard** — the refresh now passes `response_format: "concise"`,
  `limit: 20`, `include_context: false` so Slack searches don't blow past the token
  limit (the live install hit 63–80K-char responses).
- **Fixed broken `agents/…` path** in the refresh skill — now
  `${CLAUDE_PLUGIN_ROOT}/agents/dashboard-slack.md` so the Slack schema is readable
  (the install couldn't find the relative path).

---

## v0.7.1 — 2026-06-16

**Correction: scheduled auto-refresh DOES work — via a Claude Code scheduled task.**
v0.6.0–v0.7.0 claimed timed auto-refresh was impossible with claude.ai connectors.
That was wrong. It was based on a failed *launchd `claude -p`* run whose real problem
was tool-name resolution (a `claude_ai_` prefix bug fixed in v0.6.1), misread as "no
connectors." A **Claude Code scheduled task** runs `/dashboard` inside an
authenticated session, so the connectors are present and it refreshes for real.

- Docs now recommend a **Claude Code scheduled task running `/work-os:dashboard`** (at
  e.g. 9:00 / 14:00 / 17:00) as the way to auto-refresh — pair it with `allowlist.sh`
  so the scheduled run never stops on a permission prompt.
- The reminder notifications from v0.7.0 remain as a no-setup fallback.
- Removed the incorrect "auto-fetch is impossible" language from the README, the
  refresh skill, and setup. The raw launchd/cron `claude -p` path stays flagged as
  the *less reliable* one (may not carry claude.ai connectors), not "impossible."

---

## v0.7.0 — 2026-06-16

**Refresh reminders + a local task list.**

### Refresh reminders at your chosen times

A true timed auto-fetch is impossible with claude.ai connectors (a background job
can't reach them). Instead, `schedule.sh` gained `remind` / `unremind`: a
notification at set times (default weekdays **09:00 / 14:00 / 17:00**) nudging you to
run `/dashboard` (one click). `/dashboard-setup` now **asks your refresh cadence** and
installs it. macOS = launchd + osascript; Linux = cron + notify-send.

### Local task list you administer

New `~/.claude/dashboard-tasks.local` — your own tasks, merged into the dashboard's
Top-3 / Overdue / Due-soon / Blocked modules on every refresh (and on a quick
re-merge — no connectors needed). Admin it via the new **`dashboard-task`** skill
("add a dashboard task …", "mark … done", "remove …", "list") which edits the file
and re-renders instantly, or by editing the file directly. Setup creates an empty
file; `templates/dashboard-tasks.local.example` documents the schema.

---

## v0.6.2 — 2026-06-16

**One-step pre-approval — refreshes stop prompting.** New
`skills/dashboard/allowlist.sh` writes read-only permission allow-rules into
`~/.claude/settings.json` for exactly what the refresh uses: the calendar / gmail /
drive / granola / slack **search & list** tools (both bare and `claude_ai_`-prefixed
names) and this plugin's own scripts (version-globbed so updates don't re-prompt).
Run it once and `/dashboard` refreshes are silent from the next session on — instead
of clicking "don't ask again" ~8 times. Idempotent; preserves existing settings.

- `/dashboard-setup` now offers to run it during onboarding.
- README + the refresh skill document it, plus a manual `permissions.allow` snippet
  for anyone who prefers to paste the rules themselves.
- It grants only read-only search/list tools — never write/send tools — and prints
  every rule it adds for review.

---

## v0.6.1 — 2026-06-15

**Closes the remaining install-report bugs.** A detailed v0.5.5 install report
confirmed the connector realities; v0.6.0 fixed the headless premise, and this
release fixes the rest.

- **Sub-agent `tools:` frontmatter IS enforced** (the old docs claimed otherwise) —
  and a sub-agent's ToolSearch is scoped to that allowlist. So every agent now lists
  the **`claude_ai_`-prefixed** connector tool names in frontmatter (Slack included),
  and each agent's resolution step tries the `claude_ai_` prefix explicitly before
  falling back to ToolSearch. The false "frontmatter doesn't restrict" comment is gone.
- **Agents can now overwrite a stale JSON.** They have a `Read` tool and are told: if
  a Write reports the file already exists, Read it once then Write — instead of the
  old dead-end ("just Write again"), which silently dropped freshly-fetched data when
  a prior run had left a stale file. (prep still pre-deletes; this is the safety net.)
- **Connector-name resolution no longer depends on setup writing the right name** —
  agents try `claude_ai_<Name>` regardless of the config value, so a bare-name config
  still resolves the managed connector.

---

## v0.6.0 — 2026-06-15

**Refresh now runs in-session (headless removed).** A live install proved that
**claude.ai-managed MCP connectors are invisible to a headless `claude -p`
subprocess** — they exist only in the interactive session. The v0.4+ headless-refresh
architecture therefore fetched nothing for that (common) connector type: all six
sources failed in the subprocess. Fixed by running the whole refresh in the
interactive session.

- `/dashboard` now: `prep.sh` → **in-session** fan-out to the 5 data agents + inline
  Slack → `wait-and-merge.sh`. No more headless subprocess for fetching.
- Each data agent's frontmatter now includes the **`claude_ai_`-prefixed** tool names
  (the real managed-connector names), plus a fallback: if a sub-agent still can't see
  a connector, the main session performs that agent's spec inline.
- **Trade-off (unavoidable):** the first refresh asks to approve each connector tool
  once — choose "don't ask again" and it's silent thereafter. This is the cost of
  session-scoped connectors; headless's zero-prompt promise was incompatible with them.
- **Scheduled auto-refresh of data is not possible** with claude.ai connectors (a
  background job can't see them). Setup no longer offers it; the permanent localhost
  *server* still runs in the background. `refresh-headless.sh` / `headless-prompt.md`
  are deprecated (kept only for headless-capable connectors).

---

## v0.5.7 — 2026-06-15

**Slack actually works now + no setup approval prompts.** Two fixes from a live install.

### Slack: run it in the main session, not a sub-agent

The `dashboard-slack` **sub-agent** is sandboxed to the bare `mcp__Slack__*` tool
names and **cannot reach a session's managed connector** (commonly exposed as
`mcp__claude_ai_Slack__…`), so spawning it always failed with "no Slack search tool
found." The refresh now performs the Slack search **inline in the main interactive
session** (which can reach the prefixed connector and can grant the required
consent). Tool resolution tries `claude_ai_Slack` and other prefixes before
falling back to ToolSearch. `agents/dashboard-slack.md` is now a spec the main
session follows, not a spawned agent.

### Setup: one allowlistable call instead of approval prompts

Setup used to run several ad-hoc heredoc bash blocks (write config, copy bundle,
stamp, filters) — each un-analyzable, so each triggered a permission prompt. All of
it now runs through one committed script, **`setup-finalize.sh`**, invoked as a
single `bash setup-finalize.sh /tmp/work-os-setup.json` call (the config is staged
to a temp file, so there's no sensitive-path Write prompt either). Approve once with
"don't ask again" and setup is prompt-free.

---

## v0.5.6 — 2026-06-15

**Near-zero-questions setup.** Removed the last two setup prompts — **pins** and
**output location** are now silent defaults. The only thing the user actively
answers is the identity confirmation (plus the Reset/Edit/Cancel choice if a config
already exists). Pins are the 5 standard quick-links (Slack subdomain derived from
the email domain); output goes to `~/.claude/dashboard-os` automatically.

---

## v0.5.5 — 2026-06-15

**Paste OKRs from the dashboard.** The OKR card now has an **Edit / Paste OKRs**
button — paste them straight into the dashboard, no Claude Code or config editing
needed. One OKR per line (`name | percent | trend`; percent and trend optional).

- Saved in the browser (`localStorage`, like the dashboard's other edits) and merged
  into `window.SEED.okrs`, so the OKR tagger, auto-suggest keywords, pill labels, and
  "Generate review notes" all pick them up. Survives `/dashboard` refreshes.
- Pill label and auto-tag keywords are derived from each OKR's name automatically.
- The empty state now offers a one-click **Paste OKRs** link in addition to the
  "ask Claude Code" path. Config-defined OKRs still work and are shown alongside.

---

## v0.5.4 — 2026-06-15

**macOS hardening, from a real first install.** Fixes the issues a live Mac setup
hit (full report drove these changes).

### Default output path moved out of `~/Documents` (macOS TCC) — CRITICAL

macOS privacy protection (TCC) denies launchd-spawned processes read/write access
to `~/Documents`, `~/Desktop`, and `~/Downloads` without Full Disk Access. Since the
permanent server and the scheduled refresh both run via launchd, the old default
`~/Documents/...` made them fail (server served 404; scheduled refresh couldn't
write) — even though a manually-started server worked. The default `dashboardDir` is
now **`~/.claude/dashboard-os`** (TCC-exempt). `_config.sh`, `build-overrides.py`,
the setup wizard, and the config template all updated.

- `schedule.sh serve` now **warns** if the bundle is under a protected folder, and
  **validates** after install (curls the server; on non-200 it explains the TCC
  cause and the fix instead of silently serving 404s).
- Setup's output-directory step warns against Documents/Desktop/Downloads.

### Connector names: `claude_ai_` prefix

Real claude.ai-managed connectors resolve under names like
`claude_ai_Google_Calendar` / `claude_ai_Slack`, not the bare defaults. Setup now
tries the prefixed variants before falling back to a capability search, and the
config template documents this. (Detection already worked via fallback; this makes
it first-class.)

---

## v0.5.3 — 2026-06-15

**Renders reliably, fixes Slack, easy to remove.** Addresses the three things that
bit the first real install.

### Blank page fixed — permanent localhost server by default

Opening `Work Dashboard.html` as a `file://` page gives a blank screen: the browser
blocks Babel from fetching the `.jsx` files over `file://`. The dashboard must be
served over `http://`. Setup now **starts a permanent localhost server automatically**
(launchd on macOS, survives reboots) and opens the `http://localhost:PORT/...` URL —
no more blank page, and no question about "temporary vs permanent."

- `schedule.sh` gained first-class `serve` / `unserve` commands (server is now
  independent of scheduled refresh). `status` shows the server + URL.

### Slack fixed — fetched interactively (consent)

Slack's `slack_search_public_and_private` requires **user consent**, which the
headless refresh subprocess can't give — so Slack silently failed while the other
sources worked. Slack is now fetched from the **interactive `/dashboard` session**
(where consent works), before the headless step; the merge reads that `slack.json`.
Scheduled/headless refreshes keep the last interactive Slack data and refresh the
other five. `prep.sh` no longer manages or deletes `slack.json`.

### Easy uninstall

- New `/dashboard-uninstall` skill + `uninstall.sh`: stops the server and scheduled
  refresh, and (with `--purge`) deletes the dashboard files/config after backing
  them up to a tarball. Prints the `claude plugin uninstall work-os@work-os` command
  for removing the plugin itself.

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
