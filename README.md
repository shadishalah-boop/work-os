# Work Dashboard

A personal work dashboard plugin for [Claude Code](https://claude.com/claude-code) that merges your **Google Calendar, Gmail, Slack, Google Drive, and Granola meeting notes** into a local React-in-browser view.

Invoke `/work-dashboard:dashboard` and the plugin fans out to six parallel agents, pulls fresh data from your MCP servers, merges it, and writes it into a static HTML bundle you keep open in a browser tab. Reload the tab to see the new data.

All user-specific content (your name, manager, team roster, OKRs, pins, Slack workspace) lives in a private config file on your machine — **nothing personal is bundled with the plugin.**

---

## What's in the bundle

```
work-dashboard/
├── .claude-plugin/plugin.json        ← plugin manifest
├── .mcp.json.example                 ← MCP server config template
├── skills/dashboard/SKILL.md         ← /dashboard orchestrator
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

The plugin calls tools from 5 MCP servers. You need to connect each one under these **exact names** (the agents reference them by name):

| Server name | What it provides | Examples |
|---|---|---|
| `calendar` | Google Calendar read/suggest-time | [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) |
| `gmail` | Gmail search + thread read | [Gmail-MCP-Server](https://github.com/GongRzhe/Gmail-MCP-Server) |
| `slack` | Slack search + read channel/thread | [@modelcontextprotocol/server-slack](https://www.npmjs.com/package/@modelcontextprotocol/server-slack) |
| `drive` | Google Drive list/search | [@modelcontextprotocol/server-gdrive](https://www.npmjs.com/package/@modelcontextprotocol/server-gdrive) |
| `granola` | Granola meeting notes + transcripts | [granola-mcp](https://github.com/iamwavecut/granola-mcp) |

You can swap in any MCP implementation that exposes the same tool names — see `.mcp.json.example` for the expected shape. If you don't use one of these sources (e.g. no Granola), that agent will report `sourceOk: false` and the dashboard falls back to empty arrays for its fields.

---

## Install

### 1. Add this repo as a marketplace

```
/plugin marketplace add <your-github-handle>/work-dashboard
```

Replace `<your-github-handle>/work-dashboard` with wherever you've hosted this plugin.

### 2. Install the plugin

```
/plugin install work-dashboard@work-dashboard
```

(First `work-dashboard` = plugin name, second = marketplace name.)

### 3. Connect the MCP servers

Copy `.mcp.json.example` to your project root as `.mcp.json` (or merge into `~/.claude.json` under `mcpServers`). Replace each server's `command` / `args` / `env` with the actual MCP server you want to use. Authenticate each one per its own README.

### 4. Create your config file

Copy the template and edit it:

```bash
cp "$(claude plugin root work-dashboard)/templates/dashboard-config.local.example" \
   ~/.claude/dashboard-config.local
```

Or just copy manually from `templates/dashboard-config.local.example` in the plugin bundle. Open it and fill in:

- `user` — your name, email, timezone, working hours
- `org` — company name, manager, senior stakeholders you work with, team roster
- `slack` — your workspace slug + your Slack user ID + any high-signal channel patterns
- `dashboard` — your OKRs, pinned links, weather city, focus hours target
- `output` — where the HTML bundle and JSON cache should live on your machine

This file **stays on your machine** — it's never bundled into anything you share.

### 5. (Optional) Create a filter list

If there are senders, projects, or topics you want kept off the dashboard (e.g. personal-life items bleeding in from your work inbox), copy the filters template:

```bash
cp "$(claude plugin root work-dashboard)/templates/dashboard-filters.local.example" \
   ~/.claude/dashboard-filters.local
```

Add one pattern per line. The skill does a case-insensitive substring match against sender, subject, title, and meta fields before writing the overlay.

---

## First run

```
/work-dashboard:dashboard
```

On the very first invocation, the skill:

1. Reads your config + filters
2. Creates `output.dashboardDir` and `output.dataCacheDir` (defaults: `~/Documents/work-dashboard/` and `~/.claude/dashboard-data/`)
3. Copies the HTML bundle from the plugin into `output.dashboardDir`
4. Fans out to the 6 agents in parallel (~30–60s)
5. Merges their JSON, writes `data-override.jsx` + `drive-index.jsx`, bumps cache versions

Open `<output.dashboardDir>/Work Dashboard.html` in your browser and keep the tab pinned. A reload after each refresh will pick up the new data.

---

## Daily use

```
/work-dashboard:dashboard
```

Every subsequent run reuses the bundle that's already on your machine — only the dynamic JSX files get rewritten. Reload the browser tab to see updates.

You can edit your config or filters at any time — changes apply on the next run with no plugin reload needed.

---

## Optional: scheduled auto-refresh

Plugins cannot ship scheduled tasks (they run per-user-machine), so you set this up yourself. A few options:

### macOS — launchd

```xml
<!-- ~/Library/LaunchAgents/com.you.work-dashboard.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.you.work-dashboard</string>
  <key>ProgramArguments</key>  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>claude -p "/work-dashboard:dashboard"</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
  </array>
</dict>
</plist>
```

Load with `launchctl load ~/Library/LaunchAgents/com.you.work-dashboard.plist`.

### Any OS — cron

```cron
0 8,13,17 * * 1-5   claude -p "/work-dashboard:dashboard" >> ~/.claude/dashboard-cron.log 2>&1
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

**Want to run the skill from a different Claude Code project** — As long as the plugin is installed and `~/.claude/dashboard-config.local` exists, `/work-dashboard:dashboard` works from any project.

---

## License

MIT. See `.claude-plugin/plugin.json` for authorship.

---

## Contributing

Issues and PRs welcome. When adding a new data source, keep the agent's JSON schema backward-compatible — the skill's merge step is permissive but existing dashboards in the wild will break if field names change.
