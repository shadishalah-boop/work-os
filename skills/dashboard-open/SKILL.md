---
name: dashboard-open
description: Open the Work Dashboard in the browser at its localhost URL. Invoke when the user says "open the dashboard", "open my dashboard", "show me the dashboard", "launch the dashboard", or "pull up the dashboard".
---

# Work Dashboard — open

**ALWAYS open the dashboard over `http://localhost`, NEVER the raw `.html` file.** A
`file://` page renders **blank** because the browser blocks Babel from loading the
`.jsx` files. Opening the file path is the #1 "it's broken" mistake — don't do it.

Run exactly this (it resolves the server port, starts the server if it isn't running,
opens the localhost URL, and prints it):

```
Bash(command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/dashboard/open.sh",
     description: "Open the dashboard (localhost)")
```

Relay the `Opening the dashboard at: http://localhost:PORT/...` line.

## Rules
- **Never** run `open "<dashboardDir>/Work Dashboard.html"` or open the file path —
  that's the `file://` blank-page trap. Use `open.sh`, which uses the localhost URL.
- If the user asks to refresh, that's a different action (`/dashboard`); this skill
  only opens the existing dashboard.
