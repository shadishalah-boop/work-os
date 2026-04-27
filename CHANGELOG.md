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
