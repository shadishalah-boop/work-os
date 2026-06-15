# Work OS

A personal work dashboard plugin for [Claude Code](https://claude.com/claude-code) that merges your **Google Calendar, Gmail, Slack, Google Drive, and Granola meeting notes** into a local React-in-browser view.

## Quickstart (for colleagues — 3 steps, ~5 minutes)

> You need: the **Claude Code CLI** installed, your standard company MCP connectors
> (Slack, Gmail, Google Calendar, Google Drive, Granola — check with `/mcp`), and
> **read access to this repo** (ask the maintainer to add you as a collaborator
> while the repo is private).

In Claude Code:

```
/plugin marketplace add shadishalah-boop/work-os
/plugin install work-os@work-os
/dashboard-setup
```

The setup wizard mostly just confirms what it auto-detected (your identity + timezone),
verifies your connectors, opens the dashboard in your browser, and offers to run
your first refresh. After that, `/dashboard` anytime for fresh data. That's it.

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
| Slack    | `Slack`           | Message search (mentions, shipped, incidents) |
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

After `/dashboard-setup` completes, open `<dashboardDir>/Work Dashboard.html` in your browser (the setup wizard prints the exact path). Keep the tab pinned.

Then:

```
/dashboard
```

This fans out to 6 agents in parallel (~30–60s), merges their JSON, and rewrites the dynamic JSX files. Reload the browser tab to see fresh data.

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

## Optional: scheduled auto-refresh (hands-free dashboard)

One command sets it up — ask Claude Code:

> *"Set up the dashboard auto-refresh schedule"*

…or run the helper yourself from the plugin directory:

```bash
bash <plugin>/skills/dashboard/schedule.sh install                       # weekdays 08:00 + 13:00
bash <plugin>/skills/dashboard/schedule.sh install --times "08:00 12:00 16:00"
bash <plugin>/skills/dashboard/schedule.sh install --serve               # + local server (see below)
bash <plugin>/skills/dashboard/schedule.sh status                        # what's scheduled + last log lines
bash <plugin>/skills/dashboard/schedule.sh uninstall
```

On macOS this installs a launchd LaunchAgent; on Linux, tagged crontab entries.
The job runs the same headless refresh `/dashboard` uses and logs to
`~/.claude/dashboard-refresh.log`.

**To make the open tab update itself too** (the full zero-touch experience), use
`--serve`: it runs a tiny localhost-only server for your dashboard folder, and you
open `http://localhost:8787/Work%20Dashboard.html` instead of the file directly.
Why: the dashboard polls itself for fresh data and auto-reloads, but Chrome blocks
that polling on `file://` pages — served over localhost it works everywhere. Without
`--serve`, scheduled refreshes still happen; you just reload the tab when you sit down.

---

## Customizing

### Add your team & OKRs (after install)

These aren't asked during setup — the dashboard's People and OKR cards show a prompt instead. Add them anytime by telling Claude Code *"add my team to the dashboard"* or *"add my OKRs to the dashboard"*, and it'll structure them into your config and refresh. (Or edit `~/.claude/dashboard-config.local` directly — `org.team` and `dashboard.okrs` — and rerun `/dashboard`.)

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

**"Fresh data" banner never appears** — Chrome blocks `fetch()` on `file://` pages, so the auto-reload poller can't work when the dashboard is opened as a local file there. Reload the tab manually after a refresh, or use a browser that allows local-file fetch.

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
