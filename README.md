# Work OS

A personal work dashboard plugin for [Claude Code](https://claude.com/claude-code) that merges your **Google Calendar, Gmail, Slack, Google Drive, and Granola meeting notes** into a local React-in-browser view.

## Quickstart (for colleagues — install entirely inside Claude Code, no terminal)

> You need: **Claude Code** and your standard company MCP connectors (Slack, Gmail,
> Google Calendar, Google Drive, Granola — check with `/mcp`). The repo is **public**,
> so there's nothing to request access to — just add the marketplace and install.

Type these **in the Claude Code chat** (not a terminal) — or run `/plugin` to use the
plugin-manager menu:

```
/plugin marketplace add shadishalah-boop/work-os
/plugin install work-os@work-os
```

Then **restart Claude Code** and run:

```
/dashboard-setup
```

The setup wizard is near-zero-questions: it confirms what it auto-detected (your
identity + timezone) and uses sensible defaults for everything else — pins and file
location are set automatically, verifies your connectors, opens the dashboard, and
offers to run your first refresh. After that, `/dashboard` anytime for fresh data.

> **Sharing tip:** the two `/plugin …` lines above are the whole install — the repo is
> public, so just forward them to any colleague and they're set. No collaborator
> access, no GitHub sign-in gate.

Everything below is reference detail.

---

Invoke `/work-os:dashboard` and the plugin fans out to six parallel agents, pulls fresh data from your MCP servers, merges it, and writes it into a static HTML bundle you keep open in a browser tab. Reload the tab to see the new data.

As of v0.4.1 the whole refresh runs inside a headless `claude -p` subprocess, so your interactive session never sees a permission prompt. This needs the **`claude` CLI on your `PATH`** (see Prerequisites).

All user-specific content (your name, manager, team roster, OKRs, pins, Slack workspace) lives in a private config file on your machine — **nothing personal is bundled with the plugin.**

---

## What's in the bundle

```
work-os/
├── .claude-plugin/plugin.json        ← plugin manifest
├── skills/
│   ├── dashboard/SKILL.md            ← /dashboard  (refresh orchestrator)
│   └── dashboard-setup/SKILL.md      ← /dashboard-setup  (one-time onboarding)
├── agents/                           ← 6 data agents
│   ├── dashboard-calendar.md
│   ├── dashboard-gmail.md
│   ├── dashboard-slack.md
│   ├── dashboard-drive.md
│   ├── dashboard-granola.md
│   └── dashboard-wellness.md
├── public/                           ← HTML + JSX + CSS bundle (copied to your machine on first run)
│   ├── Work Dashboard.html
│   ├── app.jsx / data.jsx / modules-*.jsx / dashboard-d.css
│   └── ds/assets/                    ← icons + default avatar
└── templates/
    ├── dashboard-config.local.example
    └── dashboard-filters.local.example
```

---

## Prerequisites

**1. The `claude` CLI must be on your `PATH`.** `/dashboard` runs the refresh inside a headless `claude -p --permission-mode bypassPermissions` subprocess (that's what keeps the interactive session prompt-free), so the launcher invokes `claude` directly.

**2. Your MCP connectors.** The plugin bundles **no MCP servers** (as of v0.5.0) — the agents use the connectors you already have. At most companies these are the standard managed connectors, already authenticated:

| Source | Default server name | What it provides |
|---|---|---|
| Calendar | `Google_Calendar` | Today's events + suggest-time |
| Gmail    | `Gmail`           | Thread search + read |
| Slack    | `Slack`           | Message search (mentions, shipped, incidents) + send replies |
| Drive    | `Google_Drive`    | Recent files for the Find palette |
| Granola  | `Granola`         | Meeting notes → tasks/decisions/blockers |

Run `/mcp` to see what you have connected. `/dashboard-setup` verifies all five live and records any non-default server names in your config (`mcp` section) — the agents also fall back to a capability search, so differently-named or self-hosted servers work too.

**Timezone is automatic.** Your zone is detected from your computer and re-detected on *every* refresh, so meeting times stay correct even when you travel. To pin a fixed zone instead (e.g. always show HQ time), set `user.timezone` to an IANA name like `America/New_York` in your config; leave it `"auto"` to follow the machine.

If a server is unreachable, its agent returns `sourceOk: false` and the dashboard renders the rest cleanly — the unavailable sections just show empty arrays. You can add sources incrementally.

> **Upgrading from ≤v0.4.x?** The bundled `.mcp.json` community servers are gone (one of them, `granola-mcp`, was unpublished from npm and broke fresh installs), and the Slack `xoxp-` token + macOS Keychain setup is no longer needed — the Slack agent now uses the Slack MCP. You can delete the Keychain entry: `security delete-generic-password -s slack_token`.

---

## Install (2 commands)

In Claude Code, run:

```
/plugin marketplace add shadishalah-boop/work-os
/plugin install work-os@work-os
```

Then run the guided setup — it writes your config file, creates the output directories, copies the bundle, verifies your MCP connectors live, opens the dashboard, and offers to run the first refresh:

```
/dashboard-setup
```

The wizard **auto-fills your identity** (name, email, role, company) from the accounts you've already connected and **auto-detects your timezone** — you mostly just confirm, pick where files go, and see real data. Your **team roster and OKRs aren't asked during setup**: the dashboard shows a prompt in the People and OKR cards, and you add them later just by telling Claude Code *"add my team to the dashboard"* / *"add my OKRs to the dashboard"*. Takes ~2–3 minutes.

If you prefer manual setup, see **Manual install** below.

---

## Upgrading (no uninstall needed)

When a new version ships, just:

```
/plugin update work-os
/dashboard
```

The refresh detects the version change and **re-syncs the HTML/JSX/CSS bundle
automatically** (v0.5.0+), preserving your generated data, task state, and
`custom.css`. Then hard-reload the dashboard tab (⌘⇧R / Ctrl+Shift+R).
Your `~/.claude/dashboard-config.local` and saved canvas layout persist across
upgrades — nothing to redo.

> Note: the bundle re-sync overwrites direct edits to `app.jsx` / `modules-*.jsx` /
> `dashboard*.css` in your dashboard folder. Put visual tweaks in **`custom.css`**
> (never overwritten) instead.

If `/plugin update` says "already on the latest" but you know there's a newer
version, run `/plugin marketplace update work-os` first to refresh the source,
then retry the update.

For breaking changes (rare, called out in the changelog), check
`templates/dashboard-config.local.example` for new config fields and merge
them into your local config.

---

## First run

`/dashboard-setup` does the first run for you — it starts the localhost server, runs the first refresh, and opens the dashboard at its `http://localhost:PORT/Work%20Dashboard.html` URL. Keep that tab pinned (open it over **localhost**, never as a file — see "Viewing the dashboard").

To refresh anytime after:

```
/dashboard
```

This fetches Slack (interactively, for consent), fans out to 5 more agents in parallel (~30–60s), merges their JSON, and rewrites the dynamic JSX files. The tab auto-reloads.

---

## Replying on Slack

Work OS sends Slack messages for real. Because sending is irreversible, the guards are
about preventing *accidental* sends, not about adding friction to intentional ones.

- **From a Claude Code session (reliable):** say *"reply to Pablo on Slack that …"*,
  *"send a Slack message to #team …"*, or run `/dashboard-slack-send`. Claude resolves
  the real recipient, **shows you the exact message + target, and sends only after you
  confirm** (or drafts/schedules if you ask). This is the dependable path — the Slack
  connector is fully available in an interactive session.
- **From the dashboard's reply buttons:** the Slack card's compose box and suggested
  replies **send directly** to the thread (via the local server's `/slack-send`). The
  compose box sends on Enter — you typed it. The one-click **suggested chips need a quick
  confirm click** (first click arms the chip → `Send to #channel?`, second click sends),
  so a stray click can't fire a message to colleagues. If the dashboard isn't served over
  localhost, or the headless Slack connector isn't reachable, the button **falls back to
  copying your text and opening the thread** so you can paste and send. The pill on the
  Slack card (`⚡ send to Slack` vs `open-in-Slack`) tells you which mode is active.

The permission allowlist only auto-approves read-only Slack tools — never a send tool —
so an unattended/headless send still runs under the explicit `bypassPermissions` the
local server uses, and interactive sends always confirm first.

---

## Custom metrics (Looker / Snowflake)

The **Metrics** card can track your own KPIs, pulled live from your data warehouse on
each refresh. It's **source-agnostic** — each metric says where it comes from — but
**Snowflake is the recommended source for anything you share with your team**: it's a
connector you authorize once (like Slack/Gmail) and it works in-session, with no per-user
CLI setup. (If you have neither connector, the card just shows demo numbers.)

**Add metrics right on the dashboard:** click **Edit** on the Metrics card to add / remove
/ reorder metrics, set targets and number format, and choose the source + reference.

- **Snowflake (recommended, zero setup)** — two ways:
  - **Describe it (simplest):** type the metric in plain English (e.g. *"weekly active
    learners, this week vs last week"*) and the refresh agent explores your Snowflake,
    writes the query, and remembers it — no SQL required. This is the "just tell Claude
    what you want" path.
  - **SQL:** paste an exact query returning a `value` column (and an optional `prev` column
    for the ▲/▼ delta), e.g.
    `SELECT wal_current AS value, wal_prior AS prev FROM analytics.kpis.weekly_active_learners`.
- **Looker (optional)** — a LookML field (`fact_payment.payment_fees_over_gmv_proceeds`), a
  Look URL/ID, plain English, or a dashboard tile. Supported, but it currently requires
  **each person to add a Looker MCP to their Claude Code** (e.g. `claude mcp add … --scope
  user`) — a desktop-app Looker connector is *not* visible to Claude Code — so it's a
  power-user extra rather than the team default.

Edits save to `~/.claude/dashboard-metrics.local.json` (or define them in the `metrics`
block of `dashboard-config.local`). The **numbers fill on the next `/dashboard`** — the
browser can't query a warehouse, so the refresh agent fetches the values. Set the
connector names in the config `mcp.snowflake` / `mcp.looker` (a custom name is
auto-detected via the same search fallback the other agents use).

---

## Manual install

If you don't want to use `/dashboard-setup`, just ask Claude Code in any session:

> *"Copy the work-os plugin's `templates/dashboard-config.local.example` to
> `~/.claude/dashboard-config.local`, and the filters template to
> `~/.claude/dashboard-filters.local`."*

(Or find the plugin's install path yourself with `claude plugin list --json` and
`cp` the two templates from its `templates/` directory.) Then edit the config —
fill in the `user` / `org` / `slack` / `dashboard` / `output` sections.

Then run `/dashboard` — the refresh creates the output directories and copies the
HTML bundle automatically when it's missing (and re-syncs it after plugin updates).

**Config file sections:**
- `user` — your name, email, timezone, working hours
- `org` — company name, manager, senior stakeholders you work with, team roster
- `slack` — your workspace slug + user ID + high-signal channel patterns
- `dashboard` — your OKRs, pinned links, weather city, focus hours target
- `output` — where the HTML bundle and JSON cache should live

This file **stays on your machine** — it's never bundled into anything you share.

---

## Daily use

```
/work-os:dashboard
```

Every subsequent run reuses the bundle that's already on your machine — only the dynamic JSX files get rewritten. Reload the browser tab to see updates.

You can edit your config or filters at any time — changes apply on the next run with no plugin reload needed.

---

## Viewing the dashboard (always over `localhost`)

The dashboard **must be served over `http://localhost`, not opened as a file.**
Double-clicking `Work Dashboard.html` (a `file://` page) gives a **blank screen**,
because the browser blocks Babel from loading the `.jsx` files over `file://`.

> **macOS:** keep the dashboard out of `~/Documents`, `~/Desktop`, and `~/Downloads`.
> Those are privacy-protected (TCC), and the launchd server + scheduled refresh are
> denied access there (blank/404 page). The default `~/.claude/dashboard-os` is exempt;
> `schedule.sh serve` warns and self-checks if you've chosen a protected folder.

`/dashboard-setup` handles this for you: it starts a **permanent** localhost server
(launchd on macOS — survives reboots) and opens the right URL. You normally never
think about it. To manage it manually:

```bash
bash <plugin>/skills/dashboard/schedule.sh serve        # start permanent server (default port 8787)
bash <plugin>/skills/dashboard/schedule.sh serve 9000   # custom port
bash <plugin>/skills/dashboard/schedule.sh unserve      # stop it
bash <plugin>/skills/dashboard/schedule.sh status       # show server URL + schedule + last log
```

Then open `http://localhost:8787/Work%20Dashboard.html`.

**To open it, just tell Claude Code *"open the dashboard"*** — it opens the localhost
URL (and starts the server if needed) via `skills/dashboard/open.sh`. Don't open the
`.html` file directly: a `file://` page renders blank (the browser blocks Babel from
loading the app code). If you ever do open the file by accident, the page now shows a
"open over localhost" pointer with a clickable link instead of a blank screen.

## How refreshing works

`/dashboard` fetches all six sources and merges them. It runs in a Claude Code
session because that's where your claude.ai-managed connectors live. So:

- **Manual refresh:** run `/dashboard`, then reload the tab (or it auto-reloads). The
  first refresh asks you to approve each connector once — choose **"don't ask again"**
  (or run the allowlist below) and future refreshes are silent.
- **One-press Refresh button — no Claude Code session needed.** The dashboard's top
  bar has a **↻ Refresh** button, and a banner shows across the top while a refresh is
  in progress. It asks the local server (which runs in the background via launchd, even
  when the Claude Code app is closed) to run a headless refresh; the page auto-reloads
  when done. Requires the `claude` CLI on your PATH and the allowlist to have run. The
  headless refresh covers **all six sources including Slack** — it runs under
  `bypassPermissions`, which clears Slack's consent gate. If a connector isn't reachable
  headlessly on a given machine, that source keeps its last value (no blanking), and you
  can refresh from a Claude Code session for the full set. (The button only works when
  the dashboard is served by `schedule.sh serve` — which setup does — not as a file.)
- **Skip the approval click-through:** run
  `bash <plugin>/skills/dashboard/allowlist.sh` once (setup offers this). It writes
  read-only allow-rules for the connector search/list tools + the plugin's own
  scripts to `~/.claude/settings.json`, so refreshes never prompt afterward. (Manual
  alternative: add rules like `mcp__claude_ai_Google_Calendar__list_events`,
  `mcp__claude_ai_Gmail__search_threads`,
  `mcp__claude_ai_Slack__slack_search_public_and_private` to `permissions.allow`.)
- **Automatic refresh while Claude Code is open.** Every automated refresh needs an
  open Claude Code session (that's where the connectors live), so all of these run
  while the app is open. Two ways:
  - **Exact times** — a **Claude Code scheduled task** running `/work-os:dashboard` at
    e.g. 9:00 / 14:00 / 17:00. Fires at those times while Claude Code is open. (Session
    scheduled tasks may auto-expire ~7 days and need re-arming.)
  - **Never expires** — a **`/loop`**: `/loop 3h /work-os:dashboard` refreshes every
    few hours for as long as the session stays open, no re-arming. Best if you keep
    Claude Code open during the day and don't need exact clock times.

  Run `allowlist.sh` first so the automated refresh never stops on a prompt.
- **Reminders (works even when Claude Code is closed):** a notification at set times
  nudging you to run `/dashboard` (a nudge, not an auto-fetch):
  ```bash
  bash <plugin>/skills/dashboard/schedule.sh remind --times "09:00 14:00 17:00"
  bash <plugin>/skills/dashboard/schedule.sh unremind
  ```

> A launchd/cron job that spawns a fresh `claude -p` is a *different* thing from a
> Claude Code scheduled task — the raw subprocess may not carry your claude.ai
> connectors, so prefer the scheduled task. (`schedule.sh install` is the launchd/cron
> path, useful only if your connectors load headlessly.)

## Uninstalling

Tell Claude Code **`/dashboard-uninstall`** (or *"remove the dashboard"*). It stops
the server and any schedule, and can optionally delete your files/config (backing
them up first). Or run it directly:

```bash
bash <plugin>/skills/dashboard/uninstall.sh            # stop helpers, keep your files
bash <plugin>/skills/dashboard/uninstall.sh --purge    # also delete files/config (backs up to a tarball)
```

Then remove the plugin itself:

```
claude plugin uninstall work-os@work-os
```

---

## Customizing

### Add your team & OKRs (after install)

These aren't asked during setup — the dashboard's People and OKR cards show a prompt instead. Three ways to add them:

- **OKRs, right in the dashboard:** click **Paste OKRs** on the OKR card and paste one per line (`name | percent | trend`). Saved in your browser, kept across refreshes — no Claude Code needed.
- **Ask Claude Code:** *"add my team to the dashboard"* / *"add my OKRs to the dashboard"* — it structures them into your config and refreshes.
- **Edit the config:** `~/.claude/dashboard-config.local` → `org.team` / `dashboard.okrs`, then rerun `/dashboard`.

### Manage your own tasks (local task file)

Beyond agent-sourced tasks, you keep a personal task list in
`~/.claude/dashboard-tasks.local` that merges into the dashboard's Top-3 / Overdue /
Due-soon / Blocked modules. Admin it two ways:

- **Tell Claude Code** — *"add a dashboard task: ship the pricing doc, top 3"*,
  *"mark the legal reply done"*, *"remove X from my dashboard"*, *"list my dashboard
  tasks"*. The `dashboard-task` skill edits the file and re-renders instantly (no
  connectors, no full refresh).
- **Edit the file directly** — each task is `{ "label", "bucket": top3|overdue|dueSoon|blocked, "p": 1-3, "project", "meta", "done" }`. See `templates/dashboard-tasks.local.example`.
- **Drag it in (or click ★)** — grab any task row and drop it onto the **"What actually
  matters today"** card to promote it into your Top-3 — or just hover the row and click the
  **★** button for the same result without dragging. When the local server is running the
  promotion is written back to `~/.claude/dashboard-tasks.local` (bucket `top3`), so
  it's **portable across machines and visible to Claude Code** — not just this browser.
  It survives reloads and `/dashboard` refreshes; hover the promoted item and click its
  **×** to send it back to its original list.

### Edit static blocks

Your team roster, OKRs, pins, and weather city all live in `~/.claude/dashboard-config.local`. Edit the JSON and rerun the skill — no code changes needed.

### Edit visuals

Put CSS tweaks in **`custom.css`** in your dashboard folder — it loads last (so it
wins) and is the one file the bundle re-sync never overwrites.

Deeper changes (module JSX, layout logic) belong in the plugin repo's `public/`:
edit there and push, and every install picks them up on its next refresh. Avoid
editing `app.jsx` / `modules-*.jsx` / `dashboard*.css` directly in your dashboard
folder — those copies are replaced when a plugin update re-syncs the bundle.

### Swap a data source

Each agent lives in `agents/dashboard-<name>.md`. To change what an agent does, edit its markdown. To add a new data source, drop a new `dashboard-<source>.md` in `agents/`, add a matching Step 1 agent call in `skills/dashboard/SKILL.md`, and extend the merge table in Step 3.

---

## Troubleshooting

**"No config found" / config ignored** — Run `/dashboard-setup`, or copy the template per **Manual install** above. If your config exists but has a JSON typo, the refresh confirmation line calls it out (`CONFIG ERROR: …`) and falls back to defaults until you fix it.

**Agent reports `sourceOk: false`** — That MCP server is unreachable or unauthenticated. The refresh confirmation line includes the reason (e.g. `failed: slack (no slack search tool found)`). Run `/mcp` to check status. The dashboard still renders; that source's modules just show empty arrays.

**Refresh fails immediately mentioning "bypass"** — Your (org-managed) Claude Code settings disable `bypassPermissions`, which the zero-prompt refresh needs. Ask your admin about `disableBypassPermissionsMode`.

**Blank page / "Fresh data" banner never appears** — You're opening the dashboard as a `file://` page. It must be served over `http://localhost` (the browser blocks Babel and the auto-reload poller on `file://`). Run `bash <plugin>/skills/dashboard/schedule.sh serve` and open the `http://localhost:PORT/Work%20Dashboard.html` URL it prints. `/dashboard-setup` sets this up automatically.

**Slack section empty after a scheduled refresh** — Slack search needs interactive consent, so scheduled/headless runs can't fetch it. Run `/dashboard` yourself to refresh Slack; the other sources update on schedule.

**Dashboard shows yesterday's data** — Browser cache. Hard-reload (Cmd/Ctrl + Shift + R). If that doesn't help, confirm the skill actually ran — check `<output.dataCacheDir>/*.json` timestamps.

**Browser can't find the HTML** — The file is at `<output.dashboardDir>/Work Dashboard.html`, resolved from your config. Check the first-run log line that printed the full path.

**Empty calendar / events missing** — Some calendar MCPs require you to pass a specific calendar ID. Check that your `calendar` MCP can see the user's default calendar; if not, update the `dashboard-calendar` agent to pass the right calendar ID.

**Want to run the skill from a different Claude Code project** — As long as the plugin is installed and `~/.claude/dashboard-config.local` exists, `/work-os:dashboard` works from any project.

---

## License

MIT. See `.claude-plugin/plugin.json` for authorship.

---

## Contributing

Issues and PRs welcome. When adding a new data source, keep the agent's JSON schema backward-compatible — the skill's merge step is permissive but existing dashboards in the wild will break if field names change.
