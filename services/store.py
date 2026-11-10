"""
Supabase store for the Telegram bot (shared tables with the LINE bot, channel = 'telegram').

Set SUPABASE_URL and SUPABASE_SERVICE_KEY (service_role key) in the environment.
Without them the bot falls back to the local watchlist.json file, which Render
wipes on every deploy.

Schema: supabase/schema.sql
"""
from __future__ import annotations

import json
import logging
import os
from urllib.parse import quote

import requests

log = logging.getLogger(__name__)

CHANNEL = "telegram"
WATCHLIST_FILE = "watchlist.json"


def _cfg() -> tuple[str, str] | None:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return (url, key) if url and key else None


def enabled() -> bool:
    return _cfg() is not None


def _req(method: str, path: str, body=None, prefer: str | None = None):
    url, key = _cfg()  # type: ignore[misc]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    r = requests.request(method, f"{url}/rest/v1/{path}", headers=headers,
                         data=json.dumps(body) if body is not None else None, timeout=10)
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


def _eq(v) -> str:
    return "eq." + quote(str(v), safe="")


# ── file fallback ──────────────────────────────────────────────────────────────

def _load_file() -> dict[str, list[str]]:
    if os.path.exists(WATCHLIST_FILE):
        try:
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.error("Error loading watchlist file: %s", e)
    return {}


def _save_file(data: dict[str, list[str]]) -> None:
    try:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.error("Error saving watchlist file: %s", e)


# ── watchlists ─────────────────────────────────────────────────────────────────

def load_watchlists() -> dict[str, list[str]]:
    """{chat_id: [symbols]} for every Telegram user."""
    if enabled():
        try:
            rows = _req("get", f"watchlists?select=user_id,symbol&channel={_eq(CHANNEL)}&order=created_at.asc")
            out: dict[str, list[str]] = {}
            for r in rows:
                out.setdefault(r["user_id"], []).append(r["symbol"])
            return out
        except Exception as e:
            log.error("Supabase load_watchlists failed, using file: %s", e)
    return _load_file()


def save_watchlists(data: dict[str, list[str]]) -> None:
    """Writes the difference against what is stored (insert new, delete removed)."""
    if enabled():
        try:
            current = load_watchlists()
            add, delete = [], []
            for uid in set(current) | set(data):
                new = {s.upper() for s in data.get(uid, [])}
                old = set(current.get(uid, []))
                add += [{"channel": CHANNEL, "user_id": uid, "symbol": s} for s in sorted(new - old)]
                delete += [(uid, s) for s in sorted(old - new)]
            if add:
                _req("post", "watchlists?on_conflict=channel,user_id,symbol", add,
                     "resolution=ignore-duplicates,return=minimal")
            for uid, s in delete:
                _req("delete", f"watchlists?channel={_eq(CHANNEL)}&user_id={_eq(uid)}&symbol={_eq(s)}",
                     prefer="return=minimal")
            return
        except Exception as e:
            log.error("Supabase save_watchlists failed, using file: %s", e)
    _save_file(data)


def migrate_file_to_supabase() -> int:
    """One-off: push an existing watchlist.json into Supabase. Returns rows sent."""
    data = _load_file()
    rows = [{"channel": CHANNEL, "user_id": uid, "symbol": s.upper()} for uid, syms in data.items() for s in syms]
    if rows and enabled():
        _req("post", "watchlists?on_conflict=channel,user_id,symbol", rows,
             "resolution=ignore-duplicates,return=minimal")
    return len(rows)


# ── price alerts (same table the LINE bot uses) ───────────────────────────────

def add_alert(user_id: str, symbol: str, kind: str, level: float | None, note: str | None = None):
    row = {"channel": CHANNEL, "user_id": str(user_id), "symbol": symbol.upper(), "kind": kind,
           "level": level, "note": note}
    out = _req("post", "price_alerts", row, "return=representation")
    return out[0] if out else None


def list_alerts(user_id: str | None = None) -> list[dict]:
    q = f"price_alerts?select=*&channel={_eq(CHANNEL)}&active=is.true&order=id.asc"
    if user_id is not None:
        q += f"&user_id={_eq(user_id)}"
    return _req("get", q) or []


def fire_alert(alert_id: int, price: float | None) -> None:
    from datetime import datetime, timezone
    _req("patch", f"price_alerts?id={_eq(alert_id)}",
         {"active": False, "fired_at": datetime.now(timezone.utc).isoformat(), "fired_price": price},
         "return=minimal")


def cancel_alerts(user_id: str, alert_id: int | None = None) -> int:
    q = f"price_alerts?channel={_eq(CHANNEL)}&user_id={_eq(user_id)}&active=is.true"
    if alert_id is not None:
        q += f"&id={_eq(alert_id)}"
    return len(_req("patch", q, {"active": False}, "return=representation") or [])
