#!/usr/bin/env python3
"""tzresolve.py — single source of truth for the dashboard's timezone.

Resolution order (highest priority first):
  1. An explicit IANA zone in config (`user.timezone`), UNLESS it is "auto" or
     empty. This lets a user PIN a fixed zone (e.g. always show HQ time).
  2. The live system timezone, detected fresh on every call — so a traveling
     user's dashboard follows their laptop automatically, every refresh.
  3. A neutral fallback (UTC) if detection somehow fails.

Used two ways:
  - Imported by build-overrides.py / drive-transform.py:
        from tzresolve import resolve_timezone
  - Run as a CLI by the bash scripts (prep.sh):
        python3 tzresolve.py [config_path]   # prints the resolved zone, no newline
"""
import os


def _looks_like_zone(s):
    """True for IANA-style names (Area/City) plus the valid single-word zones."""
    if not isinstance(s, str):
        return False
    s = s.strip()
    if not s or len(s) > 64 or any(c.isspace() for c in s):
        return False
    return ("/" in s) or s in ("UTC", "GMT", "Zulu", "Universal")


def detect_system_tz():
    """Best-effort live system IANA timezone, or None. Cross-platform, no deps."""
    # 1. TZ env var, if it names a zone (ignore offset forms like "UTC+2").
    tz = os.environ.get("TZ", "")
    if _looks_like_zone(tz):
        return tz.strip()

    # 2. /etc/localtime symlink → .../zoneinfo/<Area>/<City>  (macOS + Linux).
    try:
        p = os.path.realpath("/etc/localtime")
        if "zoneinfo/" in p:
            cand = p.split("zoneinfo/")[-1].strip("/").strip()
            if _looks_like_zone(cand):
                return cand
    except Exception:
        pass

    # 3. /etc/timezone plain-text file (Debian/Ubuntu).
    try:
        with open("/etc/timezone") as f:
            cand = f.read().strip()
        if _looks_like_zone(cand):
            return cand
    except Exception:
        pass

    # 4. systemd (Linux).
    try:
        import subprocess
        out = subprocess.run(
            ["timedatectl", "show", "-p", "Timezone", "--value"],
            capture_output=True, text=True, timeout=3,
        )
        cand = (out.stdout or "").strip()
        if _looks_like_zone(cand):
            return cand
    except Exception:
        pass

    return None


def resolve_timezone(cfg, fallback="UTC"):
    """Explicit pinned zone wins; otherwise the live system zone; else fallback."""
    pinned = None
    if isinstance(cfg, dict):
        user = cfg.get("user")
        if isinstance(user, dict):
            pinned = user.get("timezone")
    if isinstance(pinned, str) and pinned.strip() and pinned.strip().lower() != "auto":
        return pinned.strip()
    return detect_system_tz() or fallback


if __name__ == "__main__":
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "~/.claude/dashboard-config.local"
    cfg = {}
    try:
        with open(os.path.expanduser(path)) as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    # No trailing newline so `$(...)` in bash captures the bare zone.
    sys.stdout.write(resolve_timezone(cfg))
