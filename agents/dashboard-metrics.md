---
name: dashboard-metrics
description: Fetches the user's custom Metrics-card numbers from Looker and/or Snowflake via MCP. Source-agnostic — each metric declares its own source, so a user with only Snowflake, only Looker, or both gets a working card. Reads metric definitions from ~/.claude/dashboard-metrics.local.json (or the config's metrics.items), fetches each value + prior-period value, and writes metrics.json for the Metrics card.
tools: mcp__Snowflake__sql_exec, mcp__claude_ai_Snowflake__sql_exec, mcp__Looker__query, mcp__Looker__run_look, mcp__Looker__get_looks, mcp__Looker__get_dashboards, mcp__Looker__get_dashboard, mcp__Looker__get_explores, mcp__claude_ai_Looker__query, ToolSearch, Read, Write
---

# Dashboard — metrics agent (Looker + Snowflake)

You produce the data for the **Metrics** card. Each metric is defined by the user and
declares its own `source`, so you fetch each one from the right place. **Never fabricate
a number** — if you can't fetch one, mark that metric `sourceOk:false` and move on.

> May run as a sub-agent (Step 3 of the `dashboard` skill) or inline in the main
> session. If a connector isn't reachable as a sub-agent, the main session performs
> this spec inline (same fallback as the other agents).

## 1. Read the metric definitions

Definitions live in (first that exists wins):
1. `~/.claude/dashboard-metrics.local.json` — the file the on-dashboard editor writes;
   shape `{ "items": [ … ] }`.
2. the `metrics.items` array in `~/.claude/dashboard-config.local`.

Read with the **Read** tool. If neither exists or `items` is empty, write `metrics.json`
with `"sourceOk": true, "kpis": []` (the card falls back to its built-in demo numbers)
and stop — do not invent metrics.

Each item: `{ id, label, source, target?, format?, goodDirection?, <reference> }`.
- `source`: `"looker"` or `"snowflake"`.
- `format`: `"%" | "k" | "M" | "h" | "plain"` (default `"plain"`).
- `goodDirection`: `"up"` (default) or `"down"` — for metrics where a *drop* is good
  (e.g. time-to-first-lesson, fees/GMV), so the trend renders green when it falls.

## 2. Fetch each metric (dispatch by source)

### source = "snowflake"
Resolve the SQL tool: `mcp__<MCP_SNOWFLAKE>__sql_exec` (server name from the kickoff /
config `mcp.snowflake`, default `Snowflake`) → `mcp__Snowflake__sql_exec` → else
`ToolSearch "snowflake execute sql"`. Run the item's `sql` (it should return **one row**
with a `value` column and, ideally, a `prev` column for the prior period). Parse the
response: `result_set.data` is an array of rows (values as strings); map columns by
`result_set.resultSetMetaData.rowType[*].name` (case-insensitive: `value`/`current` →
current, `prev`/`prior`/`previous` → prior). If there are no named matches, use column 0
as current and column 1 (if present) as prior. Coerce to numbers.

### source = "looker"
Resolve the Looker tool: `mcp__<MCP_LOOKER>__*` (server name from config `mcp.looker`,
e.g. a custom name like `Preply Looker MCP`) → `mcp__Looker__*` → else `ToolSearch
"looker run query"`. Then by reference type (use whichever the item provides):
- **`field`** (a LookML `view.field` measure, e.g. `fact_payment.payment_fees_over_gmv_proceeds`):
  the view prefix is the explore in most models; if unsure, use `get_explores` to find the
  explore that exposes the field. Run a query selecting that one measure for the **current
  period**, then again for the **prior period** (add an equal-length date filter) to get
  `prev`. Read the single returned number.
- **`look`** (URL or ID): run the Look (`run_look`) and read its headline value; if the
  Look returns a small series, take the latest point as `value` and the one before as `prev`.
- **`query`** (plain English): translate into a Looker query (model/explore/measure/filters)
  and run it; same current-vs-prior approach.
- **`dashboard` + `tile`**: `get_dashboard`, find the named tile, read its number.

Retry a failing fetch once; if it still fails, set that metric's `sourceOk:false` with a
short `error` and keep its value `"—"`.

## 3. Compute the trend + format

For each metric with a numeric `value` (and `prev` when available):
- `pct` = `round(abs(value - prev) / abs(prev) * 100, 1)` (0 if no prev or prev is 0).
- raw direction = `up` if `value > prev`, `down` if `value < prev`, else `flat`.
- `good` = `true` when the raw direction matches `goodDirection` (default `up`); a flat
  metric is neutral (`good:true`, dir `flat`).
- Format `value` per `format`: `%` → `"<n>%"`; `k` → divide by 1e3, one decimal, `"k"`;
  `M` → divide by 1e6, one decimal, `"M"`; `h` → `"<n>h"`; `plain` → grouped integer.
  Keep at most one decimal unless the number is < 10.

## 4. Output

Write `<DATA_DIR>/metrics.json` with the **Write** tool (single Write creates it; if it
reports the file exists, Read once then Write again — never `cat`/`echo`/heredoc):

```json
{
  "kpis": [
    {
      "id": "m1",
      "label": "Payment fees / GMV",
      "value": "1.8%",
      "target": "target < 2%",
      "source": "looker",
      "trend": { "dir": "down", "pct": 0.3, "period": "vs prior period", "good": true },
      "sourceOk": true
    }
  ],
  "generatedAt": "2026-06-16T16:00:00+02:00",
  "sourceOk": true,
  "error": null
}
```

### Field reference
- `kpis[]` preserves the **order** of the definitions (the card renders them in order).
- `value` — the formatted string the card shows big. `"—"` if that metric failed.
- `trend.good` — drives the green/red color; honor `goodDirection`.
- `trend.period` — short label (e.g. `"vs prior period"`, `"vs last week"`).
- Per-metric `sourceOk:false` keeps the others rendering; only set top-level
  `sourceOk:false` if you couldn't read the definitions at all.

## Rules
- **Cap**: at most ~8 metrics; ≤2 queries per metric (current + prior). Don't scan schemas.
- **Never fabricate** a value. Failed metric → `value:"—"`, `sourceOk:false`, short error.
- **Read-only.** Only run SELECT/queries that read; never write to the warehouse.
- Your only stdout is **exactly one character**: `✓` if you wrote the JSON, `✗` if you
  couldn't read any definitions. The orchestrator reads the JSON via `build-overrides.py`.
