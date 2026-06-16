#!/usr/bin/env python3
"""serve.py — the dashboard's local server, with a one-press refresh endpoint.

Usage:  serve.py <port> <dashboard-dir>

Serves the static dashboard bundle over http://127.0.0.1:<port> AND exposes:
  POST /refresh         → kicks off a background data refresh, returns immediately
  GET  /refresh-status  → {"running": bool, "last": "<last line>", "ok": bool}
  POST /slack-send      → stages a Slack DRAFT (never sends), returns {"ok": bool, ...}

This is what lets a button ON the dashboard refresh the data — or stage a Slack
reply — without an interactive Claude Code session: each runs a headless `claude -p`
helper (refresh-headless.sh / slack-draft-headless.sh) launched through a LOGIN
shell so `claude` is on PATH even when this server was started by launchd (whose
PATH is otherwise minimal).

/slack-send is DRAFT-ONLY by design: sending is irreversible, so a dashboard button
must never send. It stages a draft in Slack for you to review and send there. To
actually send, use the /dashboard-slack-send skill in an interactive session (it
confirms the recipient + text first).

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
SLACK_DRAFT = os.path.join(SKILL_DIR, "slack-draft-headless.sh")
LOGIN_SHELL = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"

_state = {"running": False, "last": None, "ok": None, "started_at": None}
_lock = threading.Lock()

REFRESH_TIMEOUT = 300  # seconds — hard cap so a stuck refresh always resolves (~5 min)
SLACK_DRAFT_TIMEOUT = 120  # seconds — a single draft is light; bound it tightly


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


def _slack_draft_prompt(text, permalink, channel):
    """Build the headless prompt that stages a Slack DRAFT (never sends).

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
    return f"""You are staging a Slack DRAFT on the user's behalf. DO NOT SEND anything.

Resolve the draft tool, in order: mcp__claude_ai_Slack__slack_send_message_draft,
else mcp__Slack__slack_send_message_draft, else use ToolSearch with the query
"slack send message draft" and use the matching draft tool. Use the DRAFT variant —
never slack_send_message (no _draft), never slack_schedule_message.

Target:
{target_block}

Steps:
1. Resolve the destination channel id (and thread_ts if the permalink points at a
   thread). If you only have a channel name, resolve it with slack_search_channels.
   NEVER invent a channel or user id. If you cannot resolve a real destination,
   print exactly "DRAFT_FAIL could not resolve a channel" and stop.
2. Call the DRAFT tool to stage a draft in that channel/thread with the message text
   below, used VERBATIM (do not rewrite, summarize, or add to it).
3. Do NOT send. Print exactly ONE final line: "DRAFT_OK <channel-or-name>" on success,
   or "DRAFT_FAIL <short reason>" on failure. No other output.

Message text (verbatim):
---
{text}
---
"""


def _run_slack_draft(text, permalink, channel, result):
    """Run the headless draft helper; fill `result` with ok/message."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(_slack_draft_prompt(text, permalink, channel))
            tmp_path = f.name
        proc = subprocess.run(
            [LOGIN_SHELL, "-lc", f"bash {shlex.quote(SLACK_DRAFT)} {shlex.quote(tmp_path)}"],
            capture_output=True, text=True, timeout=SLACK_DRAFT_TIMEOUT,
        )
        out = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        ok = "DRAFT_OK" in out
        # Surface the single status line if present, else a trimmed tail.
        line = next((ln.strip() for ln in reversed(out.splitlines())
                     if "DRAFT_OK" in ln or "DRAFT_FAIL" in ln), "")
        result["ok"] = ok
        result["message"] = line or (out.splitlines()[-1].strip() if out else "(no output)")
    except subprocess.TimeoutExpired:
        result["ok"] = False
        result["message"] = (f"Draft timed out after {SLACK_DRAFT_TIMEOUT // 60} min. "
                             "Headless Slack may need consent — use /dashboard-slack-send instead.")
    except Exception as e:
        result["ok"] = False
        result["message"] = f"draft error: {e}"
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
            # Synchronous + draft-only: the dashboard waits, then falls back to
            # copy+open if this returns ok:false. Bounded by SLACK_DRAFT_TIMEOUT.
            result = {"ok": False, "message": ""}
            _run_slack_draft(text, body.get("permalink"), body.get("channel"), result)
            return self._json(200, result)
        self.send_error(404)

    def do_GET(self):
        if self.path.rstrip("/") == "/refresh-status":
            with _lock:
                s = dict(_state)
            s["elapsed"] = int(time.time() - s["started_at"]) if s.get("started_at") else 0
            return self._json(200, s)
        return super().do_GET()


if __name__ == "__main__":
    os.makedirs(DASH_DIR, exist_ok=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
