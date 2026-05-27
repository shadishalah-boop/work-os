#!/usr/bin/env python3
"""
Build data-override.jsx and drive-index.jsx from agent JSON outputs.
Called by the dashboard skill orchestrator after the 6 sub-agents finish.

Replaces what used to be 5+ minutes of the orchestrator hand-writing JSX
with a single ~50ms Python run. Output and confirmation line match the
prior format exactly.

User identity, team roster, OKRs, pins, weather, and output paths are all
read from ~/.claude/dashboard-config.local at runtime. Nothing user-specific
is hardcoded — this file is identical for every install.

Usage:
    python3 <plugin>/skills/dashboard/build-overrides.py
"""

import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Load config — single source of truth for everything user-specific
# ---------------------------------------------------------------------------
HOME = Path.home()
CONFIG_PATH = HOME / ".claude" / "dashboard-config.local"

DEFAULT_CONFIG = {
    "user": {
        "name": "Friend",
        "fullName": "Friend",
        "role": "",
        "email": "",
        "timezone": "Europe/Madrid",
    },
    "org": {
        "company": "",
        "manager": {"name": "", "email": "", "role": ""},
        "team": {"attention": "", "people": []},
    },
    "slack": {"workspace": "", "userId": "", "highSignalChannels": []},
    "dashboard": {
        "workstreams": [],
        "classificationKeywords": [],
        "okrs": [],
        "pins": [],
        "weather": {"city": "Barcelona"},
        "focusTarget": 4,
        "knownPeople": [],
        "pinnedPeople": [],
    },
    "output": {
        "dashboardDir": "~/Documents/work-dashboard",
        "dataCacheDir": "~/.claude/dashboard-data",
    },
}


def deep_merge(base, overlay):
    """Recursively merge overlay onto base (overlay wins on conflict)."""
    out = dict(base)
    for k, v in (overlay or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config():
    """Read ~/.claude/dashboard-config.local; merge over defaults."""
    if not CONFIG_PATH.exists():
        sys.stderr.write(
            f"WARNING: {CONFIG_PATH} not found — using demo defaults. "
            f"Copy templates/dashboard-config.local.example to {CONFIG_PATH} and edit.\n"
        )
        return DEFAULT_CONFIG
    try:
        raw = json.loads(CONFIG_PATH.read_text())
        # Drop README key if present (it's only documentation)
        raw.pop("_README", None)
        return deep_merge(DEFAULT_CONFIG, raw)
    except Exception as e:
        sys.stderr.write(f"WARNING: failed to parse {CONFIG_PATH}: {e} — using defaults.\n")
        return DEFAULT_CONFIG


CONFIG = load_config()


def expand(path_str):
    """Expand ~ and env vars in a path string."""
    return Path(os.path.expandvars(os.path.expanduser(path_str)))


# Resolved paths
DATA_DIR = expand(CONFIG["output"]["dataCacheDir"])
OUT_DIR = expand(CONFIG["output"]["dashboardDir"])
DATA_OVERRIDE = OUT_DIR / "data-override.jsx"
DRIVE_INDEX = OUT_DIR / "drive-index.jsx"
HTML_FILE = OUT_DIR / "Work Dashboard.html"


# ---------------------------------------------------------------------------
# Static blocks — built from config.local
# ---------------------------------------------------------------------------
def js_dump(obj):
    """JSON-encode for embedding in JS. Uses unicode chars (no \\u escapes) and 2-space indent."""
    return json.dumps(obj, indent=2, ensure_ascii=False)


def build_static_user():
    u = CONFIG["user"]
    return js_dump({
        "name": u.get("name", "Friend"),
        "role": u.get("role", ""),
        "tz": u.get("timezone", "Europe/Madrid"),
    })


def build_static_greeting():
    name = CONFIG["user"].get("name", "Friend")
    return js_dump({
        "morning":   f"Morning, <em>{name}</em>.",
        "afternoon": f"Afternoon, <em>{name}</em>.",
        "evening":   f"Evening, <em>{name}</em>.",
    })


def build_static_team():
    team = CONFIG["org"]["team"]
    return js_dump({
        "attention": team.get("attention", ""),
        "people": team.get("people", []),
    })


def build_static_okrs():
    return js_dump(CONFIG["dashboard"].get("okrs", []))


def build_static_pins():
    return js_dump(CONFIG["dashboard"].get("pins", []))


def build_static_weather():
    w = CONFIG["dashboard"].get("weather", {})
    # If config only provides a city, emit a minimal block — a real agent could enrich it later.
    return js_dump({
        "city": w.get("city", "Barcelona"),
        "days": w.get("days", []),
    })


# IIFE that picks the next upcoming meeting at LOAD time (so the countdown
# stays accurate even if the dashboard is opened hours after the last refresh).
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
    """Load a per-agent JSON, returning a sourceOk:false stub on miss/error."""
    p = DATA_DIR / f"{name}.json"
    if not p.exists():
        return {"sourceOk": False, "error": f"{p} missing"}
    try:
        return json.loads(p.read_text())
    except Exception as e:
        return {"sourceOk": False, "error": f"{p} parse error: {e}"}


def safe(d, key, default=None):
    """Read a field with sourceOk fallback. Returns [] (or supplied default) if the source failed."""
    if not d.get("sourceOk", True):
        return [] if default is None else default
    return d.get(key) or ([] if default is None else default)


def first_name(name_or_obj):
    """Extract first name from {name, email} obj or a plain string."""
    if isinstance(name_or_obj, dict):
        n = name_or_obj.get("name", "") or ""
        return n.split()[0] if n else ""
    if isinstance(name_or_obj, str):
        return name_or_obj.split()[0] if name_or_obj else ""
    return ""


def bump_v(html, fname):
    """Increment the ?v=N suffix for the given filename in the HTML. Returns updated html."""
    pattern = rf'({re.escape(fname)}\?v=)(\d+)'
    def replace(m):
        return f"{m.group(1)}{int(m.group(2))+1}"
    return re.sub(pattern, replace, html, count=1)


# ---------------------------------------------------------------------------
# Read all 6 agent JSONs
# ---------------------------------------------------------------------------
calendar = load("calendar")
granola  = load("granola")
gmail    = load("gmail")
slack    = load("slack")
drive    = load("drive")
wellness = load("wellness")


# ---------------------------------------------------------------------------
# Merge per the rules in SKILL.md
# ---------------------------------------------------------------------------

# Calendar: events → {id, time, duration, title, type, who} with overflow handling.
cal_events = []
for i, e in enumerate(safe(calendar, "events")):
    attendees = e.get("attendees") or []
    overflow = e.get("overflow", 0) or 0
    who = [first_name(a) for a in attendees[:6]]
    if overflow > 0:
        who.append(f"+{overflow}")
    cal_events.append({
        "id": f"c{i+1}",
        "time": e.get("time"),
        "duration": e.get("duration"),
        "title": e.get("title"),
        "type": e.get("type", "event"),
        "who": who,
    })

# Top-3 (granola only, cap 3)
top3 = safe(granola, "top3")[:3]

# Overdue (granola + gmail concat, re-id, cap 5)
overdue_raw = safe(granola, "overdue") + safe(gmail, "overdue")
overdue = []
for i, item in enumerate(overdue_raw[:5]):
    o = dict(item); o["id"] = f"o{i+1}"
    overdue.append(o)

# Due soon (granola + gmail concat, re-id, cap 10)
duesoon_raw = safe(granola, "dueSoon") + safe(gmail, "dueSoon")
duesoon = []
for i, item in enumerate(duesoon_raw[:10]):
    d = dict(item); d["id"] = f"d{i+1}"
    duesoon.append(d)

# Blocked (granola only, cap 5)
blocked = safe(granola, "blocked")[:5]

# Shipped (slack only, cap 5)
shipped = safe(slack, "shipped")[:5]

# Blockers (granola + slack concat, sort high>medium>low, cap 5)
blockers_raw = safe(granola, "blockers") + safe(slack, "blockers")
sev_rank = {"high": 0, "medium": 1, "low": 2}
blockers = sorted(blockers_raw, key=lambda b: sev_rank.get(b.get("sev", "low"), 99))[:5]

# Projects (granola only, cap 8)
projects = safe(granola, "projects")[:8]

# Decisions (gmail first — they have hrefs — then granola; re-id; cap 5)
decisions_raw = list(safe(gmail, "decisions")) + list(safe(granola, "decisions"))
decisions = []
for i, item in enumerate(decisions_raw[:5]):
    d = dict(item); d["id"] = f"dec{i+1}"
    decisions.append(d)

# Meeting history (granola, sort newest-first, cap 30)
meeting_history = sorted(
    safe(granola, "meetingHistory"),
    key=lambda m: m.get("date", ""),
    reverse=True,
)[:30]

# Inbox (gmail only, cap 6)
inbox = safe(gmail, "inbox")[:6]

# Slack passthrough (workspace + tabs + channels + activeThreads — shipped is separate)
slack_seed = {
    "workspace":     slack.get("workspace") or CONFIG["slack"].get("workspace", ""),
    "tabs":          safe(slack, "tabs"),
    "channels":      safe(slack, "channels"),
    "activeThreads": safe(slack, "activeThreads"),
}

# Wellness passthrough (drop bookkeeping fields)
ps_drop = {"generatedAt", "sourceOk", "error"}
ps = {k: v for k, v in wellness.items() if k not in ps_drop} if wellness.get("sourceOk", False) else {}

# Drive files
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
src_summary = " ".join(f"{n}{'✓' if ok else '✗'}" for n, ok in sources)
ok_count = sum(1 for _, ok in sources if ok)
failed = [n for n, ok in sources if not ok]


# ---------------------------------------------------------------------------
# Build data-override.jsx
# ---------------------------------------------------------------------------
jsx = f"""/* global React, window */
// =============================================================================
// LIVE OVERRIDE - auto-regenerated by the `dashboard` skill via build-overrides.py.
// Dynamic blocks come from <dataCacheDir>/*.json.
// Static blocks (user, greeting, team, okrs, pins, weather) come from
// ~/.claude/dashboard-config.local.
// =============================================================================

(function () {{
  // --- User identity (from config.local) --------------------------------
  window.SEED.user = {build_static_user()};
  window.SEED.greeting = {build_static_greeting()};

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

  // --- Team (from config.local) ----------------------------------------
  window.SEED.team = {build_static_team()};

  // --- Projects (from granola.json) -------------------------------------
  window.SEED.projects = {js_dump(projects)};

  // --- OKRs (from config.local) ----------------------------------------
  window.SEED.okrs = {build_static_okrs()};

  // --- Decisions pending (granola + gmail merged) -----------------------
  window.SEED.decisions = {js_dump(decisions)};

  // --- Recent meetings together (from granola.meetingHistory) ----------
  window.SEED.meetingHistory = {js_dump(meeting_history)};

  // --- Pins / Quick access (from config.local) -------------------------
  window.SEED.pins = {build_static_pins()};

  // --- Personal signals / Wellness (from wellness.json) ----------------
  window.SEED.personalSignals = {js_dump(ps)};

  // --- Inbox (from gmail.json) ------------------------------------------
  window.SEED.inbox = {js_dump(inbox)};

  // --- Slack (from slack.json) ------------------------------------------
  window.SEED.slack = {js_dump(slack_seed)};

  // --- Weather (from config.local) -------------------------------------
  window.SEED.weather = {build_static_weather()};

  console.log('[dashboard] live override applied · {src_summary}');
}})();
"""

DATA_OVERRIDE.parent.mkdir(parents=True, exist_ok=True)
DATA_OVERRIDE.write_text(jsx)


# ---------------------------------------------------------------------------
# Build drive-index.jsx (only on success)
# ---------------------------------------------------------------------------
drive_ok = drive.get("sourceOk", False) and drive_files
if drive_ok:
    drive_jsx = f"""/* global window */
// Auto-generated by the `dashboard` skill from <dataCacheDir>/drive.json.
// Used by the Find palette + voice mic "open [file]" fuzzy-match.
window.DRIVE_INDEX = {js_dump(drive_files)};
"""
    DRIVE_INDEX.write_text(drive_jsx)
else:
    # Drive failed — keep an empty index so the Find palette still works.
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
# If the HTML file doesn't exist yet (first install), skip silently — the
# user just hasn't copied the dashboard files into <dashboardDir> yet.


# ---------------------------------------------------------------------------
# Confirmation line (matches the format in SKILL.md)
# ---------------------------------------------------------------------------
n_events  = len(cal_events)
n_top3    = len(top3)
n_block   = len(blockers)
n_threads = len(slack_seed["activeThreads"])
n_drive   = len(drive_files)

fail_str = f" · failed: {', '.join(failed)}" if failed else ""

print(
    f"Dashboard refreshed · {ok_count}/6 sources · "
    f"{n_events} events · {n_top3} top3 · {n_block} blockers · "
    f"{n_threads} slack threads · {n_drive} drive files · reload the browser tab"
    f"{fail_str}"
)
