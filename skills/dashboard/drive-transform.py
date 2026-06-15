#!/usr/bin/env python3
"""drive-transform.py — transforms the raw Drive listing into drive.json.

Reads  <dataCacheDir>/drive-raw.json   (the verbatim recent-files response,
       dumped by the dashboard-drive agent via the Write tool)
Writes <dataCacheDir>/drive.json       (the dashboard-ready index)

Takes no arguments. Invoked by wait-and-merge.sh as `python3 <path>.py`.

Why a committed script: Claude Code's permission matcher won't auto-approve a
`python3 << 'EOF'` heredoc (it can't statically parse it), so the drive agent
kept prompting. A plain `python3 <path>.py` invocation IS parseable. All the
tedious mimeType/URL/timestamp math lives here (deterministic, higher quality
than asking a small model to format rows by hand).

Per-user values (data cache dir, "my" email for owner detection) come from
~/.claude/dashboard-config.local — nothing personal is hardcoded.
"""
import json
import os
import sys
import datetime

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

# Shared timezone resolver (lives next to this script).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from tzresolve import resolve_timezone
except Exception:  # pragma: no cover
    def resolve_timezone(cfg, fallback="UTC"):
        v = (cfg or {}).get("user", {}).get("timezone") if isinstance(cfg, dict) else None
        return v.strip() if isinstance(v, str) and v.strip() and v.strip().lower() != "auto" else fallback

HOME = os.path.expanduser("~")
CONFIG_PATH = os.path.join(HOME, ".claude", "dashboard-config.local")


def load_config():
    try:
        return json.load(open(CONFIG_PATH))
    except Exception:
        return {}


CFG = load_config()


def cfg_get(dotted, default=None):
    v = CFG
    for k in dotted.split("."):
        v = v.get(k) if isinstance(v, dict) else None
    return v if v is not None else default


DATA = os.path.expanduser(cfg_get("output.dataCacheDir", "~/.claude/dashboard-data"))
RAW = os.path.join(DATA, "drive-raw.json")
OUT = os.path.join(DATA, "drive.json")
_tzname = resolve_timezone(CFG)   # explicit pin > live system zone > UTC
try:
    TZ = ZoneInfo(_tzname) if ZoneInfo else datetime.timezone.utc
except Exception:
    TZ = datetime.timezone.utc   # invalid/unknown zone name → never crash
ME_EMAIL = (cfg_get("user.email", "") or "").lower()

KIND = {
    "application/vnd.google-apps.document": "doc",
    "application/vnd.google-apps.spreadsheet": "sheet",
    "application/vnd.google-apps.presentation": "slide",
    "application/pdf": "pdf",
    "application/vnd.google-apps.folder": "folder",
}
URL_PATH = {"doc": "document", "sheet": "spreadsheets", "slide": "presentation"}


def rel_label(dt, now):
    days = (now.date() - dt.date()).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < 28:
        return f"{days // 7}w ago"
    return f"{min(days // 30, 12)}mo ago"


def find_items(raw):
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for k in ("files", "items", "results", "data", "recentFiles"):
            v = raw.get(k)
            if isinstance(v, list):
                return v
    return []


def main():
    now = datetime.datetime.now(TZ)
    try:
        raw = json.load(open(RAW))
    except Exception as e:
        json.dump({"files": [], "generatedAt": now.isoformat(),
                   "sourceOk": False, "error": f"cannot read drive-raw.json: {e}"},
                  open(OUT, "w"), indent=2)
        print("X")
        return

    seen = set()
    files = []
    for it in find_items(raw):
        if not isinstance(it, dict):
            continue
        fid = it.get("id") or it.get("fileId")
        if not fid or fid in seen:
            continue
        title = (it.get("name") or it.get("title") or "").strip()
        if not title or title.lower() == "untitled":
            continue
        mime = it.get("mimeType") or it.get("mime") or ""
        kind = KIND.get(mime, "other")
        mod = (it.get("modifiedTime") or it.get("modified")
               or it.get("modifiedDate") or it.get("modifiedAt") or "")
        try:
            dt = datetime.datetime.fromisoformat(str(mod).replace("Z", "+00:00")).astimezone(TZ)
        except Exception:
            continue
        seen.add(fid)
        if kind in URL_PATH:
            url = f"https://docs.google.com/{URL_PATH[kind]}/d/{fid}/edit"
        else:
            url = f"https://drive.google.com/file/d/{fid}/view"
        owner = "me"
        owners = it.get("owners")
        if isinstance(owners, list) and owners and isinstance(owners[0], dict):
            o = owners[0]
            if not o.get("me") and o.get("emailAddress", "").lower() != ME_EMAIL:
                owner = (o.get("displayName") or "other")[:30]
        elif isinstance(it.get("owner"), str) and it["owner"].lower() not in ("me", ME_EMAIL):
            owner = it["owner"][:30]
        files.append({
            "id": fid, "title": title[:80], "kind": kind, "url": url,
            "modified": dt.isoformat(), "modifiedLabel": rel_label(dt, now), "owner": owner,
        })

    files.sort(key=lambda f: f["modified"], reverse=True)
    files = files[:25]
    json.dump({"files": files, "generatedAt": now.isoformat(),
               "sourceOk": True, "error": None}, open(OUT, "w"), indent=2)
    print("OK")


main()
