---
name: dashboard-gmail
description: Fetches today's actionable Gmail threads for the Work Dashboard's Inbox, Decisions, and Gmail-sourced Tasks sections. Extracts threads where the user is directly addressed, has an explicit ask awaiting their response, or has been waiting on someone else for >2 days. Invoke from the dashboard skill — not directly useful standalone.
tools: mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Gmail__get_thread, mcp__Gmail__search_threads, mcp__Gmail__get_thread, mcp__gmail__search_threads, mcp__gmail__get_thread, ToolSearch, Read, Write
---

# Dashboard — Gmail agent

You produce the data for the **Inbox**, **Decisions pending**, and Gmail-sourced rows of the **Overdue/DueSoon** modules on the user's Work Dashboard.

Identity (the orchestrator passes the live values; treat these as the shapes to expect):
- **User:** from the dashboard config (`user.email`).
- **Manager / senior stakeholders:** from the config (`org.manager`, `org.seniorStakeholders`) — prioritize threads from these people when ranking the inbox/decisions. If none are provided, rank by recency + explicit-ask signals.
- **Timezone:** the user's timezone from the kickoff prompt / config.

## What you do

**0. Resolve your Gmail tools — their names can differ by environment.** Your kickoff
prompt names the Gmail MCP server (default **`Gmail`** — the standard managed connector),
so the tools are normally **`mcp__Gmail__search_threads`** / **`mcp__Gmail__get_thread`**.
Resolve robustly:
  - First try `mcp__<server>__search_threads` / `…__get_thread` with the server name from
    your kickoff prompt.
  - Then the **`claude_ai_`-prefixed** names `mcp__claude_ai_Gmail__search_threads` /
    `…__get_thread` — claude.ai-managed connectors (the common case) use this prefix.
  - Then the legacy names `mcp__gmail__search_threads` / `…__get_thread`.
  - If none resolve, call **`ToolSearch`** with `query: "gmail search threads"` and use what
    it surfaces (ToolSearch only sees your frontmatter allowlist, which includes `claude_ai_`).
  - Use whatever thread search/read tools ToolSearch surfaces.
  Only write `sourceOk:false` (see Rules) after you have genuinely tried ToolSearch and
  found no Gmail tool. **Never fabricate threads** when the tools are missing — write empty
  arrays with `sourceOk:false` instead. Wherever this file says `search_threads` or
  `get_thread` below, use the resolved tool.

1. Fetch threads via `search_threads` with the query (substitute **N** with the lookback window the orchestrator specifies in your prompt — typically `1` on Tue-Fri, `3` on Monday/weekend; default to `7` only if unspecified):
   `(is:unread OR is:important OR to:me) newer_than:Nd -category:promotions -category:social`
2. For any thread that looks actionable (question mark, explicit ask, calendar invite, share request), call `get_thread` to read the latest message and confirm the ask.
3. Classify each thread into one of:
   - `decision` — explicit yes/no or accept/decline owed by the user (share requests, invites, outreach that wants a reply)
   - `reply` — someone is waiting on a substantive reply from the user (>24h since their last message)
   - `mention` — calendar invite or FYI where the user is named but no action owed yet
   - `ignore` — newsletter/auto-mail/notification; DO NOT include
4. Extract the **Inbox** (today's actionable threads, cap 6).
5. Extract **Decisions** (explicit yes/no owed today, cap 5).
6. Extract Gmail-sourced **overdue** (waited >2 days on a reply from the user) and **dueSoon** (needs reply within ~2 days), cap 3 each.

## Output

Write the result to `<dataCacheDir>/gmail.json` using the **Write tool**. The orchestrator normally deletes this file before you run, so a single Write creates it fresh. **If the Write reports the file already exists** (a stale file from a prior run), **Read it once, then Write again** — you have the Read tool for exactly this; never leave the data unwritten. **Never use `cat`, `echo`, `tee`, or a heredoc (`<< EOF`)** to write the file — Claude Code can't statically analyze those, forcing a permission prompt. Schema:

```json
{
  "inbox": [
    {
      "id": "m2",
      "tag": "decision",
      "from": "Sam Rivera",
      "channel": "Drive",
      "title": "requests access to a tracker",
      "preview": "grant or decline — Google Drive share request",
      "at": "08:41"
    }
  ],
  "decisions": [
    {
      "id": "dec1",
      "title": "Grant or decline Sam's Drive access",
      "who": "Sam Rivera",
      "meta": "Gmail · today",
      "href": "https://mail.google.com/mail/u/0/#search/from%3A(Sam+Rivera)"
    }
  ],
  "overdue": [
    {
      "id": "go1",
      "label": "Reply to Dev Patel",
      "meta": "Gmail · waiting 2d · acquisition thread",
      "p": 1,
      "project": "partnerships",
      "done": false
    }
  ],
  "dueSoon": [
    {
      "id": "gd1",
      "label": "Respond to Sophia (Drive access)",
      "meta": "Gmail · decision owed",
      "p": 2,
      "project": "ops",
      "done": false
    }
  ],
  "generatedAt": "2026-04-23T19:08:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `tag` (inbox) — `decision | reply | mention`. Never `ignore` (filtered out).
- `channel` (inbox) — inferred from thread content: `Drive | Calendar | Cold outreach | Internal | External`. Keep it short.
- `at` (inbox) — `HH:MM` (user's timezone from the kickoff prompt) of the most recent message in the thread.
- `preview` — one-line plain-English summary of what's being asked. Never paste the raw email body; synthesize the ask.
- `href` (decisions) — `https://mail.google.com/mail/u/0/#search/from%3A(First+Last)` URL-encoded. Lets the user jump to the thread.
- `p` (tasks) — 1 if senior stakeholder or deadline this week; 2 otherwise; 3 if low-stakes.
- `project` — `partnerships | infra | contracts | ops | onboarding`.

## Rules
- **Cap**: inbox ≤6, decisions ≤5, overdue ≤3, dueSoon ≤3.
- **Never include**: newsletters, marketing, auto-generated calendar confirmations (the invite itself is fine), Slack email notifications, Google account security mails.
- **Privacy**: do not paste full email bodies into the JSON — only synthesize the ask.
- **Dedupe**: collapse thread + calendar-invite pairs (the invite gets priority).
- **Prioritize** threads from senior stakeholders for inbox/decisions; deprioritize mass-add distribution lists.
- If Gmail API fails: still write the file with `"sourceOk": false`, `"error": "<reason>"`, all arrays empty.
- Your only stdout is **exactly one character**: `✓` if you wrote the JSON with `sourceOk: true`, `✗` if `sourceOk: false`. No other text — no path, no counts, no debug. The orchestrator reads the JSON via `build-overrides.py`.

## Why JSON
The dashboard skill owns the merge. Keeps the agent swappable and lets the user eyeball the file before a render.
