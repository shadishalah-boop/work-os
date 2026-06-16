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
# Custom Metrics-card definitions — the on-dashboard editor reads/writes this; the
# refresh agent reads it to know what to fetch from Looker/Snowflake.
METRICS_FILE = os.path.expanduser("~/.claude/dashboard-metrics.local.json")
LOGIN_SHELL = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"

_state = {"running": False, "last": None, "ok": None, "started_at": None}
_lock = threading.Lock()

REFRESH_TIMEOUT = 300  # seconds — hard cap so a stuck refresh always resolves (~5 min)
SLACK_SEND_TIMEOUT = 120  # seconds — a single send is light; bound it tightly


def _run_refresh():
    try:
        # Login shell (-lc) so the user's PATH (and `claude`) is available even under launchd.
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(REFRESH)}"],
            capture_output=True, text=True, timeout=REFRESH_TIMEOUT,
        )
        out = (proc.stdout or "").strip().splitlines()
        err = (proc.stderr or "").strip().splitlines()
        last = (out[-1] if out else (err[-1] if err else "")).strip()
        with _lock:
            _state["last"] = last or "(no output)"
            _state["ok"] = proc.returncode == 0
    except subprocess.TimeoutExpired:
        with _lock:
            _state["last"] = (f"Refresh timed out after {REFRESH_TIMEOUT // 60} min. "
                              "A headless refresh may stall on connector consent — run /dashboard "
                              "in Claude Code, or check ~/.claude/dashboard-serve.log.")
            _state["ok"] = False
    except Exception as e:
        with _lock:
            _state["last"] = f"refresh error: {e}"
            _state["ok"] = False
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
                _state["started_at"] = time.time()
            threading.Thread(target=_run_refresh, daemon=True).start()
            return self._json(202, {"status": "started"})
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
        return super().do_GET()


if __name__ == "__main__":
    os.makedirs(DASH_DIR, exist_ok=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
