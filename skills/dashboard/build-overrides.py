#!/usr/bin/env python3
"""
Build data-override.jsx and drive-index.jsx from the agent JSON outputs.
Called by wait-and-merge.sh after the sub-agents finish.

Replaces what used to be minutes of the orchestrator hand-writing JSX with a
single ~50ms run. All per-user identity (name, role, team, OKRs, pins, weather)
is read from ~/.claude/dashboard-config.local — NOTHING personal is hardcoded
here. If the config is missing, generic placeholders are used so the dashboard
still renders.

Paths (data cache dir, dashboard output dir) also come from the config, falling
back to ~/.claude/dashboard-data and ~/.claude/dashboard-os.
"""

import json
import os
import re
import sys
from pathlib import Path

# Cross-source dedup — collapses items that different agents surfaced from the
# same underlying business event (e.g. one "Wise contract unsigned" from Slack
# and one "Wise agreement unsigned" from Granola → keep one). Conservative on
# purpose; see skills/dashboard/dedupe.py for the rules.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dedupe import dedupe, dedupe_tagged  # noqa: E402

# Shared timezone resolver (lives next to this script). Falls back to a tiny
# inline version if the import ever fails, so a refresh never crashes over tz.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from tzresolve import resolve_timezone
except Exception:  # pragma: no cover
    def resolve_timezone(cfg, fallback="UTC"):
        v = (cfg or {}).get("user", {}).get("timezone") if isinstance(cfg, dict) else None
        return v.strip() if isinstance(v, str) and v.strip() and v.strip().lower() != "auto" else fallback

HOME = Path.home()
CONFIG_PATH = HOME / ".claude" / "dashboard-config.local"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config():
    """Returns (config_dict, error). A missing file is fine (defaults); a file
    that exists but doesn't parse is a user-visible problem — report it."""
    try:
        return json.loads(CONFIG_PATH.read_text()), None
    except FileNotFoundError:
        return {}, None
    except Exception as e:
        return {}, str(e)


CFG, CFG_ERROR = load_config()


def cfg_get(dotted, default=None):
    v = CFG
    for k in dotted.split("."):
        if isinstance(v, dict):
            v = v.get(k)
        else:
            return default
    return v if v is not None else default


def cfg_path(dotted, default):
    v = cfg_get(dotted)
    if isinstance(v, str) and v:
        return Path(os.path.expanduser(v))
    return Path(os.path.expanduser(default))


DATA_DIR = cfg_path("output.dataCacheDir", "~/.claude/dashboard-data")
OUT_DIR = cfg_path("output.dashboardDir", "~/.claude/dashboard-os")
DATA_OVERRIDE = OUT_DIR / "data-override.jsx"
DRIVE_INDEX = OUT_DIR / "drive-index.jsx"
HTML_FILE = OUT_DIR / "Work Dashboard.html"


# ---------------------------------------------------------------------------
# Static blocks — built from config with generic fallbacks (no hardcoded PII).
# ---------------------------------------------------------------------------
_name = cfg_get("user.name", "there")
_role = cfg_get("user.role", "")
_tz = resolve_timezone(CFG)   # explicit pin > live system zone > UTC

STATIC_USER = {"name": _name, "role": _role, "tz": _tz}

STATIC_GREETING = {
    "morning":   f"Morning, <em>{_name}</em>.",
    "afternoon": f"Afternoon, <em>{_name}</em>.",
    "evening":   f"Evening, <em>{_name}</em>.",
}

# Team: prefer org.team; else empty roster with a friendly attention note.
STATIC_TEAM = cfg_get("org.team") or {
    "attention": "Add your team in <code>~/.claude/dashboard-config.local</code> → <code>org.team</code>, or drop a Personio org chart on the People card.",
    "people": [],
}


def load_imported_team():
    """People imported by dropping a Personio/org-chart photo on the People card
    (written by serve.py → ~/.claude/dashboard-team.local.json). Merged on top of
    the config roster so the drop persists across refreshes."""
    p = os.path.expanduser("~/.claude/dashboard-team.local.json")
    try:
        if os.path.exists(p):
            with open(p) as f:
                data = json.load(f)
            people = data.get("people") if isinstance(data, dict) else None
            return people if isinstance(people, list) else []
    except Exception:
        pass
    return []


# Don't add the dashboard's owner to their own team — their face usually appears
# on the Personio org chart. Match against full name + first name (>= 3 chars).
def _is_self(name, user):
    s = (name or "").strip().lower()
    if not s:
        return False
    u_full = (user.get("name") or "").strip().lower()
    u_first = u_full.split()[0] if u_full else ""
    if u_full and s == u_full:
        return True
    if u_first and len(u_first) >= 3 and s.split()[0:1] == [u_first]:
        return True
    return False


_imported_team = [p for p in load_imported_team() if not _is_self(p.get("name"), STATIC_USER)]
if _imported_team:
    # Merge by name (config entries win on conflict so hand-curated notes stay).
    _existing = STATIC_TEAM.get("people") if isinstance(STATIC_TEAM, dict) else None
    _existing = _existing if isinstance(_existing, list) else []
    _by_name = {(p.get("name") or "").strip().lower(): p for p in _existing}
    for p in _imported_team:
        key = (p.get("name") or "").strip().lower()
        if key and key not in _by_name:
            _existing.append(p)
            _by_name[key] = p
    STATIC_TEAM = {"people": _existing}
    if isinstance(cfg_get("org.team"), dict) and cfg_get("org.team", {}).get("attention"):
        STATIC_TEAM["attention"] = cfg_get("org.team")["attention"]

STATIC_OKRS = cfg_get("dashboard.okrs") or []
STATIC_PINS = cfg_get("dashboard.pins") or []
# knownPeople: explicit config first; else derive from the (possibly imported) team
# so Commitments + name-detection work automatically from the roster.
STATIC_KNOWN_PEOPLE = cfg_get("dashboard.knownPeople") or []
if not STATIC_KNOWN_PEOPLE and isinstance(STATIC_TEAM, dict):
    for _p in (STATIC_TEAM.get("people") or []):
        _nm = (_p.get("name") or "").strip()
        if not _nm:
            continue
        _first = _nm.split()[0]
        STATIC_KNOWN_PEOPLE.append({"match": _nm, "name": _nm, "note": _p.get("note") or _p.get("role") or "", "manager": _p.get("manager", False)})
        if len(_first) >= 3 and _first != _nm:
            STATIC_KNOWN_PEOPLE.append({"match": _first, "name": _nm, "note": _p.get("note") or _p.get("role") or "", "manager": _p.get("manager", False)})
STATIC_PINNED_PEOPLE = cfg_get("dashboard.pinnedPeople") or []

_city = cfg_get("dashboard.weather.city", "")
STATIC_WEATHER = {
    "city": _city,
    "days": cfg_get("dashboard.weather.days") or [
        {"label": "Today", "high": 20, "low": 14, "cond": "—"},
        {"label": "Tomorrow", "high": 20, "low": 14, "cond": "—"},
    ],
}

_slack_workspace = cfg_get("slack.workspace", "")

# IIFE that picks the next upcoming meeting at LOAD time.
PICK_NEXT_IIFE = """(function pickNext() {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
    const upcoming = window.SEED.calendar.find(e => toMin(e.time) > nowMin);
    if (upcoming) {
      const startMin = toMin(upcoming.time);
      window.SEED.nextMeeting = {
        title: upcoming.title,
        startsIn: startMin - nowMin,
        with: (upcoming.who && upcoming.who.length) ? upcoming.who.slice(0,3).join(', ') : 'you',
        room: upcoming.time,
      };
    } else {
      window.SEED.nextMeeting = { title: 'Nothing else today', startsIn: 0, with: 'you', room: '—' };
    }
  })();"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load(name):
    p = DATA_DIR / f"{name}.json"
    if not p.exists():
        return {"sourceOk": False, "error": f"{p} missing"}
    try:
        return json.loads(p.read_text())
    except Exception as e:
        return {"sourceOk": False, "error": f"{p} parse error: {e}"}


def safe(d, key, default=None):
    if not d.get("sourceOk", True):
        return [] if default is None else default
    return d.get(key) or ([] if default is None else default)


def first_name(name_or_obj):
    if isinstance(name_or_obj, dict):
        n = name_or_obj.get("name", "") or ""
        return n.split()[0] if n else ""
    if isinstance(name_or_obj, str):
        return name_or_obj.split()[0] if name_or_obj else ""
    return ""


def js_dump(obj):
    """JSON-encode for embedding in JS (valid JS object literal). 2-space indent."""
    return json.dumps(obj, indent=2, ensure_ascii=False)


def bump_v(html, fname):
    pattern = rf'({re.escape(fname)}\?v=)(\d+)'
    return re.sub(pattern, lambda m: f"{m.group(1)}{int(m.group(2))+1}", html, count=1)


# ---------------------------------------------------------------------------
# Read all 6 agent JSONs
# ---------------------------------------------------------------------------
calendar = load("calendar")
granola = load("granola")
gmail = load("gmail")
slack = load("slack")
drive = load("drive")
wellness = load("wellness")
metrics = load("metrics")

# Favicon / identity: the user's Slack profile photo (fetched by the slack agent),
# falling back to a config override. The HTML swaps the tab icon to this if set.
_slack_avatar = slack.get("userAvatar") if slack.get("sourceOk", True) else None
STATIC_USER["avatar"] = _slack_avatar or cfg_get("user.avatar", "")


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------
cal_events = []
for i, e in enumerate(safe(calendar, "events")):
    attendees = e.get("attendees") or []
    overflow = e.get("overflow", 0) or 0
    who = [first_name(a) for a in attendees[:6]]
    if overflow > 0:
        who.append(f"+{overflow}")
    cal_events.append({
        "id": f"c{i+1}", "time": e.get("time"), "duration": e.get("duration"),
        "title": e.get("title"), "type": e.get("type", "event"), "who": who,
    })

# --- Manual tasks (user-administered, from ~/.claude/dashboard-tasks.local) -----
# A local task file the user edits directly or via the `dashboard-task` skill.
# Merged into the live task buckets on every refresh/re-merge — no connector needed.
def load_manual_tasks():
    out = {"top3": [], "overdue": [], "dueSoon": [], "blocked": []}
    try:
        data = json.loads((HOME / ".claude" / "dashboard-tasks.local").read_text())
    except Exception:
        return out
    items = data.get("tasks") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return out
    for i, t in enumerate(items):
        if not isinstance(t, dict) or not t.get("label"):
            continue
        bucket = t.get("bucket", "dueSoon")
        if bucket not in out:
            bucket = "dueSoon"
        out[bucket].append({
            "id": f"mt{i+1}",
            "label": t.get("label"),
            "meta": t.get("meta", "Manual"),
            "p": t.get("p", 2),
            "project": t.get("project", ""),
            "done": bool(t.get("done", False)),
            "manual": True,
            # Carried through for the optional Notion task backend (no-op when absent):
            # href links the row to its Notion page; sync_key/notion_id drive write-back.
            "href": t.get("href"),
            "notion_id": t.get("notion_id"),
            "sync_key": t.get("sync_key"),
        })
    return out


def load_demoted_top3():
    """Labels the user pulled OUT of Top-3 (the dashboard's reverse button writes a
    `demotedTop3` list into dashboard-tasks.local). Returned as a set of normalized
    labels; build-overrides moves any matching Top-3 item back into Due soon."""
    try:
        data = json.loads((HOME / ".claude" / "dashboard-tasks.local").read_text())
    except Exception:
        return set()
    arr = data.get("demotedTop3") if isinstance(data, dict) else None
    if not isinstance(arr, list):
        return set()
    return {re.sub(r"\s+", " ", str(x).strip().lower()) for x in arr if str(x).strip()}


MANUAL = load_manual_tasks()
DEMOTED_TOP3 = load_demoted_top3()

# Opt-in Notion task backend. When dashboard.tasks.backend == "notion", tasks come
# ONLY from the Notion-synced file (dashboard-tasks.local), which the
# `dashboard-notion-sync` skill keeps in sync with a Notion "Tasks" DB (source of
# truth). Agent task buckets are then NOT merged here, to avoid duplicating what
# already flows through Notion. Default ("local") preserves the original behavior:
# manual file + agent tasks, cross-source deduped.
NOTION_BACKEND = (CFG.get("dashboard", {}).get("tasks", {}) or {}).get("backend") == "notion"

NOTICE = None
if NOTION_BACKEND:
    top3 = MANUAL["top3"][:3]
    overdue_raw = MANUAL["overdue"]
    duesoon_raw = MANUAL["dueSoon"]
    blocked = MANUAL["blocked"][:5]
    # Warn when the backend is on but the synced file is empty — almost always
    # means the dashboard-notion-sync skill hasn't run yet (or failed). Without
    # this, the user sees empty task lists with no explanation.
    if not (top3 or overdue_raw or duesoon_raw or blocked):
        NOTICE = "Notion task backend is enabled but no tasks were loaded — run /dashboard-notion-sync in Claude Code."
else:
    # All lists below run through cross-source dedup BEFORE truncation/id-assignment
    # so the limit (e.g. blockers[:5]) reflects unique items, not five copies of two.
    top3 = dedupe_tagged(
        (MANUAL["top3"], "manual"), (safe(granola, "top3"), "granola")
    )[:3]
    overdue_raw = dedupe_tagged(
        (MANUAL["overdue"], "manual"),
        (safe(granola, "overdue"), "granola"),
        (safe(gmail, "overdue"), "gmail"),
    )
    duesoon_raw = dedupe_tagged(
        (MANUAL["dueSoon"], "manual"),
        (safe(granola, "dueSoon"), "granola"),
        (safe(gmail, "dueSoon"), "gmail"),
    )
    blocked = dedupe_tagged(
        (MANUAL["blocked"], "manual"), (safe(granola, "blocked"), "granola")
    )[:5]

def _bucket_key(t):
    return re.sub(r"\s+", " ", (t.get("label") or "").strip().lower())

# User-demoted items: pull anything the user moved OUT of Top-3 back into Due soon, so
# the reversal sticks across refreshes even for the agent's own Top-3 picks.
if DEMOTED_TOP3:
    _keep, _moved = [], []
    for t in top3:
        (_moved if _bucket_key(t) in DEMOTED_TOP3 else _keep).append(t)
    top3 = _keep
    duesoon_raw = [{**t, "p": t.get("p", 2), "meta": t.get("meta", "Moved from today")}
                   for t in _moved] + duesoon_raw

# Cross-bucket: a task promoted into Top-3 (e.g. dragged there on the dashboard, which
# writes bucket:"top3" into dashboard-tasks.local) must not also linger in another
# bucket. The live UI hides the duplicate via its localStorage pin, but a machine
# without that pin relies on this. Exact normalized-label match; Top-3 wins.
_top3_keys = {k for k in (_bucket_key(t) for t in top3) if k}
if _top3_keys:
    overdue_raw = [t for t in overdue_raw if _bucket_key(t) not in _top3_keys]
    duesoon_raw = [t for t in duesoon_raw if _bucket_key(t) not in _top3_keys]
    blocked     = [t for t in blocked if _bucket_key(t) not in _top3_keys]

overdue = []
for i, item in enumerate(overdue_raw[:5]):
    o = dict(item); o["id"] = f"o{i+1}"; overdue.append(o)

duesoon = []
for i, item in enumerate(duesoon_raw[:10]):
    d = dict(item); d["id"] = f"d{i+1}"; duesoon.append(d)
shipped = dedupe(safe(slack, "shipped"), ["slack"] * len(safe(slack, "shipped")))[:5]

blockers_raw = dedupe_tagged(
    (safe(granola, "blockers"), "granola"), (safe(slack, "blockers"), "slack")
)
sev_rank = {"high": 0, "medium": 1, "low": 2}
blockers = sorted(blockers_raw, key=lambda b: sev_rank.get(b.get("sev", "low"), 99))[:5]

projects = safe(granola, "projects")[:8]

decisions_raw = dedupe_tagged(
    (list(safe(gmail, "decisions")), "gmail"),
    (list(safe(granola, "decisions")), "granola"),
)
decisions = []
for i, item in enumerate(decisions_raw[:5]):
    d = dict(item); d["id"] = f"dec{i+1}"; decisions.append(d)

meeting_history = sorted(
    safe(granola, "meetingHistory"), key=lambda m: m.get("date", ""), reverse=True
)[:30]

inbox = dedupe(safe(gmail, "inbox"), ["gmail"] * len(safe(gmail, "inbox")))[:6]

slack_seed = {
    "workspace":     slack.get("workspace", _slack_workspace) if slack.get("sourceOk", True) else _slack_workspace,
    "tabs":          safe(slack, "tabs"),
    "dms":           safe(slack, "dms")[:8],
    "needsReply":    safe(slack, "needsReply")[:6],
    "channels":      safe(slack, "channels"),
    "activeThreads": safe(slack, "activeThreads"),
}

# Custom metrics → Metrics card.
# Render from the user's DEFINITIONS (the editor file or config metrics.items) so a metric
# the user added ALWAYS shows up — values come from the agent's metrics.json when it has
# fetched them, else "—" (pending next refresh / unresolved). Only when there are NO
# definitions do we keep the bundled demo numbers from data.jsx.
def load_metric_defs():
    p = os.path.expanduser("~/.claude/dashboard-metrics.local.json")
    try:
        if os.path.exists(p):
            d = json.loads(open(p).read())
            if isinstance(d, dict) and isinstance(d.get("items"), list) and d["items"]:
                return d["items"]
    except Exception:
        pass
    m = (CFG.get("metrics") or {}) if isinstance(CFG, dict) else {}
    items = m.get("items")
    return items if isinstance(items, list) else []

_metric_defs = load_metric_defs()
_fetched = {k.get("id"): k for k in safe(metrics, "kpis") if isinstance(k, dict)}
if _metric_defs:
    kpis_seed = []
    for d in _metric_defs:
        f = _fetched.get(d.get("id")) or {}
        row = {
            "id": d.get("id"),
            "label": d.get("label", ""),
            "value": f.get("value") or "—",
            "target": d.get("target", ""),
            "format": d.get("format", "plain"),
            "source": d.get("source"),
            "timeframe": d.get("timeframe") or "12w",
            "trend": f.get("trend") or {"dir": "flat", "pct": 0, "period": ""},
        }
        if isinstance(f.get("series"), list) and f["series"]:
            row["series"] = f["series"]
        if isinstance(f.get("seriesLabels"), list) and f["seriesLabels"]:
            row["seriesLabels"] = f["seriesLabels"]
        # carry the reference so the editor can re-derive rows after a refresh
        for k_ in ("nl", "sql", "field", "look", "query"):
            if d.get(k_):
                row[k_] = d[k_]
        if f.get("resolvedSql"):
            row["resolvedSql"] = f["resolvedSql"]
        kpis_seed.append(row)
else:
    kpis_seed = safe(metrics, "kpis")  # no custom metrics defined → keep demo kpis

ps_drop = {"generatedAt", "sourceOk", "error"}
ps = {k: v for k, v in wellness.items() if k not in ps_drop} if wellness.get("sourceOk", False) else {}

drive_files = safe(drive, "files")


# ---------------------------------------------------------------------------
# Source-OK summary
# ---------------------------------------------------------------------------
sources = [
    ("calendar", calendar.get("sourceOk", False)),
    ("granola",  granola.get("sourceOk", False)),
    ("gmail",    gmail.get("sourceOk", False)),
    ("slack",    slack.get("sourceOk", False)),
    ("drive",    drive.get("sourceOk", False)),
    ("wellness", wellness.get("sourceOk", False)),
]
src_summary = " ".join(f"{n}{'OK' if ok else 'X'}" for n, ok in sources)
ok_count = sum(1 for _, ok in sources if ok)
failed = [n for n, ok in sources if not ok]


# ---------------------------------------------------------------------------
# Build data-override.jsx
# ---------------------------------------------------------------------------
jsx = f"""/* global React, window */
// =============================================================================
// LIVE OVERRIDE - auto-regenerated by the `dashboard` skill via build-overrides.py.
// Dynamic blocks come from the agent JSONs in your data cache dir.
// Static blocks (user, greeting, team, okrs, pins, weather) come from
// ~/.claude/dashboard-config.local — edit that file, not this one.
// =============================================================================

(function () {{
  // Real data is loaded — turn off the sample-data banner from data.jsx.
  window.SEED.demo = false;

  // --- Optional notice (e.g. Notion backend on but no tasks loaded) ----
  window.SEED.notice = {js_dump(NOTICE)};

  // --- User identity (from config) --------------------------------------
  window.SEED.user = {js_dump(STATIC_USER)};
  window.SEED.greeting = {js_dump(STATIC_GREETING)};

  // --- Calendar (from calendar.json) ------------------------------------
  window.SEED.calendar = {js_dump(cal_events)};

  // Compute next upcoming meeting from live clock.
  {PICK_NEXT_IIFE}

  // --- Top-3 today (from granola.json) ---------------------------------
  window.SEED.top3 = {js_dump(top3)};

  // --- Tasks (granola + gmail merged) -----------------------------------
  window.SEED.overdue  = {js_dump(overdue)};
  window.SEED.dueSoon  = {js_dump(duesoon)};
  window.SEED.blocked  = {js_dump(blocked)};
  window.SEED.shipped  = {js_dump(shipped)};

  // --- Blockers (granola + slack merged, sorted by sev) ----------------
  window.SEED.blockers = {js_dump(blockers)};

  // --- Team (from config) ----------------------------------------------
  window.SEED.team = {js_dump(STATIC_TEAM)};

  // --- Projects (from granola.json) -------------------------------------
  window.SEED.projects = {js_dump(projects)};

  // --- OKRs (from config) ----------------------------------------------
  window.SEED.okrs = {js_dump(STATIC_OKRS)};

  // --- Decisions pending (granola + gmail merged) -----------------------
  window.SEED.decisions = {js_dump(decisions)};

  // --- Recent meetings together (from granola.meetingHistory) ----------
  window.SEED.meetingHistory = {js_dump(meeting_history)};

  // --- Known / pinned people (from config) → Stakeholder Lens ----------
  window.SEED.knownPeople = {js_dump(STATIC_KNOWN_PEOPLE)};
  window.SEED.pinnedPeople = {js_dump(STATIC_PINNED_PEOPLE)};

  // --- Pins / Quick access (from config) -------------------------------
  window.SEED.pins = {js_dump(STATIC_PINS)};

  // --- Personal signals / Wellness (from wellness.json) ----------------
  window.SEED.personalSignals = {js_dump(ps)};

  // --- Inbox (from gmail.json) ------------------------------------------
  window.SEED.inbox = {js_dump(inbox)};

  // --- Slack (from slack.json) ------------------------------------------
  window.SEED.slack = {js_dump(slack_seed)};

  // --- Metrics card (from metrics.json; Looker/Snowflake) --------------
  // Only override when we actually fetched metrics — else keep the demo kpis.
  {("window.SEED.kpis = " + js_dump(kpis_seed) + ";") if kpis_seed else "// (no custom metrics — Metrics card keeps its bundled demo numbers)"}

  // --- Weather (from config) -------------------------------------------
  window.SEED.weather = {js_dump(STATIC_WEATHER)};

  console.log('[dashboard] live override applied · {src_summary}');
}})();
"""

OUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_OVERRIDE.write_text(jsx)


# ---------------------------------------------------------------------------
# Build drive-index.jsx (only on success)
# ---------------------------------------------------------------------------
drive_ok = drive.get("sourceOk", False) and drive_files
if drive_ok:
    DRIVE_INDEX.write_text(
        "/* global window */\n"
        "// Auto-generated by the `dashboard` skill from drive.json.\n"
        "// Used by the Find palette + voice mic \"open [file]\" fuzzy-match.\n"
        f"window.DRIVE_INDEX = {js_dump(drive_files)};\n"
    )
else:
    DRIVE_INDEX.write_text(
        "/* global window */\n"
        "// Drive agent failed this run — empty index.\n"
        "window.DRIVE_INDEX = [];\n"
    )


# ---------------------------------------------------------------------------
# Bump cache versions in Work Dashboard.html
# ---------------------------------------------------------------------------
if HTML_FILE.exists():
    html = HTML_FILE.read_text()
    html = bump_v(html, "data-override.jsx")
    if drive_ok:
        html = bump_v(html, "drive-index.jsx")
    HTML_FILE.write_text(html)


# ---------------------------------------------------------------------------
# Confirmation line
# ---------------------------------------------------------------------------
n_events = len(cal_events)
n_top3 = len(top3)
n_block = len(blockers)
# activeThreads is intentionally always [] (speed-tuning pass), so report the real
# slack signal — the channels on the radar — instead of a perpetual 0.
n_slack = len(slack_seed["channels"])
n_drive = len(drive_files)

# Failed sources with their reason (from each agent JSON's `error` field), so
# the confirmation line is self-diagnosing instead of just naming the agent.
_by_name = {"calendar": calendar, "granola": granola, "gmail": gmail,
            "slack": slack, "drive": drive, "wellness": wellness}
fail_bits = []
for n in failed:
    err = _by_name[n].get("error") or "no output file"
    fail_bits.append(f"{n} ({str(err)[:80]})")
fail_str = f" · failed: {'; '.join(fail_bits)}" if fail_bits else ""

config_str = (
    f" · CONFIG ERROR: ~/.claude/dashboard-config.local is invalid JSON"
    f" ({CFG_ERROR}) — all settings ignored, defaults used"
    if CFG_ERROR else ""
)

print(
    f"Dashboard refreshed · {ok_count}/6 sources · "
    f"{n_events} events · {n_top3} top3 · {n_block} blockers · "
    f"{n_slack} slack channels · {n_drive} drive files · reload the browser tab"
    f"{fail_str}{config_str}"
)
