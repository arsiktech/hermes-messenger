"""Hermes Messenger — live view of a profile's Bot Chat inbox, with two actions.

The Bot Chat inbox (``<home>/runtime/bot_live_delivery/*.json``) holds
deliveries for a profile's Bot Chat: cron reports and teammate messages. The
bot takes them one at a time, only when its chat is idle, so they can wait.

GET /inbox lists what is still waiting. Two user actions take a WAITING
(``queued``) delivery out of the line, through the delivery module's own lock
and terminal-receipt API so at-most-once still holds:

* POST /inbox/{id}/take — the user handles it now in a side chat; the full
  message is returned so Desktop can open that chat with it.
* POST /inbox/{id}/skip — the user drops it unhandled.

Both end the delivery as ``cancelled`` with a plain reason, so whoever sent it
(a cron job, another bot) gets a definite answer instead of waiting forever.
A delivery the bot has already claimed is never touched. The record itself,
message included, is kept as the permanent receipt.
"""
from __future__ import annotations

import json
import re
import statistics
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()

_REASONS = {
    "take": "The user took this message out of the Bot Chat queue to handle it in a separate chat. "
            "It was not answered in Bot Chat; do not resend.",
    "skip": "The user skipped this message in the Bot Chat queue; it was not handled. Do not resend.",
}

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


def _stuck_check(home: Path):
    """Return a function telling whether a WAITING record can never be taken.

    The bot only claims records pinned to its CURRENT chat lease/live session
    (``bot_live_delivery._matches``). A record queued for an earlier lease —
    e.g. before an app restart — is skipped forever. When the current owner is
    unknown (bot offline), nothing is called stuck.
    """
    try:
        from tools import bot_live_delivery as bld
        owner = bld.find_canonical_live_owner(home)
        if not owner:
            return lambda rec: False
        current = bld._owner(home, owner)
    except Exception:
        return lambda rec: False

    def stuck(rec: dict[str, Any]) -> bool:
        try:
            return not bld._matches(home, rec, current)
        except Exception:
            return False
    return stuck


@router.get("/inbox")
def inbox() -> dict[str, Any]:
    home = _home()
    is_stuck = _stuck_check(home)
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
                "id": str(rec.get("delivery_id") or path.stem),
                "sequence": rec.get("sequence") or 0,
                "status": status,
                "session_id": rec.get("session_id") or "",
                "created_at": created / 1e9 if created else None,
                "claimed_at": claimed / 1e9 if claimed else None,
                "kind": info["kind"],
                "from": info["from"],
                "handle": info.get("handle", ""),
                "preview": _preview(info["body"]),
                # Only the currently handled message is mirrored in full.
                **({"message": str(rec.get("message") or ""), "body": info["body"]}
                   if status == "claimed" else {}),
                "stuck": status == "queued" and isinstance(rec.get("owner"), dict) and is_stuck(rec),
            })
    # Handled one first, then waiting ones in the order the bot will take them.
    pending.sort(key=lambda r: (r["status"] != "claimed", r["sequence"] or 0))
    return {
        "bot_chat_session_id": _bot_chat_session(home),
        "items": pending,
        "median_wait_min_24h": round(statistics.median(waits), 1) if waits else None,
        "handled_24h": len(waits),
        "now": now / 1e9,
        "actions": True,
    }


def _withdraw(delivery_id: str, action: str) -> dict[str, Any]:
    """Take one WAITING delivery out of the line and close it as ``cancelled``.

    The delivery module only lets a claimed record reach a terminal state, so
    this claims it under the module's own lock (exactly like the bot would),
    then files the terminal receipt through ``complete_delivery``. Holding the
    lock for the claim means the bot can never take the same record: it only
    ever claims ``queued`` ones.
    """
    try:
        from tools import bot_live_delivery as bld
    except ImportError as exc:  # pragma: no cover - older Hermes without the mailbox
        raise HTTPException(501, "This Hermes version has no Bot Chat inbox.") from exc
    try:
        key = bld._delivery_id(delivery_id)
    except ValueError as exc:
        raise HTTPException(400, "Unknown message id.") from exc
    home = _home()
    with bld._locked(home) as root:
        path = root / f"{key}.json"
        record = bld._read(path)
        if record is None:
            raise HTTPException(404, "That message is no longer in the inbox.")
        if record.get("status") != "queued":
            # Claimed = the bot is already on it; terminal = someone got there first.
            raise HTTPException(409, "The bot has already started on this message, or it is gone.")
        record.update(status="claimed", claimed_at=time.time_ns(), withdrawn_by="hermes-messenger")
        bld._write(path, record)
    done = bld.complete_delivery(home, key, status="cancelled", error=_REASONS[action], reason="cancelled")
    info = _describe(str(done.get("message") or ""))
    return {
        "ok": True,
        "action": action,
        "id": key,
        "kind": info["kind"],
        "from": info["from"],
        "message": str(done.get("message") or ""),
    }


@router.post("/inbox/{delivery_id}/take")
def take(delivery_id: str) -> dict[str, Any]:
    return _withdraw(delivery_id, "take")


@router.post("/inbox/{delivery_id}/skip")
def skip(delivery_id: str) -> dict[str, Any]:
    out = _withdraw(delivery_id, "skip")
    out.pop("message", None)
    return out
