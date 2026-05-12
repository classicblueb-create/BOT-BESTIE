"""
handlers/scheduled.py
Scheduled broadcast jobs — mirrors GAS triggers:
  sendMorningBrief, sendEveningBrief, sendPreMarketAlert,
  sendGoldDailySnapshot, sendWealthMindsetAlert,
  sendWeeklyOutlookAlert, sendEconomicCalendarAlert,
  sendGoldSignalTwiceDaily, autoCheckSniperSignal, autoScanNewHighAlert

All have isWeekend() guard — no broadcasts on Saturday/Sunday.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from telegram import Bot
from telegram.ext import ContextTypes

from services.data import (
    fetch_real_time_news, fetch_world_indices, fetch_gold_price,
    fetch_gold_price_detail, fetch_brief_price, fetch_trending_equities,
    fetch_top_movers, fetch_thai_gold_price,
)
from services.ai import (
    call_openrouter,
    build_morning_prompt, build_evening_prompt, build_pre_market_prompt,
    build_gold_snapshot_prompt, build_gold_signal_prompt,
    build_wealth_mindset_prompt, build_weekly_outlook_prompt,
    build_economic_calendar_prompt, build_sniper_prompt, build_new_high_prompt,
)

log = logging.getLogger(__name__)

# Bangkok timezone (UTC+7)
TZ_BKK = timezone(timedelta(hours=7))

SNIPER_SYMBOLS = ["NVDA", "AAPL", "TSLA", "MSFT", "META",
                  "AMZN", "GOOGL", "AMD", "COIN", "PLTR"]


def is_weekend() -> bool:
    """Return True on Saturday (5) or Sunday (6) in Bangkok time."""
    dow = datetime.now(TZ_BKK).weekday()
    return dow >= 5


def _broadcast_channel() -> str | None:
    """Read TELEGRAM_CHANNEL from env."""
    import os
    return os.getenv("TELEGRAM_CHANNEL")


async def _broadcast(ctx: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    channel = _broadcast_channel()
    if not channel:
        log.warning("TELEGRAM_CHANNEL not set — skipping broadcast")
        return
    try:
        await ctx.bot.send_message(channel, text, parse_mode="Markdown")
    except Exception as e:
        log.error("Broadcast error: %s", e)


# ── Morning Brief (08:00 BKK, Mon–Fri) ───────────────────────────────────────

async def job_morning_brief(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("📰 Morning Brief broadcast")
    news    = fetch_real_time_news(8)
    indices = fetch_world_indices()
    gold    = fetch_gold_price()
    trends  = fetch_trending_equities()
    trend_str = "\n".join(
        f"{s['symbol']}: ${s['price']:,.2f} ({s['pct']:+.2f}%)" for s in trends[:5]
    )
    prompt = build_morning_prompt(news, indices, gold, trend_str)
    ai_txt = call_openrouter(prompt)
    msg = (
        "🌅 *Morning Brief — Bestie Bot US*\n"
        f"_{datetime.now(TZ_BKK).strftime('%A, %d %B %Y — %H:%M')}_\n\n"
        f"{ai_txt}"
    )
    await _broadcast(ctx, msg)


# ── Evening Brief (21:30 BKK, Mon–Fri) ───────────────────────────────────────

async def job_evening_brief(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("🌇 Evening Brief broadcast")
    news    = fetch_real_time_news(8)
    indices = fetch_world_indices()
    gold    = fetch_gold_price()
    movers  = fetch_top_movers()
    prompt  = build_evening_prompt(news, indices, gold, movers)
    ai_txt  = call_openrouter(prompt)
    msg = (
        "🌇 *Evening Brief — Bestie Bot US*\n"
        f"_{datetime.now(TZ_BKK).strftime('%A, %d %B %Y — %H:%M')}_\n\n"
        f"{ai_txt}"
    )
    await _broadcast(ctx, msg)


# ── Pre-Market Alert (20:00 BKK, Mon–Fri) ───────────────────────────────────

async def job_pre_market(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("⚡ Pre-Market broadcast")
    news    = fetch_real_time_news(6)
    futures = (
        f"S&P 500 Futures: {fetch_brief_price('ES=F')}\n"
        f"NASDAQ Futures:  {fetch_brief_price('NQ=F')}\n"
        f"Nikkei 225:      {fetch_brief_price('^N225')}\n"
        f"Hang Seng:       {fetch_brief_price('^HSI')}"
    )
    gold   = fetch_gold_price()
    prompt = build_pre_market_prompt(news, futures, gold)
    ai_txt = call_openrouter(prompt)
    msg = (
        "⚡ *Pre-Market Alert*\n"
        f"_{datetime.now(TZ_BKK).strftime('%H:%M — %d %b %Y')}_\n\n"
        f"{ai_txt}"
    )
    await _broadcast(ctx, msg)


# ── Gold Daily Snapshot (09:00 & 16:00 BKK) ──────────────────────────────────

async def job_gold_snapshot(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("🥇 Gold Snapshot broadcast")
    detail    = fetch_gold_price_detail()
    thai_gold = fetch_thai_gold_price()
    prompt    = build_gold_snapshot_prompt(detail, thai_gold)
    ai_txt    = call_openrouter(prompt)
    price = detail.get("price", 0)
    chg   = detail.get("change", 0)
    pct   = detail.get("changePct", 0)
    sign  = "+" if chg >= 0 else ""
    msg = (
        f"🥇 *Gold Daily Snapshot*\n"
        f"XAU/USD: ${price:,.2f} ({sign}{chg:.2f} / {sign}{pct:.2f}%)\n\n"
        f"{ai_txt}"
    )
    await _broadcast(ctx, msg)


# ── Gold Signal x2 (10:00 & 22:00 BKK) ──────────────────────────────────────

async def job_gold_signal(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("🎯 Gold Signal broadcast")
    detail = fetch_gold_price_detail()
    prompt = build_gold_signal_prompt(detail)
    ai_txt = call_openrouter(prompt)
    price  = detail.get("price", 0)
    chg    = detail.get("change", 0)
    pct    = detail.get("changePct", 0)
    msg = (
        f"🎯 *Gold Signal*\n"
        f"XAU/USD: ${price:,.2f} ({chg:+.2f} / {pct:+.2f}%)\n\n"
        f"{ai_txt}"
    )
    await _broadcast(ctx, msg)


# ── Wealth Mindset (07:00 BKK daily) ─────────────────────────────────────────

async def job_wealth_mindset(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("💡 Wealth Mindset broadcast")
    ai_txt = call_openrouter(build_wealth_mindset_prompt())
    await _broadcast(ctx, f"💡 *Wealth Mindset*\n\n{ai_txt}")


# ── Weekly Outlook (Mon 07:30 BKK) ───────────────────────────────────────────

async def job_weekly_outlook(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    # Only Monday
    if datetime.now(TZ_BKK).weekday() != 0:
        return
    log.info("📅 Weekly Outlook broadcast")
    news    = fetch_real_time_news(8)
    indices = fetch_world_indices()
    prompt  = build_weekly_outlook_prompt(news, indices)
    ai_txt  = call_openrouter(prompt)
    await _broadcast(ctx, f"📅 *Weekly Outlook US*\n\n{ai_txt}")


# ── Economic Calendar (Mon 08:30 BKK) ────────────────────────────────────────

async def job_economic_calendar(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if datetime.now(TZ_BKK).weekday() != 0:
        return
    log.info("📆 Economic Calendar broadcast")
    news   = fetch_real_time_news(6)
    prompt = build_economic_calendar_prompt(news)
    ai_txt = call_openrouter(prompt)
    await _broadcast(ctx, f"📆 *Economic Calendar Week*\n\n{ai_txt}")


# ── Sniper Signal Auto-check (every 2 h weekdays) ────────────────────────────

async def job_sniper_auto(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("🎯 Auto Sniper check")
    for symbol in SNIPER_SYMBOLS[:5]:
        try:
            price_str = fetch_brief_price(symbol)
            if price_str == "N/A":
                continue
            prompt = build_sniper_prompt(symbol, price_str)
            ai_txt = call_openrouter(prompt)
            # only broadcast if AI mentions "buy" / "strong"
            if any(kw in ai_txt.lower() for kw in ["ซื้อ", "buy", "breakout", "strong"]):
                msg = (f"🎯 *Auto Sniper: {symbol}*\n💲 {price_str}\n\n{ai_txt}")
                await _broadcast(ctx, msg)
        except Exception as e:
            log.error("Sniper auto error %s: %s", symbol, e)


# ── New High Scanner (every 3 h weekdays) ────────────────────────────────────

async def job_new_high(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if is_weekend():
        return
    log.info("📈 New High scan")
    trends = fetch_trending_equities()
    for stock in trends[:5]:
        try:
            sym = stock["symbol"]
            pct = stock["pct"]
            if pct >= 3.0:  # > 3 % ถือว่า momentum แรง
                price_str = f"${stock['price']:,.2f} ({pct:+.2f}%)"
                prompt    = build_new_high_prompt(sym, price_str)
                ai_txt    = call_openrouter(prompt)
                msg = (f"📈 *New High Alert: {sym}*\n💲 {price_str}\n\n{ai_txt}")
                await _broadcast(ctx, msg)
        except Exception as e:
            log.error("New High error: %s", e)
