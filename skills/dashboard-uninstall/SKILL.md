---
name: dashboard-uninstall
description: Cleanly remove the Work Dashboard from this machine — stops the background localhost server and any scheduled auto-refresh, and optionally deletes the dashboard files/config (with a backup). Invoke when the user says "uninstall the dashboard", "remove work-os", "get rid of the dashboard", or similar.
---

# Work Dashboard — uninstall

Removes the dashboard's local footprint. Be clear with the user about the two
levels and confirm before deleting anything.

## Step 1 — ask what to remove

> *"Two options:*
> *1. **Stop only** — turn off the background server and scheduled refresh, but
>    keep your config and dashboard files (so you can re-enable later).*
> *2. **Full removal** — also delete the dashboard folder, data cache, and config.
>    I'll back everything up to a tarball in your home folder first."*

## Step 2 — run the matching command

- **Stop only:**
  ```bash
  bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/uninstall.sh"
  ```
- **Full removal:**
  ```bash
  bash "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/uninstall.sh" --purge
  ```

Relay the script's output verbatim — it prints the backup location (for `--purge`)
and the final plugin-removal command.

## Step 3 — offer to remove the plugin code

The script prints the command but can't run it (it would remove the plugin
mid-run). Tell the user to run it themselves in a terminal:

```
claude plugin uninstall work-os@work-os
```

If the user also wants the marketplace gone:

```
claude plugin marketplace remove work-os
```

## Rules
- **Always confirm** before `--purge` — it deletes files. The backup tarball is a
  safety net, not a reason to skip confirmation.
- Never run `claude plugin uninstall` yourself from inside this skill.
