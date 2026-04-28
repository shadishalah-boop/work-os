# Work Dashboard

A personal work dashboard plugin for [Claude Code](https://claude.com/claude-code) that merges your **Google Calendar, Gmail, Slack, Google Drive, and Granola meeting notes** into a local React-in-browser view.

Invoke `/work-os:dashboard` and the plugin fans out to six parallel agents, pulls fresh data from your MCP servers, merges it, and writes it into a static HTML bundle you keep open in a browser tab. Reload the tab to see the new data.

All user-specific content (your name, manager, team roster, OKRs, pins, Slack workspace) lives in a private config file on your machine — **nothing personal is bundled with the plugin.**

---

## What's in the bundle

```
work-dashboard/
├── .claude-plugin/plugin.json        ← plugin manifest
├── .mcp.json                         ← auto-registers the 5 MCP servers on install
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

The plugin's `.mcp.json` auto-registers 5 MCP servers on install. Each needs per-user auth:

| Server | What it provides | Auth needed | Works out of the box? |
|---|---|---|---|
| `calendar` | Google Calendar read + suggest-time | Google Cloud OAuth `credentials.json` | No — set `GOOGLE_OAUTH_CREDENTIALS` env var |
| `gmail`    | Gmail search + thread read | Google OAuth (browser prompt on first use) | Yes |
| `slack`    | Slack search + read channel/thread | Bot token from `api.slack.com/apps` | No — set `SLACK_BOT_TOKEN` + `SLACK_TEAM_ID` |
| `drive`    | Google Drive list/search | Google OAuth (browser prompt on first use) | Yes |
| `granola`  | Granola meeting notes + transcripts | Granola desktop app running locally | Yes |

If a server is unreachable, its agent returns `sourceOk: false` and the dashboard renders the rest cleanly — the unavailable sections just show empty arrays. You can add sources incrementally.

Want to swap in a different MCP? Override entries in your own `~/.claude.json` under `mcpServers` — keep the same server names (`calendar`, `gmail`, `slack`, `drive`, `granola`) so the agents still resolve.

---

## Install (2 commands)

In Claude Code, run:

```
/plugin marketplace add shadishalah-boop/work-os
/plugin install work-os@work-os
```

Then run the guided setup — it writes your config file, creates the output directories, copies the bundle, and prints per-MCP auth instructions:

```
/dashboard-setup
```

The wizard asks ~7 quick questions (name, role, timezone, manager, company, Slack workspace, custom pins). Everything optional can be skipped and edited later. Takes ~3 minutes.

If you prefer manual setup, see **Manual install** below.

---

## Upgrading (no uninstall needed)

When a new version ships, just:

```
/plugin update work-os
/dashboard
```

Then **hard-reload the dashboard tab** (⌘⇧R / Ctrl+Shift+R) to pick up new JSX/CSS.
Your `~/.claude/dashboard-config.local`, `data-override.jsx` task state, and saved
canvas layout all persist across upgrades — nothing to redo.

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

If you don't want to use `/dashboard-setup`:

```bash
# 1. Copy the config template and edit it
cp "$(claude plugin root work-os)/templates/dashboard-config.local.example" \
   ~/.claude/dashboard-config.local

# 2. (Optional) Copy the filter template
cp "$(claude plugin root work-os)/templates/dashboard-filters.local.example" \
   ~/.claude/dashboard-filters.local

# 3. Edit the config — fill in user / org / slack / dashboard / output sections
open ~/.claude/dashboard-config.local
```

Then run `/dashboard` — the skill auto-creates the output directories and copies the HTML bundle on first run.

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

## Optional: scheduled auto-refresh

Plugins cannot ship scheduled tasks (they run per-user-machine), so you set this up yourself. A few options:

### macOS — launchd

```xml
<!-- ~/Library/LaunchAgents/com.you.work-os.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.you.work-os</string>
  <key>ProgramArguments</key>  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>claude -p "/work-os:dashboard"</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
  </array>
</dict>
</plist>
```

Load with `launchctl load ~/Library/LaunchAgents/com.you.work-os.plist`.

### Any OS — cron

```cron
0 8,13,17 * * 1-5   claude -p "/work-os:dashboard" >> ~/.claude/dashboard-cron.log 2>&1
```

### Claude Code scheduled-tasks MCP

If you run the community scheduled-tasks MCP, register a task that invokes the skill on a cron schedule. See its README for details.

---

## Customizing

### Edit static blocks

Your team roster, OKRs, pins, and weather city live in `~/.claude/dashboard-config.local`. Edit the JSON and rerun the skill — no code changes needed.

### Edit visuals

Colors, layout, and module order live in the HTML bundle under `output.dashboardDir/`:
- `dashboard-d.css` — theme + layout
- `modules-a.jsx`, `modules-b.jsx` — individual dashboard modules
- `app.jsx` — orchestration, greeting bar, left rail

Changes there persist. If you want to update the bundled defaults (for yourself or to upstream), edit `public/` in the plugin repo and push.

### Swap a data source

Each agent lives in `agents/dashboard-<name>.md`. To change what an agent does, edit its markdown. To add a new data source, drop a new `dashboard-<source>.md` in `agents/`, add a matching Step 1 agent call in `skills/dashboard/SKILL.md`, and extend the merge table in Step 3.

---

## Troubleshooting

**"No config found" on first run** — Copy the template to `~/.claude/dashboard-config.local` (see Install step 4).

**Agent reports `sourceOk: false`** — That MCP server is unreachable or unauthenticated. Run `/mcp` to check status. The dashboard still renders; that source's modules just show empty arrays.

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
