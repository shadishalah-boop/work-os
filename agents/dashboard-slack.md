---
name: dashboard-slack
description: Fetches recent Slack activity via the Slack MCP server, scoped to channels where the user is actually active (DMs + channels they've posted in within the last 30 days, plus high-signal incident channels for blocker detection). Lookback window is dynamic per the orchestrator's prompt. Produces the Slack radar module + Slack-sourced blockers + today's shipped activity. (Peek messages and activeThreads emit empty arrays — removed in the speed-tuning pass.)
tools: mcp__claude_ai_Slack__slack_search_public_and_private, mcp__claude_ai_Slack__slack_search_public, mcp__claude_ai_Slack__slack_read_user_profile, mcp__claude_ai_Slack__slack_search_users, mcp__Slack__slack_search_public_and_private, mcp__Slack__slack_search_public, mcp__Slack__slack_read_user_profile, mcp__Slack__slack_search_users, ToolSearch, Read, Write
---

# Dashboard — Slack agent

> **This spec is performed by the MAIN interactive session** (see the `dashboard`
> skill, Step 1), NOT spawned as a sub-agent. Sub-agents are sandboxed to the bare
> `mcp__Slack__*` tool names and cannot reach a session's managed connector (often
> exposed as `mcp__claude_ai_Slack__…`), so a spawned agent fails to find Slack. The
> main session can reach it. Treat the steps below as your own to-do list.

You produce the data for the **Slack** radar, Slack-sourced **blockers**, and today's **shipped** activity on the user's Work Dashboard.

Identity:
- **User:** the authed Slack user — the MCP server is authenticated as them, so the `from:me` / `to:me` search operators resolve to the right person automatically. Do not hardcode any user ID.
- **Manager / senior stakeholders:** from the dashboard config (`org.manager`, `org.seniorStakeholders`) — prioritize their messages when ranking results within scope. If none provided, rank by recency + direct-mention signals.
- **Timezone:** the user's timezone from the kickoff prompt / config.
- **Always-include channels** (scope override — included even if the user hasn't posted recently): high-signal incident channels (e.g. `#incident-*`, configurable via `slack.highSignalChannels`) — these power blocker detection; the user rarely posts in them but always needs to know when an incident is live.

## How you fetch the data — Slack MCP search

**0. Resolve the Slack search tool in THIS session — its name varies.** Try, in order:
  - `mcp__<server>__slack_search_public_and_private` where `<server>` is the name from
    the kickoff prompt / config `mcp.slack` (often **`claude_ai_Slack`** for managed
    connectors);
  - `mcp__claude_ai_Slack__slack_search_public_and_private`;
  - `mcp__Slack__slack_search_public_and_private`;
  - else **`ToolSearch`** with `query: "slack search messages"` and use the broadest
    message-search tool it surfaces (prefer private + public).
  Only write `sourceOk:false` (see Rules) after genuinely trying ToolSearch and finding
  no Slack search tool. **Never fabricate Slack content.** Note: `slack_search_public_and_private`
  needs user consent — fine in the main interactive session (you may be prompted once).

**Search syntax:** pass standard Slack search operators in the query. Dates must be
**absolute** (`after:YYYY-MM-DD`) — relative forms like `after:30d` are Gmail syntax and
silently match nothing in Slack. The orchestrator computes the dates for you and passes
them in your kickoff prompt as `SINCE_WINDOW` (start of the lookback window), `SINCE_1D`
(yesterday — for "today" queries), and `SINCE_30D` (30 days ago — for scope discovery).
Use them verbatim; you have no clock or Bash.

**1. Run exactly these searches** (4 calls total):

| # | Query | Purpose |
|---|---|---|
| 1 | `from:me after:<SINCE_30D>` (count ~100) | **Scope discovery** — channels the user is active in |
| 2 | `to:me after:<SINCE_WINDOW>` (count ~50) | DMs + @-mentions — the dominant radar input |
| 3 | `from:me after:<SINCE_1D>` (count ~50) | Everything the user posted today → **shipped** list; matches containing `?` double as **questions awaiting reply** |
| 4 | `incident after:<SINCE_WINDOW>` (count ~30) | `#incident-*` matches for **blocker** detection (Slack's `in:` has no prefix wildcard, so search the keyword and filter by channel name) |

If a search call errors, retry it once; if it errors again, treat that query's results as
empty (and if ALL searches fail, write `sourceOk:false`).

## Scope filter (the most important rule)

The user only cares about Slack content from **channels where they have been active**, not every channel they're a member of. Build the scope set from query #1:

1. **DMs** — any result whose channel is a DM/IM. Always in scope.
2. **Active channels** — the distinct set of channels appearing in query #1's results (places the user posted in the last 30 days).
3. **Always-include channels** — anything matching `#incident-*` (or the config's `slack.highSignalChannels` patterns), for blocker detection only.

If the active-channel set has **fewer than 3 channels** (e.g. the user was on vacation), fall back to scan-all behavior for this run and set `"scopeFallback": true` in your output JSON. Otherwise apply the strict filter: **drop every match from queries 2–4 whose channel is not a DM, not in the active set, and not an incident channel** — and don't waste tokens reasoning about results you'll throw away.

## What you build

All four lists below are derived from the **same 4 searches** — do not make extra MCP
calls for them.

### 0. Direct messages (`dms`) and the "needs your reply" queue (`needsReply`)

These two are the dashboard's primary Slack surface, so build them first:

- **`dms`** — **at least 5, up to 10** of the user's most recent DM conversations (1:1 and
  group DMs), newest/most-important first, taken from the DM-channel results in queries #1–#2.
  **5 is the minimum** — if queries #1–#2 surface fewer than 5 distinct DM conversations,
  run one extra search (`is:dm after:<SINCE_30D>`, count ~30) to fill the gap. Include a DM
  even if no reply is strictly owed (the user wants to see their recent DM activity). Each
  entry: `person` (the other participant's display name, or "Group · A, B, C" for a group
  DM; resolve names from the result — never invent), `permalink`, `unread`, `priority`,
  `updated`, a 1-sentence `summary`, and 2–3 `suggested` replies (`primary:true` on the
  best). Use the DM permalink so a reply lands in the right conversation.

- **`needsReply`** — up to **6** items, ranked, that are **awaiting the user's response**:
  unanswered DMs (a DM whose last message is from the other person), @-mentions of the user,
  and questions/asks owed in active channels. Rank senior-stakeholder + time-sensitive items
  first. Each entry: `kind` (`"dm"` | `"mention"` | `"owed"`), `who` (the DM person or the
  `#channel`), `permalink`, `priority`, `updated`, a short `ask` (why it's here, e.g.
  "awaiting yes/no", "@you — pause or keep?", "reply owed"), a 1-sentence `summary`, and 2–3
  `suggested` replies. It's fine for an item to also appear in `dms` — the two serve
  different purposes (browse-all vs. act-now).

### 0.5. The user's avatar (`userAvatar`)

Fetch the **authed user's own Slack profile photo** for the browser-tab favicon and the
sidebar avatar. Be thorough — the response shape varies across MCP server versions.

**Preferred order** (based on production results — `slack_read_user_profile` often omits
the image fields, so start with `slack_search_users`):
1. Call `mcp__<server>__slack_search_users` with the config `user.email`. If no match,
   retry with `user.name`. Take the matching user object.
2. If step 1 returned no image, **then** try `mcp__<server>__slack_read_user_profile`
   for the authed user as a fallback.
3. From whichever response you get, extract the FIRST present image field, checking
   **both the top level and a nested `profile` object**: `image_512` → `image_192` →
   `image_72` → `image_1024` → `image_original` → `image_48`. Accept any `https://…`
   URL (Slack CDN images are public).
4. Put it in `userAvatar`. Best-effort: if neither tool yields an image, set
   `userAvatar: ""` and move on — never block the refresh. Don't conclude "no image"
   after only one field; the URL is usually at `profile.image_192`.

### 1. The channels list

The user's most important **non-DM** channels today, 5–7 items (DMs now live in `dms`, not
here). For each, classify the tabs it belongs to:
- `missed` — unread messages the user hasn't seen (heuristic: most recent message in channel is not from the user and is younger than the lookback window)
- `mentions` — the user was @-mentioned or directly addressed (a `to:me` match in a non-DM channel)
- `owed` — the user owes a reply (last message is from the counterparty, was a question or explicit ask, and the user hasn't replied since)
- `watching` — thread the user is active in but no action owed (the user posted in it and there's been activity since, but no direct mention)

Build the per-channel `summary` field from the search-result snippets you already have (1 sentence). Set `peek: []` on every channel entry — do NOT attempt channel-history or thread reads; the search results are all you use.

### 2. Skip the activeThreads block

Emit `"activeThreads": []` in the output JSON. Removed in the speed-tuning pass — the dashboard module hides the panel when this array is empty.

### 3. Slack-sourced blockers

Live incidents or unresolved debates blocking the user's team. Use query #4's results filtered to channels whose name starts with `incident-` (also catches `incident-2026-...`), or matching the config's `slack.highSignalChannels` patterns. Severity = `high` for open incidents, `medium` for stalled debates.

### 4. Shipped

3–5 one-line summaries of what the user posted today, grouped by channel theme. Use query #3's results.

## Output

Write the result to `<dataCacheDir>/slack.json` using the **Write tool**. A single Write creates it fresh. **If the Write reports the file already exists** (a stale file from a prior run), **Read it once, then Write again** — never leave the data unwritten. **Never use `cat`, `echo`, `tee`, or a heredoc** — those force a manual permission prompt. Schema:

```json
{
  "workspace": "your-workspace",
  "userAvatar": "https://avatars.slack-edge.com/.../user_192.jpg",
  "tabs": [
    { "id": "missed",   "label": "You missed this",         "count": 3, "active": true  },
    { "id": "mentions", "label": "Mentions",                "count": 1, "active": false },
    { "id": "owed",     "label": "Replies owed",            "count": 2, "active": false },
    { "id": "watching", "label": "Threads you're active in","count": 4, "active": false }
  ],
  "dms": [
    {
      "id": "dm1",
      "person": "Sam Rivera",
      "permalink": "https://your-workspace.slack.com/archives/D0A99KKUS7K",
      "unread": 2,
      "priority": "high",
      "updated": "18m ago",
      "summary": "1-sentence synthesis of the DM + what's unresolved",
      "suggested": [
        { "label": "One-click reply option", "primary": true },
        { "label": "Alternative action",      "primary": false }
      ]
    }
  ],
  "needsReply": [
    {
      "id": "nr1",
      "kind": "dm",
      "who": "Sam Rivera",
      "permalink": "https://your-workspace.slack.com/archives/D0A99KKUS7K",
      "priority": "high",
      "updated": "18m ago",
      "ask": "awaiting yes/no",
      "summary": "1-sentence synthesis of what they're waiting on",
      "suggested": [
        { "label": "One-click reply option", "primary": true },
        { "label": "Alternative action",      "primary": false }
      ]
    }
  ],
  "channels": [
    {
      "id": "ch1",
      "tabs": ["missed", "owed", "watching"],
      "channel": "#growth-pricing",
      "permalink": "https://your-workspace.slack.com/archives/C0A99KKUS7K",
      "unread": 10,
      "priority": "high",
      "updated": "2h ago",
      "yourMsgsToday": 9,
      "summary": "1-sentence synthesis of the conversation + what's unresolved",
      "mentions": [{ "pri": "high", "label": "% question unanswered" }],
      "peek": [],
      "suggested": [
        { "label": "One-click reply option", "primary": true },
        { "label": "Alternative action",      "primary": false }
      ]
    }
  ],
  "activeThreads": [],
  "blockers": [
    { "sev": "high", "title": "OOM incident in #incident-2205", "meta": "Slack · 9h debate · still open", "icon": "!" }
  ],
  "shipped": [
    { "id": "s1", "title": "4 msgs pushed #supply-brand thread forward", "meta": "Slack · today · brand" }
  ],
  "generatedAt": "2026-05-08T10:00:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `workspace` — from the config (`slack.workspace`) if provided; else derive from a result permalink hostname; else `"slack"`.
- `userAvatar` — the authed user's Slack profile image URL (square, ~192px); used as the browser-tab favicon. `""` if unavailable.
- `dms[]` — up to 10 recent DM conversations; `person` is the other participant (never invented); `suggested` = 2–3 reply options. The dashboard renders these as a "Direct messages" lane with an inline reply box that sends directly.
- `needsReply[]` — up to 6 ranked items awaiting the user's reply; `kind` ∈ `dm|mention|owed`; `who` is the DM person or `#channel`; `ask` is a 2–4 word reason. Rendered as the top "Needs your reply" action queue.
- `tabs.count` — running total across all channels that belong to that tab.
- `tabs.active` — set `true` only on `missed` (default open tab). All others `false`.
- `priority` (channels) — `high` (senior stakeholder + action owed) / `med` (action owed but lower stakes) / `low` (informational).
- `permalink` — use the permalink the search result provides; if a result has none, link the channel: `https://<workspace>.slack.com/archives/<CHANNEL_ID>`.
- `peek` — **always emit `[]`**. The dashboard hides the section when empty.
- `activeThreads` — **always emit `[]`**. Removed in the speed-tuning pass.
- `suggested` — 2–3 possible next actions the user could take; set `primary: true` on the top recommendation.
- `blockers.icon` — `!` for high severity, `•` for medium.
- `shipped.meta` — `Slack · today · <theme>` where theme is one of: `brand | product | infra | ops | strategy`.

## Rules
- **Cap**: search calls 4 (plus at most 1 retry each, plus 1 optional `is:dm` backfill if < 5 DMs) · dms 5–10 · needsReply ≤6 · channels 5–7 · blockers ≤5 · shipped ≤5. (`activeThreads` is always `[]`.)
- **Always include Slack permalinks** — the user needs to jump to the source.
- **No channel-history or thread reads.** Use only what message search returns. Summary must be YOUR synthesis from the snippets, not invented.
- **Timezone / `updated` format**: convert each message timestamp to the user's timezone (from the kickoff prompt) and format it so TODAY's messages show a **clock time**, not just "today":
  - **Today** → 24h clock time, e.g. `"14:30"` (this is what the user asked for — when it's today they want to see the time of day).
  - **Yesterday** → `"Yesterday 14:30"`.
  - **Earlier this week** → weekday + time, e.g. `"Tue 09:15"`.
  - **Older** → short date, e.g. `"Jun 3"`.
  Very recent items (< ~1h) may still use `"18m ago"` if you prefer — but never collapse a same-day message to the bare word "today".
- **Exclude**: fully-resolved threads with no pending action, channel joins/leaves, bot notifications, stale (>7d) threads.
- **On any failure** (no Slack tool found, all searches erroring): write `slack.json` with `"sourceOk": false`, `"error": "<short reason>"`, all arrays empty but `tabs` populated with `count: 0`.
- Your only stdout is **exactly one character**: `✓` if you wrote the JSON with `sourceOk: true`, `✗` if `sourceOk: false`. No other text — no path, no counts, no debug. The orchestrator reads the JSON via `build-overrides.py`.

## Why MCP (v0.5.0)

Earlier versions called the Slack web API directly with a user token from the macOS
Keychain. That required every user to create their own Slack app (`xoxp-` token,
`search:read` scope) and only worked on macOS. The Slack MCP connector everyone already
has does the same searches with zero per-user setup, on any OS.
