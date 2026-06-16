---
name: dashboard-task
description: Administer the user's personal Work Dashboard tasks in the local task file (~/.claude/dashboard-tasks.local) — add, complete, remove, or list tasks — then re-render the dashboard so the change shows immediately. Invoke when the user says things like "add a dashboard task ...", "add X to my dashboard / top 3", "mark <task> done", "remove <task> from the dashboard", or "what's on my dashboard task list".
---

# Work Dashboard — task admin

Manage the user's **manual** dashboard tasks. These live in
`~/.claude/dashboard-tasks.local` (separate from agent-sourced tasks) and the merge
step folds them into the dashboard's Top-3 / Overdue / Due-soon / Blocked modules.
No connectors are involved, so changes apply instantly via a quick re-merge.

## The file

```json
{ "tasks": [
  { "label": "Ship pricing doc", "bucket": "top3", "p": 1, "project": "pricing", "meta": "Manual · due today", "done": false }
] }
```

- `label` (required), `bucket` (`top3` | `overdue` | `dueSoon` | `blocked`, default `dueSoon`),
  `p` (1 hot / 2 warm / 3 cold, default 2), `project` (free text), `meta` (small note),
  `done` (bool).

If the file doesn't exist yet, create it from
`${CLAUDE_PLUGIN_ROOT}/templates/dashboard-tasks.local.example` (or as `{ "tasks": [] }`).

## What to do

1. **Read** `~/.claude/dashboard-tasks.local` (create it if missing).
2. Apply the user's request with the **Edit/Write** tool:
   - **add** — append a task object. Infer `bucket`/`p`/`project` from how they phrase it
     ("top 3" → `top3`; "overdue"/"blocked" map directly; a deadline this week → `dueSoon`).
     Default `meta` to `"Manual"`. Confirm the parsed task back to the user in one line.
   - **complete/done** — find the task by fuzzy label match, set `done: true` (or remove it
     if the user says "delete"). If multiple match, ask which.
   - **remove** — delete the matching task object.
   - **list** — show the current tasks grouped by bucket; make no changes.
3. **Re-render** so the dashboard updates immediately (no full refresh / no connectors):
   ```
   Bash(command: "python3 ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/build-overrides.py",
        description: "Re-merge dashboard data")
   ```
   Relay its confirmation line and tell the user to reload the tab (it auto-reloads if the
   localhost server is running).

## Rules
- **Never touch agent-sourced tasks** or other JSON in the data cache — only the manual
  task file. `build-overrides.py` re-merges everything else from the last refresh's cache.
- Keep edits minimal and valid JSON; if the file is malformed, show the user the error and
  the offending content rather than silently overwriting.
- Don't fetch from connectors here — this is local task admin only.
