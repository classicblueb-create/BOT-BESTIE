"""
services/ai.py — OpenRouter AI content generation
Mirrors GAS: callOpenRouter, buildMorningPrompt, buildEveningPrompt, etc.
"""
from __future__ import annotations
from typing import Optional
import os
import time
import requests

OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL    = "google/gemma-4-26b-a4b-it:free"
SYSTEM_PERSONA   = (
    "คุณคือ Bestie Bot US 🤖 — ผู้เชี่ยวชาญด้านการเงินและการลงทุนทุกรูปแบบ ตอบคำถามได้ครอบคลุม "
    "ทั้งหุ้น US, ราคาน้ำมัน, ทองคำโลก, ทองสมาคมไทย, คริปโตเคอร์เรนซี (Bitcoin ฯลฯ) "
    "ทำหน้าที่เป็นเพื่อนสนิทที่คอยให้คำปรึกษา แลกเปลี่ยนความคิดเห็น และคุยโต้ตอบได้เป็นธรรมชาติ "
    "ใจดี เป็นกันเอง มีการใช้อีโมจิให้ดูน่าอ่าน"
)


def call_openrouter(prompt: str, model: Optional[str] = None, history: Optional[list] = None) -> str:
    """Call OpenRouter and return the assistant text."""
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        return "⚠️ ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY"
        
    messages = [{"role": "system", "content": SYSTEM_PERSONA}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": prompt})
    
    for attempt in range(3):
        try:
            resp = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                    "HTTP-Referer":  "https://bestie-bot-us",
                },
                json={
                    "model": model or DEFAULT_MODEL,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens":  800,
                },
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except requests.exceptions.HTTPError as e:
            if resp.status_code == 429:
                if attempt < 2:
                    time.sleep(3) # รอ 3 วินาทีแล้วลองใหม่
                    continue
                return "⚠️ AI error: เซิร์ฟเวอร์ของโมเดลฟรี (Free Tier) มีคนใช้งานหนาแน่นเกินไป (Too Many Requests) กรุณาลองใหม่ในอีกสักครู่ครับ"
            return f"⚠️ AI HTTP error: {e}"
        except Exception as e:
            return f"⚠️ AI error: {e}"


# ── Prompt builders ────────────────────────────────────────────────────────────

def build_morning_prompt(news: str, indices: str, gold: str, trending: str) -> str:
    return (
        f"ข่าว US ล่าสุด:\n{news}\n\n"
        f"ดัชนีตลาด:\n{indices}\n\n"
        f"ทองคำ: {gold}\n\n"
        f"หุ้น Trending:\n{trending}\n\n"
        "สรุปสั้น Morning Brief ภาษาไทย ≤10 บรรทัด เน้นประเด็นสำคัญ "
        "และให้แนวทางการลงทุนวันนี้ ใส่อีโมจิด้วย"
    )


def build_evening_prompt(news: str, indices: str, gold: str, movers: str) -> str:
    return (
        f"ข่าว US รอบเย็น:\n{news}\n\n"
        f"ดัชนีตลาดปิดวันนี้:\n{indices}\n\n"
        f"ทองคำ: {gold}\n\n"
        f"หุ้น top movers:\n{movers}\n\n"
        "สรุป Evening Brief ภาษาไทย ≤10 บรรทัด สรุปตลาดวันนี้ "
        "และแนวโน้มพรุ่งนี้ ใส่อีโมจิ"
    )


def build_pre_market_prompt(news: str, futures: str, gold: str) -> str:
    return (
        f"ข่าว Pre-Market:\n{news}\n\n"
        f"US Futures & Asia:\n{futures}\n\n"
        f"ทองคำ: {gold}\n\n"
        "วิเคราะห์ภาษาไทย ≤8 บรรทัด คาดการณ์ทิศทางตลาด US วันนี้ ใส่อีโมจิ"
    )


def build_gold_snapshot_prompt(gold_detail: dict, thai_gold: list) -> str:
    price = gold_detail.get("price", 0)
    chg   = gold_detail.get("change", 0)
    pct   = gold_detail.get("changePct", 0)
    sign  = "+" if chg >= 0 else ""
    thai_lines = "\n".join(
        f"  {g['name']}: ซื้อ {g['bid']} / ขาย {g['ask']}"
        for g in thai_gold[:3]
    ) or "N/A"
    return (
        f"ราคาทองคำโลก XAU/USD: ${price:,.2f} ({sign}{chg:+.2f}, {sign}{pct:.2f}%)\n"
        f"ทองไทย:\n{thai_lines}\n\n"
        "วิเคราะห์ทองคำภาษาไทย ≤8 บรรทัด: แนวรับแนวต้าน, ปัจจัยกดดัน, "
        "คำแนะนำการ trade ใส่อีโมจิ"
    )


def build_gold_signal_prompt(gold_detail: dict) -> str:
    price = gold_detail.get("price", 0)
    chg   = gold_detail.get("change", 0)
    pct   = gold_detail.get("changePct", 0)
    return (
        f"XAU/USD ตอนนี้ ${price:,.2f} ({chg:+.2f} / {pct:+.2f}%)\n\n"
        "วิเคราะห์ Gold signal ≤6 บรรทัด: แนวรับแนวต้าน, Buy/Sell/Hold, "
        "target, stop-loss ใส่อีโมจิ"
    )


def build_sniper_prompt(symbol: str, price_str: str) -> str:
    return (
        f"วิเคราะห์หุ้น {symbol} ราคา {price_str}\n\n"
        "ภาษาไทย ≤8 บรรทัด: Sniper Entry Zone, target, stop-loss, "
        "sentiment, ใส่อีโมจิ"
    )


def build_sector_prompt(sector: str, symbols_str: str) -> str:
    return (
        f"Sector: {sector}\nหุ้นตัวอย่าง: {symbols_str}\n\n"
        "วิเคราะห์ภาษาไทย ≤8 บรรทัด: ภาพรวม sector, โอกาส, ความเสี่ยง, "
        "หุ้นน่าสนใจ ใส่อีโมจิ"
    )


def build_wealth_mindset_prompt() -> str:
    return (
        "แชร์บทเรียน Wealth Mindset หรือ Quote นักลงทุนระดับโลก "
        "ภาษาไทย ≤6 บรรทัด เน้นแรงบันดาลใจ ใส่อีโมจิ"
    )


def build_weekly_outlook_prompt(news: str, indices: str) -> str:
    return (
        f"ข่าวสัปดาห์นี้:\n{news}\n\n"
        f"ดัชนี:\n{indices}\n\n"
        "วิเคราะห์ Weekly Outlook ภาษาไทย ≤10 บรรทัด: "
        "Theme สัปดาห์นี้, หุ้น/sector น่าจับตา, ความเสี่ยง ใส่อีโมจิ"
    )


def build_economic_calendar_prompt(news: str) -> str:
    return (
        f"ข่าวเศรษฐกิจล่าสุด:\n{news}\n\n"
        "สรุป Economic Calendar ภาษาไทย ≤8 บรรทัด: "
        "เหตุการณ์สำคัญสัปดาห์นี้, ผลกระทบต่อตลาด ใส่อีโมจิ"
    )


def build_new_high_prompt(symbol: str, price_str: str) -> str:
    return (
        f"หุ้น {symbol} ({price_str}) อาจทำ New High\n\n"
        "ภาษาไทย ≤6 บรรทัด: momentum, แนวต้านถัดไป, "
        "น่า buy breakout หรือรอ pullback ใส่อีโมจิ"
    )


def build_etf_prompt(symbol: str, name: str, price_str: str) -> str:
    return (
        f"ETF: {name} ({symbol}) ราคา {price_str}\n\n"
        "วิเคราะห์ภาษาไทย ≤8 บรรทัด: ภาพรวม ETF, ผลตอบแทนปีนี้, "
        "เหมาะกับ port ประเภทไหน, ข้อควรระวัง ใส่อีโมจิ"
    )


def build_retirement_prompt(age: int, goal_m: float, current_m: float,
                             monthly_invest: float, years: int) -> str:
    return (
        f"อายุ {age} ปี\n"
        f"เป้าหมายเกษียณ: {goal_m:.1f}M บาท\n"
        f"มีทุนปัจจุบัน: {current_m:.1f}M บาท\n"
        f"ลงทุนต่อเดือน: {monthly_invest:,.0f} บาท\n"
        f"เหลือเวลา: {years} ปี\n\n"
        "คำนวณและให้คำแนะนำแผนเกษียณ ภาษาไทย ≤10 บรรทัด "
        "เลือก asset mix (US stocks, ETF, bonds, gold) ให้เหมาะกับเป้า ใส่อีโมจิ"
    )


def build_crypto_prompt(symbol: str, price_str: str) -> str:
    return (
        f"Crypto: {symbol} ราคา {price_str}\n\n"
        "วิเคราะห์ภาษาไทย ≤8 บรรทัด: แนวโน้ม, sentiment, "
        "แนวรับแนวต้าน, คำแนะนำ ใส่อีโมจิ"
    )

def build_sentiment_alert_prompt(symbol: str, price_str: str, pct: float) -> str:
    return (
        f"หุ้น US: {symbol} (ราคา {price_str}, เปลี่ยนแปลง {pct:+.2f}%)\n"
        "จับสัญญาณความผิดปกติ/Volume เข้า/ข่าวสำคัญ\n\n"
        "วิเคราะห์แบบเร่งด่วน (ภาษาไทย ≤8 บรรทัด): เกิดอะไรขึ้น? ข่าว/Sentiment เชิงบวกหรือลบ? "
        "มีโอกาสทำกำไรระยะสั้น (Trade setup) อย่างไร แนวต้าน/Stop-loss อยู่ตรงไหน เน้นฟันธงเด็ดขาด ใส่อีโมจิ"
    )

def build_swing_trade_prompt(symbol: str, price_str: str) -> str:
    return (
        f"ผู้ใช้ต้องการวางแผนเทรดสวิง (Swing Trade) ทำกำไรระยะสั้น 3-5 วัน สำหรับหุ้น {symbol} (ราคาล่าสุด {price_str})\n\n"
        "วิเคราะห์แผนการเทรด (ภาษาไทย ≤10 บรรทัด):\n"
        "1. Momentum และ Catalyst ปัจจุบัน (ทำไมถึงน่าเล่นสั้นๆ)\n"
        "2. จุดเข้าซื้อ (Entry Zone)\n"
        "3. จุดทำกำไร (Target Price ใน 3-5 วัน)\n"
        "4. จุดตัดขาดทุน (Stop-Loss อย่างเคร่งครัด)\n"
        "สวมบทบาทเป็นผู้ช่วยลงทุนที่เฉียบขาด ชัดเจน และมีการเตือนความเสี่ยง ใส่อีโมจิ"
    )

def build_auto_swing_prompt(candidates_str: str) -> str:
    return (
        f"รายชื่อหุ้น US ที่มี Volume/Trending ตอนนี้ (คัดเฉพาะราคา > $20 ป้องกัน Penny Stock):\n{candidates_str}\n\n"
        "คำสั่ง:\n"
        "1. ให้คุณสวมบทบาทผู้ช่วยลงทุน คัดเลือกหุ้น 'พื้นฐานดี/มีความน่าเชื่อถือ' จากรายชื่อนี้มา **5 ถึง 7 ตัว** ที่มีโอกาสทำกำไรระยะสั้น (Swing Trade 3-5 วัน) ได้ดีที่สุด\n"
        "2. วิเคราะห์แต่ละตัว (ภาษาไทย สั้นๆ กระชับ ตัวละ 4-5 บรรทัด):\n"
        "   - ชื่อหุ้น และเหตุผลที่เลือก (ข่าว/Catalyst/Trend)\n"
        "   - จุดเข้าซื้อ (Entry Zone)\n"
        "   - จุดทำกำไร (Target Price)\n"
        "   - จุดตัดขาดทุน (Stop-Loss)\n"
        "นำเสนอเป็นตัวเลือกที่ชัดเจนและเฉียบขาด ใส่อีโมจิให้สวยงามและอ่านง่าย"
    )
