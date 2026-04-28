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
  task/decision grouped by recipient (Jose, Christopher, Bertrand, etc.),
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
