"""
telegram_bot.py — Bestie Bot US  (Telegram)
Entry point: reads .env, registers handlers, schedules jobs, starts polling.

Architecture:
  services/data.py      — market data (Yahoo Finance, Thai gold, RSS news)
  services/ai.py        — OpenRouter AI calls + prompt builders
  handlers/commands.py  — all command / callback handlers
  handlers/scheduled.py — scheduled broadcast jobs (mirrors GAS triggers)

Environment variables (put in .env):
  TELEGRAM_BOT_TOKEN    — from @BotFather
  TELEGRAM_CHANNEL      — channel/group ID to broadcast to (e.g. -100123456789)
  OPENROUTER_API_KEY    — from openrouter.ai

Schedule (Bangkok time UTC+7, weekdays only):
  07:00  Wealth Mindset
  07:30  Weekly Outlook (Monday only)
  08:00  Morning Brief
  08:30  Economic Calendar (Monday only)
  09:00  Gold Snapshot
  10:00  Gold Signal #1
  16:00  Gold Snapshot #2
  20:00  Pre-Market Alert
  21:30  Evening Brief
  22:00  Gold Signal #2
  Every 2 h  Sniper Auto-check
  Every 3 h  New High Scanner
"""
from __future__ import annotations

import logging
import os
from datetime import time, timezone, timedelta

from dotenv import load_dotenv
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
)

from handlers.commands import (
    cmd_start, cmd_help, cmd_news, cmd_market,
    cmd_gold, cmd_thaigold, cmd_trending, cmd_actives,
    cmd_sector, cmd_etf, cmd_crypto, cmd_sniper,
    cmd_retire, cmd_mindset, cmd_weekly, cmd_swing,
    callback_handler, handle_text,
)
from handlers.scheduled import (
    job_morning_brief, job_evening_brief, job_pre_market,
    job_gold_snapshot, job_gold_signal, job_wealth_mindset,
    job_weekly_outlook, job_economic_calendar,
    job_sniper_auto, job_new_high, job_sentiment_scanner,
    job_auto_swing_broadcast,
)

# ── Bootstrap ──────────────────────────────────────────────────────────────────

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

TZ_BKK = timezone(timedelta(hours=7))


def _bkk(h: int, m: int = 0) -> time:
    return time(h, m, tzinfo=TZ_BKK)


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set in .env")

    app = Application.builder().token(token).build()

    # ── Command handlers ──────────────────────────────────────────────────────
    app.add_handler(CommandHandler("start",    cmd_start))
    app.add_handler(CommandHandler("help",     cmd_help))
    app.add_handler(CommandHandler("news",     cmd_news))
    app.add_handler(CommandHandler("market",   cmd_market))
    app.add_handler(CommandHandler("gold",     cmd_gold))
    app.add_handler(CommandHandler("thaigold", cmd_thaigold))
    app.add_handler(CommandHandler("trending", cmd_trending))
    app.add_handler(CommandHandler("actives",  cmd_actives))
    app.add_handler(CommandHandler("sector",   cmd_sector))
    app.add_handler(CommandHandler("etf",      cmd_etf))
    app.add_handler(CommandHandler("crypto",   cmd_crypto))
    app.add_handler(CommandHandler("sniper",   cmd_sniper))
    app.add_handler(CommandHandler("swing",    cmd_swing))
    app.add_handler(CommandHandler("retire",   cmd_retire))
    app.add_handler(CommandHandler("mindset",  cmd_mindset))
    app.add_handler(CommandHandler("weekly",   cmd_weekly))

    # ── Text handler (General Chat) ───────────────────────────────────────────
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    # ── Callback buttons ──────────────────────────────────────────────────────
    app.add_handler(CallbackQueryHandler(callback_handler))

    # ── Scheduled jobs ────────────────────────────────────────────────────────
    jq = app.job_queue

    jq.run_daily(job_wealth_mindset,   _bkk(7,  0),  name="wealth_mindset")
    jq.run_daily(job_weekly_outlook,   _bkk(7, 30),  name="weekly_outlook")
    jq.run_daily(job_morning_brief,    _bkk(8,  0),  name="morning_brief")
    jq.run_daily(job_economic_calendar,_bkk(8, 30),  name="economic_calendar")
    jq.run_daily(job_gold_snapshot,    _bkk(9,  0),  name="gold_snapshot_am")
    jq.run_daily(job_gold_signal,      _bkk(10, 0),  name="gold_signal_am")
    jq.run_daily(job_auto_swing_broadcast, _bkk(15, 0), name="auto_swing_pm")
    jq.run_daily(job_gold_snapshot,    _bkk(16, 0),  name="gold_snapshot_pm")
    jq.run_daily(job_pre_market,       _bkk(20, 0),  name="pre_market")
    jq.run_daily(job_evening_brief,    _bkk(21, 30), name="evening_brief")
    jq.run_daily(job_gold_signal,      _bkk(22, 0),  name="gold_signal_pm")

    # Repeating jobs (every N seconds)
    jq.run_repeating(job_sentiment_scanner, interval=1800, first=60, name="sentiment_scanner") # 30 mins
    jq.run_repeating(job_sniper_auto, interval=7200,  first=300,  name="sniper_auto")
    jq.run_repeating(job_new_high,    interval=10800, first=600,  name="new_high")

    log.info("🚀 Bestie Bot US — Telegram started (polling)")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
