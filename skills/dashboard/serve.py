#!/usr/bin/env python3
"""serve.py — the dashboard's local server, with a one-press refresh endpoint.

Usage:  serve.py <port> <dashboard-dir>

Serves the static dashboard bundle over http://127.0.0.1:<port> AND exposes:
  POST /refresh         → kicks off a background data refresh, returns immediately
  GET  /refresh-status  → {"running": bool, "last": "<last line>", "ok": bool}

This is what lets a button ON the dashboard refresh the data without an interactive
Claude Code session: the refresh runs `refresh-headless.sh` (a headless `claude -p`)
in the background. It's launched through a LOGIN shell so `claude` is on PATH even
when this server was started by launchd (whose PATH is otherwise minimal).

Caveats (honest):
  • Needs the `claude` CLI installed and `bypassPermissions` allowed.
  • Headless fetches the non-Slack sources; Slack needs an interactive session for
    consent, so it keeps its last value on a button refresh.
  • Whether every claude.ai connector is reachable headlessly can vary — if a source
    comes back empty, refresh from a Claude Code session instead.
"""
import http.server
import json
import os
import shlex
import subprocess
import sys
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
DASH_DIR = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
REFRESH = os.path.join(SKILL_DIR, "refresh-headless.sh")
LOGIN_SHELL = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"

_state = {"running": False, "last": None, "ok": None, "started_at": None}
_lock = threading.Lock()

REFRESH_TIMEOUT = 300  # seconds — hard cap so a stuck refresh always resolves (~5 min)


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

    def do_POST(self):
        if self.path.rstrip("/") == "/refresh":
            with _lock:
                if _state["running"]:
                    return self._json(202, {"status": "already-running"})
                _state["running"] = True
                _state["ok"] = None
                _state["last"] = None
                _state["started_at"] = time.time()
            threading.Thread(target=_run_refresh, daemon=True).start()
            return self._json(202, {"status": "started"})
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
