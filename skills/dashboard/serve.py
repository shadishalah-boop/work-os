#!/usr/bin/env python3
"""serve.py — the dashboard's local server, with a one-press refresh endpoint.

Usage:  serve.py <port> <dashboard-dir>

Serves the static dashboard bundle over http://127.0.0.1:<port> AND exposes:
  POST /refresh         → kicks off a background data refresh, returns immediately
  GET  /refresh-status  → {"running": bool, "last": "<last line>", "ok": bool}
  POST /slack-send      → SENDS a Slack message, returns {"ok": bool, ...}

This is what lets a button ON the dashboard refresh the data — or send a Slack
reply — without an interactive Claude Code session: each runs a headless `claude -p`
helper (refresh-headless.sh / slack-send-headless.sh) launched through a LOGIN
shell so `claude` is on PATH even when this server was started by launchd (whose
PATH is otherwise minimal).

/slack-send sends for real. Sending is irreversible, so the DASHBOARD guards against
accidental fires before it ever calls this: one-click "suggested reply" chips need a
second confirming click, and the compose box only sends what you typed. (To send with
a full confirmation of recipient + text, use the /dashboard-slack-send skill in an
interactive session.)

Caveats (honest):
  • Needs the `claude` CLI installed and `bypassPermissions` allowed.
  • Headless fetches the non-Slack sources; Slack needs an interactive session for
    consent, so it keeps its last value on a button refresh.
  • Whether every claude.ai connector is reachable headlessly can vary — if a source
    comes back empty (or /slack-send returns ok:false), do it from a Claude Code
    session instead. The dashboard falls back to copy-to-clipboard + open Slack.
"""
import http.server
import json
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
DASH_DIR = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
REFRESH = os.path.join(SKILL_DIR, "refresh-headless.sh")
SLACK_SEND = os.path.join(SKILL_DIR, "slack-send-headless.sh")
SKILL_RUN = os.path.join(SKILL_DIR, "skill-run-headless.sh")
ORG_PHOTO_RUN = os.path.join(SKILL_DIR, "org-photo-headless.sh")
# Custom Metrics-card definitions — the on-dashboard editor reads/writes this; the
# refresh agent reads it to know what to fetch from Looker/Snowflake.
METRICS_FILE = os.path.expanduser("~/.claude/dashboard-metrics.local.json")
# Left-rail skill shortcuts — the on-dashboard "Add skill" form reads/writes this.
SKILLS_FILE = os.path.expanduser("~/.claude/dashboard-skills.local.json")
# Team roster — populated by dropping a Personio/org-chart photo on the People card.
# build-overrides.py merges this into SEED.team so it survives /dashboard refreshes.
TEAM_FILE = os.path.expanduser("~/.claude/dashboard-team.local.json")
# Optional Notion task backend (off by default; enable with dashboard.tasks.backend
# = "notion"). The dashboard's done-toggle POSTs to /task-status; the
# `dashboard-notion-sync` skill pushes pending_sync changes to Notion (source of truth).
TASKS_FILE = os.path.expanduser("~/.claude/dashboard-tasks.local")


def _set_task_status(sync_key, notion_id, done):
    """Flip a task's done state in dashboard-tasks.local and mark it for Notion sync.
    No-op-safe: only matches tasks that carry a sync_key/notion_id (i.e. Notion-backed).
    Returns (ok, message). Does NOT rebuild data-override.jsx — the dashboard already
    updated its own UI optimistically, and the next refresh/Notion sync will reconcile.
    """
    try:
        data = json.loads(open(TASKS_FILE).read())
    except Exception as e:
        return False, f"cannot read tasks file: {e}"
    items = data.get("tasks") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return False, "tasks file has no 'tasks' list"
    hit = None
    for t in items:
        if (sync_key and t.get("sync_key") == sync_key) or (notion_id and t.get("notion_id") == notion_id):
            hit = t
            break
    if hit is None:
        return False, "task not found"
    hit["done"] = bool(done)
    hit["pending_sync"] = True
    try:
        with open(TASKS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        return False, f"cannot write tasks file: {e}"
    return True, "ok"
LOGIN_SHELL = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"

_state = {"running": False, "last": None, "ok": None, "started_at": None, "tokens": None, "cost": None}
_lock = threading.Lock()

REFRESH_TIMEOUT = 300  # seconds — hard cap so a stuck refresh always resolves (~5 min)
SLACK_SEND_TIMEOUT = 120  # seconds — a single send is light; bound it tightly
SKILL_RUN_TIMEOUT = 300  # seconds — hard cap so a stuck skill run always resolves

# Skill-run state — mirrors the refresh state machine (background job + status poll).
_skill_state = {"running": False, "last": None, "ok": None, "started_at": None, "label": None, "output": None}
_skill_lock = threading.Lock()
SKILL_OUTPUT_CAP = 40000  # chars — enough to read a result in the popup, bounded

# Org-photo import state — same background-job + status-poll pattern.
_org_state = {"running": False, "ok": None, "message": None, "people": None, "started_at": None}
_org_lock = threading.Lock()
ORG_PHOTO_TIMEOUT = 240  # seconds — vision read + extraction, bounded


def _run_refresh():
    try:
        # Login shell (-lc) so the user's PATH (and `claude`) is available even under launchd.
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(REFRESH)}"],
            capture_output=True, text=True, timeout=REFRESH_TIMEOUT,
        )
        out = (proc.stdout or "").strip().splitlines()
        err = (proc.stderr or "").strip().splitlines()
        # refresh-headless.sh emits a "__REFRESH_USAGE__ tokens=<N> cost=<C>" line
        # (v0.14). Pull the token/cost telemetry out of it and keep the real
        # confirmation line as the human-readable status.
        tokens, cost, kept = None, None, []
        for ln in out:
            s = ln.strip()
            if s.startswith("__REFRESH_USAGE__"):
                for part in s.split():
                    if part.startswith("tokens="):
                        try: tokens = int(part[len("tokens="):])
                        except ValueError: pass
                    elif part.startswith("cost="):
                        val = part[len("cost="):]
                        try: cost = float(val) if val else None
                        except ValueError: pass
                continue
            kept.append(s)
        last = (kept[-1] if kept else (err[-1] if err else "")).strip()
        with _lock:
            _state["last"] = last or "(no output)"
            _state["ok"] = proc.returncode == 0
            _state["tokens"] = tokens
            _state["cost"] = cost
    except subprocess.TimeoutExpired:
        with _lock:
            _state["last"] = (f"Refresh timed out after {REFRESH_TIMEOUT // 60} min. "
                              "A headless refresh may stall on connector consent — run /dashboard "
                              "in Claude Code, or check ~/.claude/dashboard-serve.log.")
            _state["ok"] = False
            _state["tokens"] = None
            _state["cost"] = None
    except Exception as e:
        with _lock:
            _state["last"] = f"refresh error: {e}"
            _state["ok"] = False
            _state["tokens"] = None
            _state["cost"] = None
    finally:
        with _lock:
            _state["running"] = False


def _slack_send_prompt(text, permalink, channel):
    """Build the headless prompt that SENDS a Slack message.

    `text` is passed as DATA inside the prompt (not interpolated into any shell),
    so there is no shell-escaping concern — it reaches `claude` via a temp file
    read on stdin.
    """
    permalink = (permalink or "").strip()
    channel = (channel or "").strip()
    target = []
    if permalink:
        target.append(f"- Permalink of the thread/message to reply to: {permalink}")
    if channel:
        target.append(f"- Channel hint (name or id): {channel}")
    target_block = "\n".join(target) if target else "- (no target given — infer nothing; FAIL if you cannot resolve a channel)"
    return f"""You are sending a Slack message on the user's behalf. The user has already
confirmed this send from their dashboard, so send it — do not ask for further
confirmation and do not create a draft.

Resolve the send tool, in order: mcp__claude_ai_Slack__slack_send_message,
else mcp__Slack__slack_send_message, else use ToolSearch with the query
"slack send message" and use the matching send tool. Use the real send tool —
NOT the _draft variant, NOT slack_schedule_message.

Target:
{target_block}

Steps:
1. Resolve the destination channel id (and thread_ts if the permalink points at a
   thread). If you only have a channel name, resolve it with slack_search_channels.
   NEVER invent a channel or user id. If you cannot resolve a real destination,
   print exactly "SEND_FAIL could not resolve a channel" and stop (do not send).
2. Call the send tool to post the message text below to that channel/thread, used
   VERBATIM (do not rewrite, summarize, or add to it).
3. Print exactly ONE final line: "SEND_OK <channel-or-name>" on success, or
   "SEND_FAIL <short reason>" on failure. No other output.

Message text (verbatim):
---
{text}
---
"""


def _run_slack_send(text, permalink, channel, result):
    """Run the headless send helper; fill `result` with ok/message."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(_slack_send_prompt(text, permalink, channel))
            tmp_path = f.name
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(SLACK_SEND)} {shlex.quote(tmp_path)}"],
            capture_output=True, text=True, timeout=SLACK_SEND_TIMEOUT,
        )
        out = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        ok = "SEND_OK" in out
        # Surface the single status line if present, else a trimmed tail.
        line = next((ln.strip() for ln in reversed(out.splitlines())
                     if "SEND_OK" in ln or "SEND_FAIL" in ln), "")
        result["ok"] = ok
        result["message"] = line or (out.splitlines()[-1].strip() if out else "(no output)")
    except subprocess.TimeoutExpired:
        result["ok"] = False
        result["message"] = (f"Send timed out after {SLACK_SEND_TIMEOUT // 60} min. "
                             "Headless Slack may need consent — use /dashboard-slack-send instead.")
    except Exception as e:
        result["ok"] = False
        result["message"] = f"send error: {e}"
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _run_skill(command):
    """Run a skill/command headlessly (mirrors _run_refresh): write the invocation to a
    temp prompt file, run skill-run-headless.sh through a login shell, record the result."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write(command)
            tmp_path = f.name
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(SKILL_RUN)} {shlex.quote(tmp_path)}"],
            capture_output=True, text=True, timeout=SKILL_RUN_TIMEOUT,
        )
        full = ((proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")).strip()
        out = (proc.stdout or "").strip().splitlines()
        err = (proc.stderr or "").strip().splitlines()
        last = (out[-1] if out else (err[-1] if err else "")).strip()
        with _skill_lock:
            _skill_state["last"] = last or "(done — no output)"
            _skill_state["output"] = full[:SKILL_OUTPUT_CAP] or "(the skill produced no output)"
            _skill_state["ok"] = proc.returncode == 0
    except subprocess.TimeoutExpired:
        with _skill_lock:
            _skill_state["last"] = (f"Skill timed out after {SKILL_RUN_TIMEOUT // 60} min. "
                                    "It may need an interactive session (connector/consent) — run it in Claude Code.")
            _skill_state["output"] = _skill_state["last"]
            _skill_state["ok"] = False
    except Exception as e:
        with _skill_lock:
            _skill_state["last"] = f"skill error: {e}"
            _skill_state["output"] = _skill_state["last"]
            _skill_state["ok"] = False
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        with _skill_lock:
            _skill_state["running"] = False


def _extract_json_array(text):
    """Pull the first top-level JSON array out of a headless run's stdout (which may
    include log noise around it). Returns a Python list, or None if none parses."""
    if not text:
        return None
    # Fast path: whole thing is the array.
    t = text.strip()
    try:
        v = json.loads(t)
        if isinstance(v, list):
            return v
    except Exception:
        pass
    # Otherwise scan for the first balanced [...] block.
    start = t.find("[")
    while start != -1:
        depth = 0
        for i in range(start, len(t)):
            if t[i] == "[":
                depth += 1
            elif t[i] == "]":
                depth -= 1
                if depth == 0:
                    chunk = t[start:i + 1]
                    try:
                        v = json.loads(chunk)
                        if isinstance(v, list):
                            return v
                    except Exception:
                        break
        start = t.find("[", start + 1)
    return None


def _user_name_keys():
    """Load the dashboard owner's name(s) from the config so we can skip them in
    the imported roster. Best-effort; if the config is unreadable we just skip
    the filter (build-overrides applies the same filter as a backstop)."""
    try:
        cfg_path = os.path.expanduser("~/.claude/dashboard-config.local")
        if not os.path.exists(cfg_path):
            return set()
        with open(cfg_path) as f:
            cfg = json.load(f)
        u = (cfg.get("user") or {}) if isinstance(cfg, dict) else {}
        keys = set()
        for n in [u.get("name"), u.get("fullName")]:
            n = (n or "").strip().lower()
            if not n:
                continue
            keys.add(n)
            first = n.split()[0]
            if len(first) >= 3:
                keys.add(first)
        return keys
    except Exception:
        return set()


def _normalize_people(raw):
    """Coerce the extracted array into the dashboard's team-person shape, and drop
    the dashboard owner — their card is usually on the Personio chart but they
    shouldn't end up in their own team."""
    self_keys = _user_name_keys()
    people = []
    for p in (raw or []):
        if not isinstance(p, dict):
            continue
        name = (p.get("name") or "").strip()
        if not name:
            continue
        lc = name.lower()
        first = lc.split()[0] if lc else ""
        if lc in self_keys or (first and first in self_keys):
            continue
        status = (p.get("status") or "in").strip().lower()
        person = {
            "name": name,
            "note": (p.get("role") or p.get("note") or "").strip(),
            "group": (p.get("group") or "").strip(),
            "status": status if status in ("in", "ooo", "onboarding") else "in",
            "ooo": status == "ooo",
        }
        people.append(person)
    return people


def _run_org_photo(image_path):
    """Read a dropped org-chart image headlessly, extract people JSON, persist to
    TEAM_FILE so build-overrides merges it into SEED.team on the next refresh."""
    try:
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(ORG_PHOTO_RUN)} {shlex.quote(image_path)}"],
            capture_output=True, text=True, timeout=ORG_PHOTO_TIMEOUT,
        )
        out = (proc.stdout or "").strip()
        people = _normalize_people(_extract_json_array(out))
        if proc.returncode == 0 and people:
            try:
                os.makedirs(os.path.dirname(TEAM_FILE), exist_ok=True)
                with open(TEAM_FILE, "w") as f:
                    json.dump({"people": people}, f, indent=2)
            except Exception:
                pass
            with _org_lock:
                _org_state["ok"] = True
                _org_state["people"] = people
                _org_state["message"] = f"Imported {len(people)} people"
        else:
            tail = (proc.stderr or out or "").strip().splitlines()
            with _org_lock:
                _org_state["ok"] = False
                _org_state["people"] = None
                _org_state["message"] = (tail[-1] if tail else "Couldn't read any people from that image.")
    except subprocess.TimeoutExpired:
        with _org_lock:
            _org_state["ok"] = False
            _org_state["message"] = (f"Photo import timed out after {ORG_PHOTO_TIMEOUT // 60} min. "
                                     "Try a clearer screenshot, or add your team via /dashboard.")
    except Exception as e:
        with _org_lock:
            _org_state["ok"] = False
            _org_state["message"] = f"import error: {e}"
    finally:
        try:
            os.unlink(image_path)
        except OSError:
            pass
        with _org_lock:
            _org_state["running"] = False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DASH_DIR, **k)

    def log_message(self, *a):
        pass  # quiet

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_POST(self):
        path = self.path.rstrip("/")
        if path == "/refresh":
            with _lock:
                if _state["running"]:
                    return self._json(202, {"status": "already-running"})
                _state["running"] = True
                _state["ok"] = None
                _state["last"] = None
                _state["tokens"] = None
                _state["cost"] = None
                _state["started_at"] = time.time()
            threading.Thread(target=_run_refresh, daemon=True).start()
            return self._json(202, {"status": "started"})
        if path == "/task-status":
            body = self._read_json_body()
            ok, msg = _set_task_status(body.get("sync_key"), body.get("notion_id"), body.get("done"))
            return self._json(200 if ok else 404, {"ok": ok, "message": msg})
        if path == "/slack-send":
            body = self._read_json_body()
            text = (body.get("text") or "").strip()
            if not text:
                return self._json(400, {"ok": False, "message": "empty message"})
            # Synchronous: the dashboard waits, then falls back to copy+open if this
            # returns ok:false. Bounded by SLACK_SEND_TIMEOUT.
            result = {"ok": False, "message": ""}
            _run_slack_send(text, body.get("permalink"), body.get("channel"), result)
            return self._json(200, result)
        if path == "/metrics-config":
            # Save the metric definitions the editor produced. We only persist the
            # definition fields (label/source/refs/target/format) — not fetched values.
            body = self._read_json_body()
            items = body.get("items")
            if not isinstance(items, list):
                return self._json(400, {"ok": False, "message": "expected {items: [...]}"})
            try:
                os.makedirs(os.path.dirname(METRICS_FILE), exist_ok=True)
                with open(METRICS_FILE, "w") as f:
                    json.dump({"items": items}, f, indent=2)
                return self._json(200, {"ok": True, "count": len(items)})
            except Exception as e:
                return self._json(500, {"ok": False, "message": f"write error: {e}"})
        if path == "/skills-config":
            body = self._read_json_body()
            items = body.get("items")
            if not isinstance(items, list):
                return self._json(400, {"ok": False, "message": "expected {items: [...]}"})
            try:
                os.makedirs(os.path.dirname(SKILLS_FILE), exist_ok=True)
                with open(SKILLS_FILE, "w") as f:
                    json.dump({"items": items}, f, indent=2)
                return self._json(200, {"ok": True, "count": len(items)})
            except Exception as e:
                return self._json(500, {"ok": False, "message": f"write error: {e}"})
        if path == "/run-skill":
            # Launch a skill headlessly, EXACTLY like /refresh: background job + status poll.
            body = self._read_json_body()
            command = (body.get("command") or "").strip()
            if not command:
                return self._json(400, {"ok": False, "message": "no command"})
            with _skill_lock:
                if _skill_state["running"]:
                    return self._json(202, {"status": "already-running", "label": _skill_state.get("label")})
                _skill_state["running"] = True
                _skill_state["ok"] = None
                _skill_state["last"] = None
                _skill_state["output"] = None
                _skill_state["started_at"] = time.time()
                _skill_state["label"] = (body.get("label") or command)
            threading.Thread(target=_run_skill, args=(command,), daemon=True).start()
            return self._json(202, {"status": "started"})
        if path == "/import-org-photo":
            # Body: {"image": "data:image/png;base64,...."} OR {"image": "<base64>", "ext": "png"}.
            # Decode → temp file → headless vision extraction (background, poll for status).
            body = self._read_json_body()
            data_url = (body.get("image") or "").strip()
            if not data_url:
                return self._json(400, {"ok": False, "message": "no image"})
            ext = (body.get("ext") or "png").lstrip(".")
            b64 = data_url
            if data_url.startswith("data:"):
                try:
                    header, b64 = data_url.split(",", 1)
                    if "image/" in header:
                        ext = header.split("image/")[1].split(";")[0] or ext
                except ValueError:
                    return self._json(400, {"ok": False, "message": "malformed data URL"})
            import base64
            try:
                raw = base64.b64decode(b64, validate=False)
            except Exception as e:
                return self._json(400, {"ok": False, "message": f"bad base64: {e}"})
            if len(raw) > 12 * 1024 * 1024:
                return self._json(413, {"ok": False, "message": "image too large (max 12MB)"})
            with _org_lock:
                if _org_state["running"]:
                    return self._json(202, {"status": "already-running"})
                _org_state.update({"running": True, "ok": None, "message": None, "people": None, "started_at": time.time()})
            try:
                fd, img_path = tempfile.mkstemp(suffix="." + (ext if ext.isalnum() else "png"))
                with os.fdopen(fd, "wb") as f:
                    f.write(raw)
            except Exception as e:
                with _org_lock:
                    _org_state.update({"running": False, "ok": False, "message": f"temp write error: {e}"})
                return self._json(500, {"ok": False, "message": str(e)})
            threading.Thread(target=_run_org_photo, args=(img_path,), daemon=True).start()
            return self._json(202, {"status": "started"})
        if path == "/team-config":
            body = self._read_json_body()
            people = body.get("people")
            if not isinstance(people, list):
                return self._json(400, {"ok": False, "message": "expected {people: [...]}"})
            try:
                os.makedirs(os.path.dirname(TEAM_FILE), exist_ok=True)
                with open(TEAM_FILE, "w") as f:
                    json.dump({"people": people}, f, indent=2)
                return self._json(200, {"ok": True, "count": len(people)})
            except Exception as e:
                return self._json(500, {"ok": False, "message": f"write error: {e}"})
        self.send_error(404)

    def do_GET(self):
        if self.path.rstrip("/") == "/refresh-status":
            with _lock:
                s = dict(_state)
            s["elapsed"] = int(time.time() - s["started_at"]) if s.get("started_at") else 0
            return self._json(200, s)
        if self.path.rstrip("/") == "/metrics-config":
            try:
                if os.path.exists(METRICS_FILE):
                    with open(METRICS_FILE) as f:
                        data = json.load(f)
                    items = data.get("items") if isinstance(data, dict) else None
                    return self._json(200, {"items": items if isinstance(items, list) else []})
                return self._json(200, {"items": []})
            except Exception as e:
                return self._json(200, {"items": [], "error": str(e)})
        if self.path.rstrip("/") == "/skills-config":
            try:
                if os.path.exists(SKILLS_FILE):
                    with open(SKILLS_FILE) as f:
                        data = json.load(f)
                    items = data.get("items") if isinstance(data, dict) else None
                    return self._json(200, {"items": items if isinstance(items, list) else []})
                return self._json(200, {"items": []})
            except Exception as e:
                return self._json(200, {"items": [], "error": str(e)})
        if self.path.rstrip("/") == "/run-skill-status":
            with _skill_lock:
                s = dict(_skill_state)
            s["elapsed"] = int(time.time() - s["started_at"]) if s.get("started_at") else 0
            return self._json(200, s)
        if self.path.rstrip("/") == "/import-org-status":
            with _org_lock:
                s = dict(_org_state)
            s["elapsed"] = int(time.time() - s["started_at"]) if s.get("started_at") else 0
            return self._json(200, s)
        if self.path.rstrip("/") == "/team-config":
            try:
                if os.path.exists(TEAM_FILE):
                    with open(TEAM_FILE) as f:
                        data = json.load(f)
                    people = data.get("people") if isinstance(data, dict) else None
                    return self._json(200, {"people": people if isinstance(people, list) else []})
                return self._json(200, {"people": []})
            except Exception as e:
                return self._json(200, {"people": [], "error": str(e)})
        return super().do_GET()


class _ThreadingHTTPServerV6(http.server.ThreadingHTTPServer):
    """IPv6 variant so the `localhost` bookmark works when it resolves to ::1."""
    address_family = socket.AF_INET6


if __name__ == "__main__":
    os.makedirs(DASH_DIR, exist_ok=True)
    # Serve on BOTH loopback stacks (IPv4 127.0.0.1 + IPv6 ::1) on the same port, so
    # http://localhost:<port> works regardless of whether `localhost` resolves to
    # 127.0.0.1 or ::1. Loopback-only — never exposed to the network. If IPv6 is
    # unavailable, the IPv4 listener below still serves everything.
    try:
        v6 = _ThreadingHTTPServerV6(("::1", PORT), Handler)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError:
        pass  # no IPv6 loopback — IPv4 below covers it
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
