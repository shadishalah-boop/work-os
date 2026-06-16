---
name: dashboard-setup
description: Interactive onboarding for the Work Dashboard plugin. Creates `~/.claude/dashboard-config.local`, auto-fills the user's identity from their connectors, copies the static bundle, verifies MCP connectors, and runs the first refresh. ALSO handles on-demand requests after install like "add my team to the dashboard", "add my OKRs to the dashboard", or "update my pins" (see the Appendix). Run once after installing; then use `/dashboard` to refresh.
---

# Work Dashboard — interactive setup

First-time setup wizard. Designed to be **near-zero-questions**: it auto-detects the
user's identity and timezone from their connected accounts (one confirmation), then
does everything else with sensible defaults — pins, output location, config — without
asking. Writes `~/.claude/dashboard-config.local`, copies the static HTML bundle,
verifies connectors, starts the permanent server, runs the first refresh, and opens
the dashboard. The ONLY thing the user actively answers is the identity confirmation
(and the existing-config Reset/Edit/Cancel choice, if a config already exists).

**Team roster and OKRs are intentionally NOT part of setup** — they start empty and
the dashboard prompts the user to add them later (the People and OKR cards show a
one-line CTA). When the user takes that CTA ("add my team / OKRs to the dashboard"),
handle it via the **Appendix** at the end of this file. This keeps first-run to the
bare minimum: confirm who you are, pick where files go, see real data.

**Design intent:** the user typing in this conversation is a NON-TECHNICAL human.
**Detect, don't interrogate** — pre-fill every field you can from their connectors
(Step 2) and have them confirm. Ask one clear question at a time when the answer
branches. Never dump a raw JSON template and say "fill it in."

## Step 0 — locate the plugin

Use `${CLAUDE_PLUGIN_ROOT}` — Claude Code sets it to this plugin's install root for
every Bash call made from this skill. Resolve it once and store as `$PLUGIN_DIR`:

```bash
echo "${CLAUDE_PLUGIN_ROOT}"
```

If it's somehow empty, fall back to `claude plugin list --json` and find the
`work-os` entry's install path. Do NOT guess paths or ask the user to find it.

## Step 1 — check for existing config

Read `~/.claude/dashboard-config.local`. If it exists and is valid JSON, ask:

> *"You already have a dashboard config at `~/.claude/dashboard-config.local`. Want to:*
> *1. **Reset** — overwrite with a new setup (the existing file gets backed up to `dashboard-config.local.bak-YYYYMMDD`)*
> *2. **Edit** — I'll open the file and show you what's there so you can tweak specific fields*
> *3. **Cancel** — keep what you have"*

Act on the user's response:
- **Reset**: back up to `~/.claude/dashboard-config.local.bak-$(date +%Y%m%d-%H%M%S)`, then proceed to Step 2.
- **Edit**: display the current JSON, ask which section they want to change, Edit-tool the file, confirm, then skip to Step 4.
- **Cancel**: print "No changes made" and exit the skill.

If no file exists, proceed to Step 2.

## Step 2 — auto-fill identity from the user's connectors, then confirm

The goal: the user **confirms** their details instead of typing them. Detect
everything you can from the MCP connectors they've already authenticated, then ask
only for what's missing. Do NOT lead with a blank form.

### 2a. Timezone — auto-detected, never asked

It's detected from the computer and re-detected on every refresh (so a traveling
user's times follow their laptop). Detect it now just to show the value:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/tzresolve.py"
```

With no config yet this prints the live system zone — hold it as `DETECTED_TZ`.
Store `user.timezone` as `"auto"` unless the user later asks to pin a fixed zone.

### 2b. Auto-detect name / email / role / company (read-only profile lookups)

Make these calls (all read-only, all on the user's own accounts). Resolve each
server name from the standard defaults — `Slack`, `Granola`, `Google_Calendar`,
`Gmail` — or, if a call 404s on the name, find the tool via `ToolSearch`
(e.g. `query: "slack read user profile"`). Skip any source that isn't connected;
this whole step is best-effort. Stop collecting a field once you have it.

Priority chain per field:

- **Full name + role/title + email + company, in one shot:**
  `slack_read_user_profile` with **no `user_id`** (defaults to the logged-in user).
  Its profile typically carries `real_name`/`display_name`, `title` (role),
  `email`, and the org/team name. This single call usually fills most fields.
- **Email** (if Slack didn't provide it): `get_account_info` (Granola) returns the
  signed-in email; or `list_calendars` (Google Calendar) — the calendar with
  `primary: true` has an `id` equal to the user's email address.
- **Full name** (if still missing): from Gmail, `search_threads` for `from:me`
  (newest) and read the display name on the From header; or a Calendar event the
  user organizes (`organizer.displayName`).
- **Company** (if not from Slack org): derive from the email domain — drop
  everything up to `@`, take the registrable label, title-case it
  (`shadi.shalah@preply.com` → `Preply`; `a@mail.acme.co` → `Acme`).
- **First name**: the first token of the full name.

### 2c. One confirmation message (pre-filled)

Show what you found and ask only for the gaps. Mark anything not detected clearly.
Example:

> *"I pulled these from your connected accounts — just reply **'looks good'** to
> accept, or send any corrections:*
> *• Name: **Shadi Shalah** (first name: Shadi)*
> *• Work email: **shadi.shalah@preply.com***
> *• Company: **Preply***
> *• Role/title: **Senior PM** ← found in Slack*
> *• Timezone: follows your computer automatically — detected **`DETECTED_TZ`** (reply with an IANA zone only to pin a fixed one)*
> *• Manager (optional): not detected — give me a name + role, or 'none'?*
> *"*

Fill any field the user corrects. Don't re-ask for fields they've confirmed.
`workingHours` defaults to `09:00–18:00 Mon–Fri` unless they mention otherwise.

**Never invent a person's title or role.** If the user gives a manager's *name* but
no role (e.g. just "Jose Ferreira"), store `org.manager.role` as `""` — do NOT guess
"CEO"/"VP"/etc. Same for teammates. Use only titles the user states explicitly or a
connector returns. And never tell the user they "provided" something they didn't.

### 2d. Fallback — manual entry

If the connectors returned **nothing** (e.g. none authenticated yet), fall back to
the plain batched question:

> *"I couldn't reach your connectors yet, so paste these (skip any with 'none'):
> first name · full name · role · work email · company · manager (name + role).
> Timezone is handled automatically (detected `DETECTED_TZ`)."*

## Step 3 — write config + create dirs + copy bundle

**Pins and output paths use defaults silently — do NOT ask about either.**

**Pins** — build `dashboard.pins` with these 5 defaults (no question). For Slack,
derive the workspace subdomain from the user's email domain or company
(`shadi.shalah@preply.com` → `preply` → `https://preply.slack.com`); if unknown, use
`https://slack.com`. Each pin needs `id`, `label`, `sub`, `letter`, `bg`, `href`:
  1. Google Calendar · `Week view` · `C` · `var(--teal-100)` · `https://calendar.google.com/calendar/u/0/r/week`
  2. Gmail · `Inbox` · `M` · `var(--pink-100)` · `https://mail.google.com/mail/u/0/#inbox`
  3. Slack · `Workspace` · `#` · `var(--red-100)` · `https://<subdomain>.slack.com`
  4. Google Drive · `Files` · `D` · `var(--blue-100)` · `https://drive.google.com`
  5. Granola · `Meeting notes` · `G` · `var(--yellow-100)` · `https://app.granola.ai`

**Output paths** — use the defaults, no question:
  - `output.dashboardDir` = `~/.claude/dashboard-os`
  - `output.dataCacheDir` = `~/.claude/dashboard-data`
  (Never use `~/Documents`/`~/Desktop`/`~/Downloads` — macOS TCC blocks the launchd
  server/refresh there; `~/.claude` is exempt.)

Once all fields are gathered, build the full config object. **Team and OKRs start
empty on purpose** (`org.team.people: []`, `org.team.attention: ""`,
`dashboard.okrs: []`) — the dashboard prompts for them later; see the Appendix.
Schema (copy exactly — fields in this order):

```json
{
  "_README": "Private config for <firstName>'s work-dashboard plugin. Never bundled. Never committed.",
  "user": {
    "name": "...", "fullName": "...", "role": "...", "email": "...",
    "timezone": "auto",
    "workingHours": { "start": "09:00", "end": "18:00", "days": ["Mon","Tue","Wed","Thu","Fri"] }
  },
  "org": {
    "company": "...",
    "manager": { "name": "...", "role": "..." },
    "seniorStakeholders": [],
    "team": { "attention": "", "people": [] }
  },
  "slack": { "workspace": "...", "userId": "", "highSignalChannels": [] },
  "mcp": {
    "calendar": "Google_Calendar",
    "gmail": "Gmail",
    "slack": "Slack",
    "drive": "Google_Drive",
    "granola": "Granola"
  },
  "dashboard": {
    "workstreams": [],
    "classificationKeywords": [],
    "okrs": [],
    "pins": [...],
    "weather": { "city": "..." },
    "focusTarget": 4
  },
  "output": { "dashboardDir": "~/.claude/dashboard-os", "dataCacheDir": "~/.claude/dashboard-data" }
}
```

Actions — do it in exactly TWO steps so the user sees no per-step approval prompts.
**Do NOT run ad-hoc multi-line bash / heredocs here** (those can't be statically
analyzed, so each one triggers a permission prompt — which is what we're avoiding):

1. **Write the config to a temp file** with the Write tool: `/tmp/work-os-setup.json`
   (a temp path, not `~/.claude/...`, so the Write tool doesn't flag it as a
   sensitive-file write). Pretty-printed, 2-space indent.
2. **Run the finalizer** — ONE analyzable, allowlistable call that writes the real
   config (backing up any existing one), creates the dirs, copies the bundle, stamps
   the version, and creates the filters file:
   ```
   Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/setup-finalize.sh /tmp/work-os-setup.json",
        description: "Finalize dashboard setup")
   ```
   Relay its `OK · …` line. (If asked to approve, the user can choose "don't ask
   again" — it's a fixed plugin script, so it'll be allowlisted for future runs.)

## Step 4 — verify the user's MCP connectors (live check, no static table)

The plugin bundles **no MCP servers** — the dashboard uses the connectors the user
already has (at most companies these are the standard managed connectors:
**Google Calendar, Gmail, Slack, Google Drive, Granola**).

Verify each of the 5 capabilities live:

1. For each source, check whether its tools are available in THIS session. Try the
   bare names first (`mcp__Google_Calendar__list_events`, `mcp__Gmail__search_threads`,
   `mcp__Slack__slack_search_public_and_private`, `mcp__Google_Drive__list_recent_files`,
   `mcp__Granola__list_meetings`), THEN the **`claude_ai_`-prefixed** variants that
   claude.ai-managed connectors commonly use (`mcp__claude_ai_Google_Calendar__list_events`,
   `mcp__claude_ai_Slack__slack_search_public_and_private`, etc.). If neither resolves,
   use **ToolSearch** with a capability query (e.g. `"calendar list events"`,
   `"slack search messages"`) to find what that user's server is actually called.
2. When a source resolves under a **non-default server name**, record the actual server
   name in the config's `mcp` section (e.g. `"calendar": "gcal"`) so every refresh tells
   the agents the right name. Leave defaults for sources that match.
3. Print a live status table, for example:

```
Your data sources:

  ✓ Calendar   (Google_Calendar)
  ✓ Gmail      (Gmail)
  ✗ Slack      — no Slack MCP found in this session
  ✓ Drive      (Google_Drive)
  ✓ Granola    (Granola)
```

4. For every ✗, tell the user exactly how to fix it: open `/mcp` to see configured
   servers, and connect the missing connector (at Preply: the standard company
   connectors for Slack / Gmail / Google Calendar / Google Drive / Granola — same ones
   used in claude.ai). Then they can re-run `/dashboard-setup` to re-verify, or just run
   `/dashboard` — a missing source only blanks its own modules.

Close with: "If a server fails at refresh time, its section shows 'source unavailable' —
the rest of the dashboard still renders. You can add sources incrementally."

## Step 5 — start the permanent server, refresh, open the dashboard

The dashboard must be viewed over `http://localhost`, never as a `file://` page —
opening the HTML directly makes the browser block Babel from loading the `.jsx`
files, so you get a **blank page**. So always start the permanent local server and
open the `localhost` URL. Do NOT just `open` the HTML file.

1. **Start the permanent server** (runs at login, survives reboots — no need to ask):
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/schedule.sh" serve
   ```
   Capture the `http://localhost:PORT/Work%20Dashboard.html` URL it prints.

1b. **Offer to pre-approve refreshes (recommended).** Ask: *"Want me to pre-approve
   the dashboard's connector tools so future refreshes never prompt? It writes
   read-only allow-rules to ~/.claude/settings.json — only the calendar/gmail/drive/
   granola/slack search+list tools and this plugin's scripts."* If yes:
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/allowlist.sh"
   ```
   Note for the user: this takes effect in their **next** Claude Code session, so the
   first refresh below may still prompt — they can pick "don't ask again" there too.

2. **Run the first refresh** — do it exactly as the `dashboard` skill's "How to
   refresh" section describes: it runs **entirely in this interactive session**
   (prep → in-session agents + inline Slack → merge), because claude.ai connectors
   aren't visible to a headless subprocess. The first run will ask to approve each
   connector tool — tell the user to choose **"don't ask again"** so future refreshes
   are prompt-free. Relay the final confirmation line.

3. **Open the dashboard** — use the helper (it opens the localhost URL, never the
   file path, and starts the server if needed):
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/open.sh"
   ```
   Never run `open "<dashboardDir>/Work Dashboard.html"` — a `file://` page is blank.

4. Print:

```
Setup complete. ✅

Dashboard (keep this tab pinned):
  http://localhost:PORT/Work%20Dashboard.html

Your config: ~/.claude/dashboard-config.local
Add your team or OKRs anytime: just tell me "add my team / OKRs to the dashboard".
To remove everything later: /dashboard-uninstall

— welcome to your Work Dashboard, <firstName>.
```

5. **Ask the refresh cadence, then set it up.** Ask which times they want (default
   weekdays **09:00 / 14:00 / 17:00**). All automated refresh needs a Claude Code
   session (that's where the claude.ai connectors live), so these all run *while
   Claude Code is open*. Explain the options and help with whichever they pick:
   - **Exact times (e.g. 9/14/17) — a Claude Code scheduled task** running
     `/work-os:dashboard`. Fires at those times while Claude Code is open. Caveat:
     session-scoped scheduled tasks may auto-expire (~7 days) and need re-arming.
   - **Never-expires, while open — a `/loop`**: `/loop 3h /work-os:dashboard` refreshes
     every few hours for as long as the session stays open, with no expiry and no
     re-arming. Best if they keep Claude Code open through the day and don't care about
     exact clock times. (The per-agent TTL cache makes frequent loops cheap.)
   - **Fallback — OS reminders** (a notification nudging them to run /dashboard; works
     even when Claude Code is closed, but it's a nudge, not an auto-fetch):
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/schedule.sh" remind --times "09:00 14:00 17:00"
     ```
   Run `allowlist.sh` (Step 1b) first so any automated refresh never stops on a prompt.
   Do NOT claim auto-refresh is impossible — it works in-session. The raw
   `schedule.sh install` (launchd/cron `claude -p`) may not carry claude.ai connectors;
   prefer the scheduled task or `/loop`.

## Rules

- **One question at a time when there's a branch.** Batch only obvious related fields.
- **Never paste a raw JSON block at the user and ask them to edit it.** That defeats the point of this skill.
- **Always back up** an existing config before overwriting. Never silent-destroy user data.
- **Never fabricate facts about people** (titles, roles, seniority) or attribute invented values to the user. If you don't know a manager's/teammate's role, leave it blank — don't guess.
- **Timezone is auto by default** — store `"auto"`, which makes every refresh detect the system zone live (handles travel). Only if the user explicitly wants to PIN a fixed zone, store an IANA name; if they give a vague "CET"/"Pacific time", offer the canonical form (e.g. "Europe/Madrid", "America/Los_Angeles") and confirm before storing it.
- **Don't orchestrate the agents from this skill.** The only refresh this skill may trigger is the one in Step 5 — the `dashboard` skill's in-session flow — with the user's consent.
- **If the user aborts mid-setup**, discard any partial state — don't write a half-filled config.
- **Currency / language**: the dashboard is English-only today; don't offer localization options.

## Appendix — add team / OKRs / pins AFTER install (on demand)

Team and OKRs are deliberately left out of first-run setup. The dashboard's People
and OKR cards each show a one-line prompt; when the user acts on it — e.g. *"add my
team to the dashboard"*, *"add my OKRs to the dashboard"*, *"update my pins"* — do
this (it can be a tiny, focused interaction, not the whole wizard):

1. Read `~/.claude/dashboard-config.local` (back it up first if you're replacing a
   whole section).
2. Fill the relevant section:

   **Team** → `org.team.people` = array of
   `{ "name", "note", "manager": false, "ooo": false, "status": "active" }`, and
   optionally `org.team.attention` (one sentence, HTML allowed, shown atop the card).
   Ask the user to name their teammates, or offer to read them from a Slack channel
   / Google contacts if they point you at a source.

   **OKRs** → `dashboard.okrs` = array; structure each as:
   - `id` — `k1`, `k2`, … in order
   - `name` — short name incl. the target (≤60 chars)
   - `pct` — current % (0 if new) · `trend` — `on-pace | behind | ahead`
   - `short` — a 2-4 char pill label you derive (confirm with the user)
   - `keywords` — 4-8 lowercase domain substrings for auto-tagging matching
     tasks/decisions; show your guesses and let the user adjust.
   Let the user describe OKRs in plain words or paste them from wherever they live.

   **Pins** → `dashboard.pins` (same shape as Step 3).

3. Write the file back, then run the refresh once so the card populates — the single
   `${CLAUDE_PLUGIN_ROOT}/skills/dashboard/refresh-headless.sh` call (the merge step
   reads the config and rewrites the overlay). Tell the user to reload the tab.

Keep it conversational and scoped — only touch the section the user asked about.

## Why a separate skill

Keeps the refresh skill (`dashboard`) simple and repeatable — it just merges JSON. All the once-per-user UX lives here.
