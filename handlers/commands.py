"""
handlers/commands.py
All Telegram command/callback handlers for Bestie Bot US
"""
from __future__ import annotations

import os
import re
import json
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
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
    build_auto_swing_prompt, build_stock_deep_analysis_prompt,
    build_market_pulse_prompt, build_watchlist_summary_prompt,
)
import json


log = logging.getLogger(__name__)

# Dictionary to store conversation history per chat_id
USER_HISTORY = {}
USER_SWING_ROTATION = {}

# Watchlist storage: Supabase when SUPABASE_URL / SUPABASE_SERVICE_KEY are set,
# otherwise the local watchlist.json file (see services/store.py)
from services.store import load_watchlists, save_watchlists  # noqa: E402


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

def _try_detect_stock_symbol(text: str) -> str | None:
    """Force check Yahoo Finance to detect if input is a valid stock/crypto symbol."""
    clean = text.strip()
    if not clean or len(clean) > 12:  # Don't check long sentences
        return None
    
    # 1. Alias mapping for common names
    COMPANY_MAP = {
        "apple": "AAPL", "nvidia": "NVDA", "microsoft": "MSFT",
        "google": "GOOGL", "alphabet": "GOOGL", "amazon": "AMZN",
        "tesla": "TSLA", "meta": "META", "facebook": "META",
        "netflix": "NFLX", "amd": "AMD", "intel": "INTC",
        "coinbase": "COIN", "palantir": "PLTR", "disney": "DIS",
        "paypal": "PYPL", "shopify": "SHOP", "uber": "UBER",
        "airbnb": "ABNB", "spotify": "SPOT", "snap": "SNAP",
        "roblox": "RBLX", "gamestop": "GME", "robinhood": "HOOD",
        "boeing": "BA", "walmart": "WMT", "costco": "COST",
        "starbucks": "SBUX", "nike": "NKE", "coca-cola": "KO",
        "pepsi": "PEP", "johnson": "JNJ", "pfizer": "PFE",
        "moderna": "MRNA", "sea": "SE", "grab": "GRAB",
        "indi": "INDI", "eose": "EOSE", "mstr": "MSTR",
        "bitcoin": "BTC-USD", "ethereum": "ETH-USD", "solana": "SOL-USD",
        "xrp": "XRP-USD", "dogecoin": "DOGE-USD", "bnb": "BNB-USD",
        "บิทคอย": "BTC-USD", "อีเทอร์เรียม": "ETH-USD",
    }
    
    lower = clean.lower()
    if lower in COMPANY_MAP:
        return COMPANY_MAP[lower]
        
    # 2. Check raw input as Symbol
    sym = clean.upper()
    price = fetch_brief_price(sym)
    if price != "N/A":
        return sym
        
    # 3. Check with -USD (common for crypto) if it's 3-5 letters
    if 3 <= len(clean) <= 5:
        price_crypto = fetch_brief_price(sym + "-USD")
        if price_crypto != "N/A":
            return sym + "-USD"

    return None


def _yahoo_chart_link(symbol: str) -> str:
    """Generate a Yahoo Finance chart URL."""
    return f"https://finance.yahoo.com/quote/{symbol}/chart/"

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

MAIN_MENU_KEYBOARD = ReplyKeyboardMarkup(
    [
        ["📰 ข่าวล่าสุด", "📊 ราคาตลาด"],
        ["🥇 วิเคราะห์ทองคำ", "🌏 ราคาทองไทย"],
        ["📈 หุ้น Trending", "🔥 Most Active"],
        ["🎯 Sniper Signal", "⚡ Swing Trade"],
        ["ℹ️ เมนูทั้งหมด (/help)"]
    ],
    resize_keyboard=True,
    is_persistent=True
)

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    kb = [
        [
            InlineKeyboardButton("🎯 Sector",              callback_data="sector_menu"),
            InlineKeyboardButton("💰 ETF",                 callback_data="etf_menu"),
        ],
        [
            InlineKeyboardButton("₿ Crypto",              callback_data="crypto_menu"),
            InlineKeyboardButton("🏖 Retirement Plan",     callback_data="retire_start"),
        ],
        [
            InlineKeyboardButton("💡 Wealth Mindset",      callback_data="mindset"),
            InlineKeyboardButton("📅 Weekly Outlook",      callback_data="weekly"),
        ],
    ]
    await send(update, "เปิดใช้งานแถบเมนูด้านล่างเรียบร้อยครับ! 👇\n(คุณสามารถกดปุ่มด้านล่างเพื่อสั่งงานได้ทันที)", reply_markup=MAIN_MENU_KEYBOARD)
    await send(update,
               "*🤖 Bestie Bot US v3.24*\nเพื่อนนักลงทุน US ของคุณ 🚀\n\nฟีเจอร์เพิ่มเติม:",
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
        # โหมด Auto-recommend: คัดหุ้น > $20 ป้องกัน Penny
        await send(update, "⏳ กำลังคัดกรองหุ้นพื้นฐานดีและจัดแผน Swing Trade ให้...")
        
        candidates = fetch_most_actives() + fetch_trending_equities()
        # Filter price >= 20, remove duplicates
        filtered = {}
        for stock in candidates:
            sym = stock.get("symbol", "")
            price = stock.get("price", 0)
            if sym and price >= 20.0:
                filtered[sym] = f"{sym}: ${price:,.2f} ({stock.get('pct', 0):+.2f}%)"
                
        if not filtered:
            await send(update, "⚠️ ไม่พบหุ้นพื้นฐานตรงเกณฑ์ในขณะนี้")
            return
            
        chat_id = update.effective_chat.id
        rot = USER_SWING_ROTATION.get(chat_id, 0)
        filtered_list = list(filtered.values())
        
        # รอบ 1: 7 ตัว, รอบ 2: 5 ตัว, รอบ 3: 10 ตัว
        counts = [7, 5, 10]
        num_to_recommend = counts[rot]
        
        # แต่ละรอบดึงผู้สมัครมาให้ AI เลือกจาก 20 ตัวถัดไปเรื่อยๆ
        start_idx = rot * 20
        end_idx = start_idx + 20
        
        if start_idx >= len(filtered_list):
            rot = 0
            start_idx = 0
            end_idx = 20
            num_to_recommend = counts[0]
            
        chunk = filtered_list[start_idx:end_idx]
        if len(chunk) < num_to_recommend:
            chunk = filtered_list[:20]
            rot = 0
            num_to_recommend = counts[0]
            
        USER_SWING_ROTATION[chat_id] = (rot + 1) % 3
            
        candidates_str = "\n".join(chunk)
        prompt = build_auto_swing_prompt(candidates_str, num_stocks=num_to_recommend)
        ai_txt = call_openrouter(prompt)
        await send(update, ai_txt)
        return
    
    # โหมดระบุหุ้น
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


# ── /pulse (Market Pulse) ──────────────────────────────────────────────────────

async def cmd_pulse(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await send(update, "🩺 กำลังตรวจชีพจรตลาด (Market Pulse)...")
    news = fetch_real_time_news(10)
    trending = fetch_trending_equities()
    actives = fetch_most_actives()
    
    spy = fetch_brief_price("SPY")
    qqq = fetch_brief_price("QQQ")
    dia = fetch_brief_price("DIA")
    
    trending_str = "\n".join([f"• {s['symbol']}: ${s['price']:,.2f} ({s['pct']:+.2f}%)" for s in trending[:5]])
    actives_str = "\n".join([f"• {s['symbol']}: ${s['price']:,.2f} (Vol: {s.get('volume','N/A')})" for s in actives[:5]])
    
    prompt = build_market_pulse_prompt(news, trending_str, actives_str, spy, qqq, dia)
    ai_txt = call_openrouter(prompt)
    await send(update, f"🩺 **Market Pulse — Bestie Bot US**\n\n{ai_txt}")


# ── /watchlist ─────────────────────────────────────────────────────────────────

async def cmd_watchlist(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = str(update.effective_chat.id)
    watchlists = load_watchlists()
    user_list = watchlists.get(chat_id, [])
    
    if not user_list:
        msg = (
            "📌 **Watchlist ของคุณยังว่างอยู่**\n\n"
            "วิธีเพิ่มหุ้น: พิมพ์ `/add AAPL` หรือ `/add NVDA`\n"
            "วิธีลบหุ้น: พิมพ์ `/del AAPL`"
        )
        await send(update, msg)
        return

    await send(update, f"⏳ กำลังสรุปภาพรวม Watchlist ({len(user_list)} ตัว)...")
    
    prices = []
    for sym in user_list:
        p = fetch_brief_price(sym)
        prices.append(f"{sym}: {p}")
    
    prompt = build_watchlist_summary_prompt("\n".join(prices))
    ai_txt = call_openrouter(prompt)
    
    msg = f"📌 **Your Watchlist Summary**\n\n{ai_txt}\n\n"
    msg += "✍️ เพิ่ม/ลบ: `/add [หุ้น]` หรือ `/del [หุ้น]`"
    await send(update, msg)

async def cmd_add(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if not ctx.args:
        await send(update, "⚠️ โปรดระบุชื่อหุ้นที่ต้องการเพิ่ม เช่น `/add AAPL`")
        return
    
    symbol = ctx.args[0].upper()
    # Verify symbol
    price = fetch_brief_price(symbol)
    if price == "N/A":
        await send(update, f"⚠️ ไม่พบหุ้นชื่อ `{symbol}` กรุณาตรวจสอบอีกครั้ง")
        return
        
    chat_id = str(update.effective_chat.id)
    watchlists = load_watchlists()
    if chat_id not in watchlists:
        watchlists[chat_id] = []
        
    if symbol in watchlists[chat_id]:
        await send(update, f"💡 หุ้น `{symbol}` มีอยู่ใน Watchlist แล้วจ้า")
        return
        
    watchlists[chat_id].append(symbol)
    save_watchlists(watchlists)
    await send(update, f"✅ เพิ่ม `{symbol}` เข้า Watchlist เรียบร้อยแล้ว!\nพิมพ์ `/watchlist` เพื่อดูภาพรวม")

async def cmd_del(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    if not ctx.args:
        await send(update, "⚠️ โปรดระบุชื่อหุ้นที่ต้องการลบ เช่น `/del AAPL`")
        return
    
    symbol = ctx.args[0].upper()
    chat_id = str(update.effective_chat.id)
    watchlists = load_watchlists()
    
    if chat_id not in watchlists or symbol not in watchlists[chat_id]:
        await send(update, f"⚠️ ไม่พบหุ้น `{symbol}` ใน Watchlist ของคุณ")
        return
        
    watchlists[chat_id].remove(symbol)
    save_watchlists(watchlists)
    await send(update, f"🗑 ลบ `{symbol}` ออกจาก Watchlist แล้วจ้า")


# ── General Conversation Handler ────────────────────────────────────────────────

async def handle_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user_text = update.message.text
    if not user_text:
        return
        
    # ดักจับข้อความจากปุ่ม Reply Keyboard
    if user_text == "📰 ข่าวล่าสุด":
        return await cmd_news(update, ctx)
    elif user_text == "📊 ราคาตลาด":
        return await cmd_market(update, ctx)
    elif user_text == "🥇 วิเคราะห์ทองคำ":
        return await cmd_gold(update, ctx)
    elif user_text == "🌏 ราคาทองไทย":
        return await cmd_thaigold(update, ctx)
    elif user_text == "📈 หุ้น Trending":
        return await cmd_trending(update, ctx)
    elif user_text == "🔥 Most Active":
        return await cmd_actives(update, ctx)
    elif user_text == "🎯 Sniper Signal":
        return await cmd_sniper(update, ctx)
    elif user_text == "⚡ Swing Trade":
        return await cmd_swing(update, ctx)
    elif user_text == "ℹ️ เมนูทั้งหมด (/help)":
        return await cmd_help(update, ctx)
    
    # ตรวจจับ: ผู้ใช้พิมพ์ชื่อหุ้น/ชื่อบริษัทมาตรงๆ หรือพิมพ์ "วิเคราะห์ [หุ้น]" → วิเคราะห์ 7 ข้อ
    search_text = user_text
    if user_text.startswith("วิเคราะห์ "):
        search_text = user_text.replace("วิเคราะห์ ", "").strip()

    detected = _try_detect_stock_symbol(search_text)
    if detected:
        await update.message.chat.send_action(action="typing")
        price_str = fetch_brief_price(detected)
        prompt = build_stock_deep_analysis_prompt(detected, price_str)
        ai_txt = call_openrouter(prompt)
        chart_link = _yahoo_chart_link(detected)
        await send(update, f"📊 **วิเคราะห์ {detected}** | ราคา: {price_str}\n\n{ai_txt}\n\n📈 ดูกราฟ: {chart_link}")
        return
        
    chat_id = update.message.chat_id
    await update.message.chat.send_action(action="typing")
    
    # ดึงประวัติการคุยของ user นี้ (จำกัด 10 ข้อความล่าสุด เพื่อไม่ให้เปลือง token)
    if chat_id not in USER_HISTORY:
        USER_HISTORY[chat_id] = []
        
    history = USER_HISTORY[chat_id]
    
    # ใช้ OpenRouter ตอบคำถามทั่วไป โดยจะสวมบทบาท Bestie Bot อัตโนมัติและจำ context ได้
    ai_txt = call_openrouter(user_text, history=history)
    
    # อัปเดตประวัติการคุย
    history.append({"role": "user", "content": user_text})
    history.append({"role": "assistant", "content": ai_txt})
    
    # จำกัดประวัติไว้แค่ 10 ข้อความล่าสุด (5 คู่ ถาม-ตอบ)
    if len(history) > 10:
        USER_HISTORY[chat_id] = history[-10:]
        
    await send(update, ai_txt)


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
