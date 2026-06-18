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

In `~/.claude/dashboard-config.local`, under `dashboard`, add:
```json
"tasks": { "backend": "notion", "notionDataSourceId": "" }
```
Leave `backend` as `"local"` (or omit) for the default behavior (manual file +
agent-sourced tasks). Set `notionDataSourceId` to the **data source of whatever Notion
database you want to use** — paste its `collection://…` id (from the Notion connector's
`fetch` on the DB), or leave it empty and let the first run create one for you (Step 0).
Nothing about the DB is hardcoded: you choose it.

## What it does on each run

0. **Resolve the target database** from `dashboard.tasks.notionDataSourceId`:
   - If set → use that data source. **Ensure the required properties exist** and add any
     missing ones (idempotent): `Source` (select), `Sync key` (text, dedup anchor),
     `Blocked` (checkbox). The DB should also have `Task` (title), `Status` (status),
     `Priority` (select), `Due` (date) — adapt to the user's existing names if they differ.
   - If empty → **create** a "Tasks" database (ask the user which page to put it under, or
     use their tasks/home page), add the properties above, and **write the new
     `collection://…` id back into the config** so future runs reuse it. Tell the user.
   All subsequent steps operate on this resolved data source — never a hardcoded id.
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
