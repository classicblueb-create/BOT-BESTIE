"""
handlers/commands.py
All Telegram command/callback handlers for Bestie Bot US
"""
from __future__ import annotations

import os
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from services.data import (
    fetch_brief_price, fetch_gold_price, fetch_gold_price_detail,
    fetch_thai_gold_price, fetch_world_indices, fetch_trending_equities,
    fetch_most_actives, fetch_top_movers, fetch_real_time_news,
)
from services.ai import (
    call_openrouter,
    build_gold_snapshot_prompt, build_gold_signal_prompt,
    build_sniper_prompt, build_sector_prompt, build_etf_prompt,
    build_retirement_prompt, build_crypto_prompt,
    build_new_high_prompt, build_swing_trade_prompt,
)

log = logging.getLogger(__name__)

# ── Sector definitions ─────────────────────────────────────────────────────────

SECTORS: dict[str, list[str]] = {
    "🤖 Tech & AI":       ["NVDA", "MSFT", "GOOGL", "META", "AMD"],
    "💊 Healthcare":      ["JNJ", "UNH", "PFE", "ABBV", "MRK"],
    "🏦 Finance":         ["JPM", "BAC", "GS", "MS", "WFC"],
    "⚡ Energy":          ["XOM", "CVX", "SLB", "EOG", "MPC"],
    "🛒 Consumer":        ["AMZN", "COST", "WMT", "HD", "MCD"],
    "🏭 Industrial":      ["CAT", "DE", "GE", "HON", "UPS"],
    "📡 Communication":   ["T", "VZ", "CMCSA", "DIS", "NFLX"],
    "🏠 Real Estate":     ["AMT", "PLD", "EQIX", "O", "SPG"],
    "🔋 Clean Energy":    ["NEE", "ENPH", "SEDG", "BEP", "FSLR"],
    "💎 Luxury & Brands": ["LVMH", "NKE", "LULU", "TIF", "RH"],
}

ETFS: dict[str, str] = {
    "SPY":  "S&P 500 ETF",
    "QQQ":  "NASDAQ-100 ETF",
    "DIA":  "Dow Jones ETF",
    "GLD":  "Gold ETF",
    "TLT":  "20+ Year Treasury ETF",
    "ARKK": "ARK Innovation ETF",
    "VTI":  "Total Market ETF",
    "SOXX": "Semiconductor ETF",
    "XLE":  "Energy Select ETF",
    "IEMG": "Emerging Markets ETF",
}

CRYPTO_SYMBOLS: dict[str, str] = {
    "BTC-USD": "Bitcoin",
    "ETH-USD": "Ethereum",
    "BNB-USD": "BNB",
    "SOL-USD": "Solana",
    "XRP-USD": "XRP",
}


# ── Utility ────────────────────────────────────────────────────────────────────

async def send(update: Update, text: str, reply_markup=None) -> None:
    """Send (or reply) with automatic MarkdownV2 escape fallback."""
    # use reply if inside a message, else send to chat
    target = update.effective_chat
    if not target:
        return
    try:
        await target.send_message(text, reply_markup=reply_markup,
                                   parse_mode="Markdown")
    except Exception:
        await target.send_message(text, reply_markup=reply_markup)


# ── /start ─────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    kb = [
        [
            InlineKeyboardButton("📰 ข่าวล่าสุด",        callback_data="news"),
            InlineKeyboardButton("📊 ราคาตลาด",           callback_data="market"),
        ],
        [
            InlineKeyboardButton("🥇 Gold",               callback_data="gold"),
            InlineKeyboardButton("📈 Trending",            callback_data="trending"),
        ],
        [
            InlineKeyboardButton("🔥 Most Active",         callback_data="actives"),
            InlineKeyboardButton("🎯 Sector",              callback_data="sector_menu"),
        ],
        [
            InlineKeyboardButton("💰 ETF",                 callback_data="etf_menu"),
            InlineKeyboardButton("₿ Crypto",              callback_data="crypto_menu"),
        ],
        [
            InlineKeyboardButton("🎯 Sniper Signal",       callback_data="sniper_menu"),
            InlineKeyboardButton("🏖 Retirement Plan",     callback_data="retire_start"),
        ],
        [
            InlineKeyboardButton("💡 Wealth Mindset",      callback_data="mindset"),
            InlineKeyboardButton("📅 Weekly Outlook",      callback_data="weekly"),
        ],
        [
            InlineKeyboardButton("🌏 Thai Gold",           callback_data="thaigold"),
            InlineKeyboardButton("ℹ️ Help",                callback_data="help"),
        ],
    ]
    await send(update,
               "*🤖 Bestie Bot US v3.24*\nเพื่อนนักลงทุน US ของคุณ 🚀\n\nเลือกเมนู:",
               InlineKeyboardMarkup(kb))


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    txt = (
        "*📖 คำสั่งทั้งหมด*\n\n"
        "/start — เมนูหลัก\n"
        "/news — ข่าวการเงิน US ล่าสุด\n"
        "/market — ดัชนีตลาดหลัก\n"
        "/gold — ราคาทองคำ + วิเคราะห์ AI\n"
        "/thaigold — ราคาทองไทย\n"
        "/trending — หุ้น Trending US\n"
        "/actives — Most Active by Volume\n"
        "/sector — วิเคราะห์ตาม Sector\n"
        "/etf — ETF แนะนำ\n"
        "/crypto — วิเคราะห์ Crypto\n"
        "/sniper `SYMBOL` — Sniper Signal\n"
        "/swing `SYMBOL` — แผนเทรดสั้น 3-5 วัน\n"
        "/retire — แผนเกษียณ\n"
        "/mindset — Wealth Mindset Quote\n"
        "/weekly — Weekly Outlook\n"
    )
    await send(update, txt)


# ── /news ──────────────────────────────────────────────────────────────────────

async def cmd_news(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ กำลังดึงข่าว...")
    news = fetch_real_time_news(10)
    await send(update, f"📰 *ข่าวการเงิน US ล่าสุด*\n\n{news}")


# ── /market ────────────────────────────────────────────────────────────────────

async def cmd_market(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ กำลังดึงข้อมูลตลาด...")
    indices = fetch_world_indices()
    gold    = fetch_gold_price()
    btc     = fetch_brief_price("BTC-USD")
    oil     = fetch_brief_price("CL=F")
    txt = (
        f"📊 *ภาพรวมตลาด US*\n\n"
        f"{indices}\n\n"
        f"🥇 Gold: {gold}\n"
        f"₿ BTC: {btc}\n"
        f"🛢 Oil (WTI): {oil}"
    )
    await send(update, txt)


# ── /gold ──────────────────────────────────────────────────────────────────────

async def cmd_gold(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ วิเคราะห์ทองคำ...")
    detail    = fetch_gold_price_detail()
    thai_gold = fetch_thai_gold_price()
    prompt    = build_gold_snapshot_prompt(detail, thai_gold)
    ai_txt    = call_openrouter(prompt)
    price     = detail.get("price", 0)
    chg       = detail.get("change", 0)
    pct       = detail.get("changePct", 0)
    sign      = "+" if chg >= 0 else ""
    header    = f"🥇 *Gold XAU/USD*: ${price:,.2f} ({sign}{chg:.2f} / {sign}{pct:.2f}%)\n\n"
    await send(update, header + ai_txt)


# ── /thaigold ──────────────────────────────────────────────────────────────────

async def cmd_thaigold(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ กำลังดึงราคาทองไทย...")
    rows = fetch_thai_gold_price()
    if not rows:
        await send(update, "⚠️ ไม่สามารถดึงราคาทองไทยได้")
        return
    lines = [f"🌏 *ราคาทองไทย*\n"]
    for r in rows[:6]:
        diff_icon = "🔺" if r["diff"] > 0 else ("🔻" if r["diff"] < 0 else "⬛")
        lines.append(f"{diff_icon} *{r['name']}*: ซื้อ {r['bid']} / ขาย {r['ask']}")
    await send(update, "\n".join(lines))


# ── /trending ──────────────────────────────────────────────────────────────────

async def cmd_trending(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ ดึง Trending stocks...")
    stocks = fetch_trending_equities()
    if not stocks:
        await send(update, "⚠️ ไม่สามารถดึงข้อมูลได้")
        return
    lines = ["📈 *หุ้น Trending US วันนี้*\n"]
    for i, s in enumerate(stocks):
        icon = "🔺" if s["pct"] >= 0 else "🔻"
        lines.append(f"{i+1}. {icon} *{s['symbol']}* {s['name'][:18]}: "
                     f"${s['price']:,.2f} ({s['pct']:+.2f}%)")
    await send(update, "\n".join(lines))


# ── /actives ───────────────────────────────────────────────────────────────────

async def cmd_actives(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ ดึง Most Active...")
    stocks = fetch_most_actives()
    if not stocks:
        await send(update, "⚠️ ไม่สามารถดึงข้อมูลได้")
        return
    lines = ["🔥 *Most Active by Volume*\n"]
    for i, s in enumerate(stocks):
        icon = "🔺" if s["pct"] >= 0 else "🔻"
        lines.append(f"{i+1}. {icon} *{s['symbol']}*: ${s['price']:,.2f} "
                     f"({s['pct']:+.2f}%) Vol {s['vol']}")
    await send(update, "\n".join(lines))


# ── /sector ─────────────────────────────────────────────────────────────────────

async def cmd_sector(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    kb = [
        [InlineKeyboardButton(name, callback_data=f"sec_{name}")]
        for name in SECTORS
    ]
    kb.append([InlineKeyboardButton("🔙 กลับ", callback_data="start")])
    await send(update, "🎯 *เลือก Sector ที่สนใจ:*", InlineKeyboardMarkup(kb))


# ── /etf ───────────────────────────────────────────────────────────────────────

async def cmd_etf(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    kb = [
        [InlineKeyboardButton(f"{sym} — {name}", callback_data=f"etf_{sym}")]
        for sym, name in ETFS.items()
    ]
    kb.append([InlineKeyboardButton("🔙 กลับ", callback_data="start")])
    await send(update, "💰 *เลือก ETF ที่สนใจ:*", InlineKeyboardMarkup(kb))


# ── /crypto ────────────────────────────────────────────────────────────────────

async def cmd_crypto(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    kb = [
        [InlineKeyboardButton(f"{name} ({sym})", callback_data=f"cry_{sym}")]
        for sym, name in CRYPTO_SYMBOLS.items()
    ]
    kb.append([InlineKeyboardButton("🔙 กลับ", callback_data="start")])
    await send(update, "₿ *เลือก Crypto ที่สนใจ:*", InlineKeyboardMarkup(kb))


# ── /sniper ────────────────────────────────────────────────────────────────────

SNIPER_WATCHLIST = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN",
                    "META", "GOOGL", "AMD", "COIN", "PLTR"]

async def cmd_sniper(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    args = ctx.args
    if args:
        symbol = args[0].upper()
        await _do_sniper(update, symbol)
        return
    kb = [
        [InlineKeyboardButton(sym, callback_data=f"snp_{sym}")]
        for sym in SNIPER_WATCHLIST
    ]
    kb.append([InlineKeyboardButton("🔙 กลับ", callback_data="start")])
    await send(update, "🎯 *Sniper Signal — เลือกหุ้น:*", InlineKeyboardMarkup(kb))


async def _do_sniper(update: Update, symbol: str) -> None:
    await send(update, f"⏳ วิเคราะห์ Sniper Signal: *{symbol}*...")
    price_str = fetch_brief_price(symbol)
    prompt    = build_sniper_prompt(symbol, price_str)
    ai_txt    = call_openrouter(prompt)
    await send(update, f"🎯 *Sniper Signal: {symbol}*\n💲 ราคา: {price_str}\n\n{ai_txt}")


# ── /swing ─────────────────────────────────────────────────────────────────────

async def cmd_swing(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if not ctx.args:
        await send(update, "⚠️ กรุณาระบุชื่อหุ้น เช่น `/swing TSLA` หรือ `/swing PLUG`")
        return
    
    symbol = ctx.args[0].upper()
    await send(update, f"⏳ วางแผน Swing Trade 3-5 วัน: *{symbol}*...")
    price_str = fetch_brief_price(symbol)
    if price_str == "N/A":
        await send(update, f"⚠️ ไม่พบข้อมูลราคาของหุ้น {symbol}")
        return
        
    prompt = build_swing_trade_prompt(symbol, price_str)
    ai_txt = call_openrouter(prompt)
    await send(update, f"⚡ *Swing Trade Plan: {symbol}*\n💲 ราคาล่าสุด: {price_str}\n\n{ai_txt}")


# ── /retire ────────────────────────────────────────────────────────────────────

async def cmd_retire(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    txt = (
        "🏖 *แผนเกษียณ Bestie*\n\n"
        "พิมพ์ข้อมูลในรูปแบบ:\n"
        "`/retire อายุ เป้าหมาย(ล้าน) ทุนปัจจุบัน(ล้าน) ลงทุน/เดือน(บาท) ปีที่จะเกษียณ`\n\n"
        "ตัวอย่าง:\n`/retire 35 20 2 15000 30`\n"
        "_(อายุ 35, เป้า 20 ล้าน, ทุน 2 ล้าน, ลงทุน 15,000/เดือน, เกษียณใน 30 ปี)_"
    )
    if ctx.args and len(ctx.args) >= 5:
        try:
            age          = int(ctx.args[0])
            goal_m       = float(ctx.args[1])
            current_m    = float(ctx.args[2])
            monthly      = float(ctx.args[3])
            years        = int(ctx.args[4])
            await send(update, "⏳ คำนวณแผนเกษียณ...")
            prompt = build_retirement_prompt(age, goal_m, current_m, monthly, years)
            ai_txt = call_openrouter(prompt)
            await send(update, f"🏖 *แผนเกษียณของคุณ*\n\n{ai_txt}")
            return
        except (ValueError, IndexError):
            pass
    await send(update, txt)


# ── /mindset ───────────────────────────────────────────────────────────────────

async def cmd_mindset(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ กำลังสร้าง Wealth Mindset...")
    from services.ai import build_wealth_mindset_prompt
    ai_txt = call_openrouter(build_wealth_mindset_prompt())
    await send(update, f"💡 *Wealth Mindset*\n\n{ai_txt}")


# ── /weekly ────────────────────────────────────────────────────────────────────

async def cmd_weekly(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "⏳ กำลังวิเคราะห์ Weekly Outlook...")
    from services.ai import build_weekly_outlook_prompt
    news    = fetch_real_time_news(8)
    indices = fetch_world_indices()
    prompt  = build_weekly_outlook_prompt(news, indices)
    ai_txt  = call_openrouter(prompt)
    await send(update, f"📅 *Weekly Outlook US*\n\n{ai_txt}")


# ── Callback query router ──────────────────────────────────────────────────────

async def callback_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    data  = query.data or ""

    if data == "start":
        await cmd_start(update, ctx)
    elif data == "news":
        await cmd_news(update, ctx)
    elif data == "market":
        await cmd_market(update, ctx)
    elif data == "gold":
        await cmd_gold(update, ctx)
    elif data == "thaigold":
        await cmd_thaigold(update, ctx)
    elif data == "trending":
        await cmd_trending(update, ctx)
    elif data == "actives":
        await cmd_actives(update, ctx)
    elif data == "sector_menu":
        await cmd_sector(update, ctx)
    elif data == "etf_menu":
        await cmd_etf(update, ctx)
    elif data == "crypto_menu":
        await cmd_crypto(update, ctx)
    elif data == "sniper_menu":
        await cmd_sniper(update, ctx)
    elif data == "retire_start":
        await cmd_retire(update, ctx)
    elif data == "mindset":
        await cmd_mindset(update, ctx)
    elif data == "weekly":
        await cmd_weekly(update, ctx)
    elif data == "help":
        await cmd_help(update, ctx)

    # Sector detail
    elif data.startswith("sec_"):
        sector_name = data[4:]
        symbols = SECTORS.get(sector_name, [])
        await send(update, f"⏳ วิเคราะห์ {sector_name}...")
        price_info = []
        for sym in symbols[:5]:
            price_info.append(f"{sym}: {fetch_brief_price(sym)}")
        prompt = build_sector_prompt(sector_name, ", ".join(symbols))
        ai_txt = call_openrouter(prompt)
        prices = "\n".join(price_info)
        await send(update, f"*{sector_name}*\n\n📊 ราคาปัจจุบัน:\n{prices}\n\n{ai_txt}")

    # ETF detail
    elif data.startswith("etf_"):
        sym  = data[4:]
        name = ETFS.get(sym, sym)
        await send(update, f"⏳ วิเคราะห์ {name}...")
        price_str = fetch_brief_price(sym)
        prompt    = build_etf_prompt(sym, name, price_str)
        ai_txt    = call_openrouter(prompt)
        await send(update, f"💰 *{name} ({sym})*\n💲 {price_str}\n\n{ai_txt}")

    # Crypto detail
    elif data.startswith("cry_"):
        sym  = data[4:]
        name = CRYPTO_SYMBOLS.get(sym, sym)
        await send(update, f"⏳ วิเคราะห์ {name}...")
        price_str = fetch_brief_price(sym)
        prompt    = build_crypto_prompt(sym, price_str)
        ai_txt    = call_openrouter(prompt)
        await send(update, f"₿ *{name} ({sym})*\n💲 {price_str}\n\n{ai_txt}")

    # Sniper signal
    elif data.startswith("snp_"):
        symbol = data[4:]
        await _do_sniper(update, symbol)
