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
back to ~/.claude/dashboard-data and ~/Documents/work-dashboard.
"""

import json
import os
import re
import sys
from pathlib import Path

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
OUT_DIR = cfg_path("output.dashboardDir", "~/Documents/work-dashboard")
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
    "attention": "Add your team in <code>~/.claude/dashboard-config.local</code> → <code>org.team</code>.",
    "people": [],
}

STATIC_OKRS = cfg_get("dashboard.okrs") or []
STATIC_PINS = cfg_get("dashboard.pins") or []
STATIC_KNOWN_PEOPLE = cfg_get("dashboard.knownPeople") or []
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

top3 = safe(granola, "top3")[:3]

overdue_raw = safe(granola, "overdue") + safe(gmail, "overdue")
overdue = []
for i, item in enumerate(overdue_raw[:5]):
    o = dict(item); o["id"] = f"o{i+1}"; overdue.append(o)

duesoon_raw = safe(granola, "dueSoon") + safe(gmail, "dueSoon")
duesoon = []
for i, item in enumerate(duesoon_raw[:10]):
    d = dict(item); d["id"] = f"d{i+1}"; duesoon.append(d)

blocked = safe(granola, "blocked")[:5]
shipped = safe(slack, "shipped")[:5]

blockers_raw = safe(granola, "blockers") + safe(slack, "blockers")
sev_rank = {"high": 0, "medium": 1, "low": 2}
blockers = sorted(blockers_raw, key=lambda b: sev_rank.get(b.get("sev", "low"), 99))[:5]

projects = safe(granola, "projects")[:8]

decisions_raw = list(safe(gmail, "decisions")) + list(safe(granola, "decisions"))
decisions = []
for i, item in enumerate(decisions_raw[:5]):
    d = dict(item); d["id"] = f"dec{i+1}"; decisions.append(d)

meeting_history = sorted(
    safe(granola, "meetingHistory"), key=lambda m: m.get("date", ""), reverse=True
)[:30]

inbox = safe(gmail, "inbox")[:6]

slack_seed = {
    "workspace":     slack.get("workspace", _slack_workspace) if slack.get("sourceOk", True) else _slack_workspace,
    "tabs":          safe(slack, "tabs"),
    "channels":      safe(slack, "channels"),
    "activeThreads": safe(slack, "activeThreads"),
}

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
