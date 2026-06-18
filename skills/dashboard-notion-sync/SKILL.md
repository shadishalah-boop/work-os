---
name: dashboard-notion-sync
description: Optional Notion task backend for the Work Dashboard. Syncs the dashboard's tasks with a personal Notion "Tasks" database (the source of truth) — creates dashboard/Granola/Gmail-identified action items in Notion (deduped), pulls open Notion tasks into the dashboard, and pushes dashboard status toggles back to Notion. Invoke when the user says "sync my tasks with Notion", "refresh Notion tasks", or runs it on a schedule. Only relevant when dashboard.tasks.backend is set to "notion".
---

# Work Dashboard — Notion task sync (optional)

Makes a personal **Notion "Tasks" database the source of truth** for the dashboard's
Top-3 / Overdue / Due-soon / Blocked task buckets. Off by default — enable per the
setup below. Runs in an **interactive session** where the Notion + Granola/Gmail
connectors are reachable (a headless refresh cannot reach managed connectors).

## Setup (one-time)

1. In `~/.claude/dashboard-config.local`, under `dashboard`, add:
   ```json
   "tasks": { "backend": "notion", "notionDataSourceId": "collection://<your-tasks-db>" }
   ```
   Leave `backend` as `"local"` (or omit) to keep the default behavior (manual file +
   agent-sourced tasks).
2. Your Notion Tasks DB needs these properties (create or adapt): `Task` (title),
   `Status` (status: e.g. Not started / In progress / Done), `Priority` (select),
   `Due` (date), plus — added by this skill's first run if missing — `Source`
   (select), `Sync key` (text, dedup anchor), `Blocked` (checkbox).

## What it does on each run

1. **Drain** — read `~/.claude/dashboard-tasks.local`; for any task with
   `pending_sync: true`, update its Notion page `Status` (Done if `done`, else In
   progress) and clear the flag. (This lands dashboard toggles in Notion.)
2. **Identify** — pull action items the user owns from Granola (`list_meetings` +
   `get_meetings`) and Gmail (`search_threads`).
3. **Dedup + create** — compute a stable `Sync key` per item
   (`granola:<slug>` / `gmail:<slug>`); query the Tasks DB for that key; create only
   the missing pages (map Priority/Due/Area/Source; set `Blocked` if waiting on others).
4. **Rebuild** — query open Notion tasks (Status ≠ Done, plus Done within 24h) and
   overwrite `~/.claude/dashboard-tasks.local` as `{"tasks":[…]}`, each task with
   `label, bucket, p, project, meta, done, href` (Notion page URL), `notion_id`,
   `sync_key`, `notion_status`. Bucket rule: `Blocked` → `blocked`; Due < today & not
   done → `overdue`; Due in {today, tomorrow} & high priority → `top3` (max 3);
   else → `dueSoon`.
5. **Render** — run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/build-overrides.py`.

## How write-back works

The dashboard's done-toggle POSTs `{sync_key, notion_id, done}` to the local server's
`/task-status` endpoint (in `serve.py`), which flips `done` + sets `pending_sync` in
`dashboard-tasks.local`. This skill's next run (step 1) pushes that to Notion. So a
click in the dashboard reconciles to Notion on the next sync.

## Rules

- Idempotent: re-running never duplicates Notion tasks (dedup on `Sync key`).
- If Notion is unreachable, leave `dashboard-tasks.local` untouched (never blank it).
- Only touches the task file + the Notion Tasks DB — not the other agent JSON caches.
- Never run this headlessly expecting connectors — it needs an interactive session.
