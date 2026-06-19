---
name: dashboard-gmail
model: haiku
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

**0b. On a connector error: one retry for transient blips, else fast-fail.** Once a tool is
*resolved*, your first `search_threads` call (step 1) is also the liveness check. Classify
any error:
  - **Tool not found** (resolution failure) → try the next name / ToolSearch per step 0.
  - **Transient network error** (`5xx`/`503`, connection reset, `429` rate-limit) → **retry
    the call once** after a brief pause (honor `Retry-After` on a 429); if it succeeds, continue.
  - **Deterministic error** — auth (`401`/`403`, token expired, not authorized), permission/
    consent denied, or a **timeout** (retrying just burns another full timeout window) — the
    connector is *down*. Do **NOT** retry, do **NOT** try other server-name variants, do **NOT**
    make further Gmail calls (no `get_thread` loop).
  After a failed retry OR a deterministic error: write `gmail.json` with `sourceOk:false`,
  `error:"<server> connector unavailable: <first line of the error>"`, all arrays empty,
  output `✗`, and stop. A dead connector should cost **one or two** calls, not a spiral.

1. **Incremental fetch (v0.14 — read this first).** Your kickoff prompt gives `SINCE_EPOCH`
   (a Unix timestamp) and `SINCE` (a date). Fetch ONLY threads with activity **after** that
   moment — everything before it was already captured by the previous refresh and can't have
   changed, so re-reading it just wastes tokens. Gmail's search accepts the epoch directly:
   `(is:unread OR is:important OR to:me) after:SINCE_EPOCH -category:promotions -category:social`
   (if your prompt only gives a date, use `after:YYYY/MM/DD` instead). Then **merge** with what
   you already had:
   - **Read** the existing `<dataCacheDir>/gmail.json` if it's there (it is, unless this is a
     fresh install — the orchestrator deliberately keeps it for you to merge into).
   - **If the search returns no new threads AND the existing file is valid** (`sourceOk:true`):
     do not re-classify anything. Just **Write the existing JSON back unchanged** (bump
     `generatedAt`) so the orchestrator sees a fresh file, then output `✓` and stop. This is
     the common cheap path on a same-day re-refresh.
   - **Otherwise:** classify the NEW threads (below), then merge them into the existing arrays —
     **dedupe by thread `id`** (a new version of a thread replaces the old entry), and **drop any
     item whose newest message is older than 14 days** so the lists stay bounded. Write the
     merged result.
   When there is no existing file (fresh install), the window is already 14 days — just build
   from the full result.
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

Write the result to `<dataCacheDir>/gmail.json` using the **Write tool**. Because the refresh
is now incremental (Step 1), the orchestrator **keeps** your prior `gmail.json` so you can merge
into it — so you will normally **Read it first, then Write** (overwrite-after-Read is allowed and
never prompts). On a fresh install there's no prior file and a single Write creates it. **Never
use `cat`, `echo`, `tee`, or a heredoc (`<< EOF`)** to write the file — Claude Code can't
statically analyze those, forcing a permission prompt. Schema:

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
