"""Hermes Messenger — read-only view of a profile's Bot Chat inbox.

The Bot Chat inbox (``<home>/runtime/bot_live_delivery/*.json``) holds
deliveries for a profile's Bot Chat: cron reports and teammate messages. The
bot takes them one at a time, only when its chat is idle, so they can wait.
This endpoint lists what is still waiting so Desktop can show it live.

Strictly read-only: it never claims, reorders, cancels or rewrites a record.
Delivery is at-most-once by design; touching records here could break that.
"""
from __future__ import annotations

import json
import re
import statistics
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter()

_DIR = Path("runtime") / "bot_live_delivery"
_CRON = re.compile(r'^\s*\[Cronjob "([^"]*)" output — [^\]]*\]\s*')
_AGENT = re.compile(r"^\s*Message from\s+(.+?)\s*(?:\(@([a-z0-9_-]+)\))?\s*:\s*", re.I)
_KANBAN = re.compile(r"^\s*(\S{1,3})\s+\[([^\]]+)\]\s+(?:@\S+\s+)?Kanban\s+(t_[0-9a-f]+)\s*[—:]?\s*")
_MAX_FILES = 2000
_PREVIEW = 180


def _home() -> Path:
    from hermes_constants import get_hermes_home

    return Path(get_hermes_home())


def _describe(message: str) -> dict[str, str]:
    text = message or ""
    if m := _CRON.match(text):
        return {"kind": "cron", "from": m.group(1), "body": text[m.end():]}
    if m := _AGENT.match(text):
        name = re.sub(r"^\W+", "", m.group(1)).strip() or m.group(1)
        return {"kind": "agent", "from": name, "handle": m.group(2) or "", "body": text[m.end():]}
    if m := _KANBAN.match(text):
        return {"kind": "kanban", "from": f"{m.group(2)} · {m.group(3)}", "body": text[m.end():]}
    return {"kind": "other", "from": "", "body": text}


def _preview(body: str) -> str:
    text = re.sub(r"```[a-z]*\n?", " ", body)                       # code fences + language tag
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)             # [text](url) -> text
    text = re.sub(r"(\*\*|__|\*|`)", "", text)                         # emphasis / code marks
    text = re.sub(r"(?m)^\s*(?:[-*•]|\d+\.)\s+", "", text)             # list bullets
    flat = re.sub(r"\s+", " ", text).strip()
    if len(flat) <= _PREVIEW:
        return flat
    cut = flat[:_PREVIEW].rsplit(" ", 1)[0].rstrip(" -–—,;:")
    return cut + "…"


def _bot_chat_session(home: Path) -> str | None:
    try:
        from hermes_state import SessionDB

        db = SessionDB(db_path=home / "state.db", read_only=True)
        try:
            row = db.get_session_by_title("Bot Chat")
            return db.get_compression_tip(row["id"]) if row else None
        finally:
            db.close()
    except Exception:
        return None


@router.get("/inbox")
def inbox() -> dict[str, Any]:
    home = _home()
    root = home / _DIR
    now = time.time_ns()
    pending: list[dict[str, Any]] = []
    waits: list[float] = []
    if root.is_dir():
        files = sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:_MAX_FILES]
        for path in files:
            try:
                rec = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            status = rec.get("status")
            created = int(rec.get("created_at") or 0)
            claimed = int(rec.get("claimed_at") or 0)
            if claimed and created and now - created < 86_400 * 10**9:
                waits.append((claimed - created) / 6e10)
            if status not in ("queued", "claimed"):
                continue
            info = _describe(str(rec.get("message") or ""))
            pending.append({
                "id": str(rec.get("delivery_id") or path.stem)[:16],
                "sequence": rec.get("sequence") or 0,
                "status": status,
                "session_id": rec.get("session_id") or "",
                "created_at": created / 1e9 if created else None,
                "claimed_at": claimed / 1e9 if claimed else None,
                "kind": info["kind"],
                "from": info["from"],
                "handle": info.get("handle", ""),
                "preview": _preview(info["body"]),
            })
    # Handled one first, then waiting ones in the order the bot will take them.
    pending.sort(key=lambda r: (r["status"] != "claimed", r["sequence"] or 0))
    return {
        "bot_chat_session_id": _bot_chat_session(home),
        "items": pending,
        "median_wait_min_24h": round(statistics.median(waits), 1) if waits else None,
        "handled_24h": len(waits),
        "now": now / 1e9,
    }
