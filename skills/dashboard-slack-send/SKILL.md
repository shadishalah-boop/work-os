---
name: dashboard-slack-send
description: Send or draft a Slack message via the Slack MCP. Invoke when the user says things like "reply to <person> on Slack", "send a Slack message to <#channel/person>", "Slack <person> that …", "draft a Slack reply", or "/dashboard-slack-send". Runs in the interactive session, where the Slack connector works and the user can confirm before anything is sent.
---

# Work Dashboard — send a Slack message

Send (or draft) a Slack message on the user's behalf using the Slack MCP. This is the
**reliable** way to send from Work OS: it runs in the interactive Claude Code session,
where the `claude_ai_Slack` connector works and consent can be granted.

## Resolve the send tool

Try, in order: `mcp__claude_ai_Slack__slack_send_message` →
`mcp__Slack__slack_send_message` → else `ToolSearch` with `query: "slack send message"`.
For drafts, use the `…__slack_send_message_draft` variant. (The connector also has
`slack_schedule_message` if the user wants it sent later.)

## Flow — always confirm before sending (it's a write action)

1. **Figure out the target + text.** From the user's request, determine the channel or
   DM (and thread, if replying) and the message body. If the target is ambiguous
   (e.g. just a first name), use `slack_search_users` / `slack_search_channels` to
   resolve it, and ask if still unclear. Never guess a recipient.
2. **Show the user exactly what will go out** — recipient + full message text — and
   ask for a go-ahead, UNLESS they already said "just send it" / "send without asking."
   Default to **drafting** (`slack_send_message_draft`) if they said "draft"; otherwise
   confirm then `slack_send_message`.
3. **Send (or draft).** Report back: where it went and a permalink if returned. On
   failure, say why and offer to draft instead.

## Replying from the dashboard

If the user is acting on a dashboard item ("reply to that Pablo thread"), use the
item's Slack permalink to resolve the channel + thread, so the reply lands in the
right thread.

## Rules
- **Never send without showing the message and getting a go-ahead** (or an explicit
  "send it without asking"). Sending is irreversible.
- **Resolve real recipients** — never invent a channel/user ID. Confirm if unsure.
- Keep it to the requested message; don't editorialize or add content the user
  didn't ask for.
- This is send-only; refreshing the dashboard is a separate action (`/dashboard`).
