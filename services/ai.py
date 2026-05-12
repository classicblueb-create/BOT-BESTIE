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
    "ใจดี เป็นกันเอง มีการใช้อีโมจิให้ดูน่าอ่าน\n"
    "⚠️ กฎเหล็ก (สำคัญมาก):\n"
    "1. ต้องสื่อสารเป็นภาษาไทย 100% เท่านั้น (ยกเว้นชื่อหุ้นหรือศัพท์เทคนิค) ห้ามตอบเป็นภาษาอังกฤษเด็ดขาด!\n"
    "2. ห้ามใช้รูปแบบตาราง (Markdown Table) ในการตอบทุกกรณี! เพราะอ่านยากบนมือถือ "
    "ให้ใช้การจัดรูปแบบเป็นรายข้อ (Bullet points) หรือหัวข้อที่ชัดเจนแทน\n"
    "3. หากผู้ใช้พิมพ์ชื่อหุ้นหรือชื่อบริษัทสั้นๆ ให้วิเคราะห์เจาะลึก 7 ข้อทันที "
    "โดยเน้นข้อมูลเชิงลึกและกลยุทธ์ที่เฉียบคม"
)

# ── Humanize Rules (กำจัด AI-voice ใน prompt ทุกตัว) ──────────────────────────
HUMANIZE_RULES = (
    "กฎ Humanize — ห้ามทำแบบ AI เด็ดขาด:\n"
    "❌ ห้ามใช้คำพวกนี้: revolutionary, game-changing, groundbreaking, transformative, "
    "cutting-edge, leverage, utilize, delve, dive into, it's worth noting, "
    "certainly!, absolutely!, I understand that, I hope this helps\n"
    "❌ ห้ามเกริ่น: 'จากข้อมูลที่ให้มา', 'ตามที่กล่าวมา', 'ในฐานะ AI'\n"
    "❌ ห้ามพูดซ้ำหัวข้อก่อนตอบ เช่น 'คุณถามเรื่อง X นั้น...'\n"
    "❌ ห้ามประโยคเยินยอ: 'คำถามดีมากเลย!', 'ขอบคุณสำหรับคำถาม'\n"
    "❌ ห้ามลงท้ายแบบ AI: 'หากมีคำถามเพิ่มเติม...', 'หวังว่าจะเป็นประโยชน์'\n"
    "✅ เขียนเหมือนเพื่อนสาวที่รู้เรื่องลงทุนจริง พูดตรง กระชับ มีมุมมองเป็นของตัวเอง\n"
    "✅ เริ่มตอบเนื้อหาได้เลย ไม่ต้องเกริ่น\n"
    "✅ ใช้ภาษาพูดธรรมชาติ มีอารมณ์ได้ ลงท้าย คะ/ค่ะ\n"
)



def build_stock_deep_analysis_prompt(symbol: str, price_str: str) -> str:
    """Build a 7-point deep analysis prompt for a specific stock."""
    return (
        f"วิเคราะห์หุ้น {symbol} (ราคาล่าสุด: {price_str})\n\n"
        "วิเคราะห์แบบเจาะลึก 7 ข้อ (ภาษาไทย กระชับ อ่านง่าย):\n\n"
        "1️⃣ **บริษัทนี้คือใคร?** - อธิบายสั้นๆ ว่าทำอะไร อยู่ในอุตสาหกรรมไหน\n\n"
        "2️⃣ **ราคาและภาพรวม** - ราคาปัจจุบัน เทียบกับ 52-week High/Low แนวโน้มระยะสั้น\n\n"
        "3️⃣ **จุดแข็งของบริษัท** - ความได้เปรียบเชิงแข่งขันคืออะไร ทำไมถึงน่าลงทุน\n\n"
        "4️⃣ **ความเสี่ยง** - ปัจจัยความเสี่ยงหลักๆ คู่แข่ง หรือสิ่งที่ต้องระวัง\n\n"
        "5️⃣ **แนวรับ / แนวต้าน** - ระดับราคาสำคัญ\n\n"
        "6️⃣ **Sentiment / ข่าวล่าสุด** - ข่าวเด่นๆ หรือ Catalyst ที่กำลังจะมา (earnings, product launch ฯลฯ)\n\n"
        "7️⃣ **คำแนะนำ** - สรุปว่าควรซื้อ/ขาย/รอ และกลยุทธ์ที่เหมาะสม\n\n"
        "ใส่อีโมจิ กระชับ อ่านง่าย"
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
    
    for attempt in range(5): # เพิ่มเป็น 5 รอบ
        try:
            # ใช้ระบบ Fallback ของ OpenRouter ถ้ารุ่นแรกไม่ว่าง จะสลับไปรุ่นอื่นให้อัตโนมัติ
            payload = {
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 800,
            }
            
            if model:
                payload["model"] = model
            else:
                payload["models"] = [
                    DEFAULT_MODEL,
                    "nvidia/nemotron-3-super-120b-a12b:free",
                    "openai/gpt-oss-120b:free"
                ]

            resp = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                    "HTTP-Referer":  "https://bestie-bot-us",
                },
                json=payload,
                timeout=45,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except requests.exceptions.HTTPError as e:
            if resp.status_code == 429:
                if attempt < 4:
                    time.sleep(2) # รอ 2 วินาทีแล้วดึงใหม่
                    continue
                return "ขออภัยด้วยครับ ตอนนี้ผมกำลังประมวลผลข้อมูลตลาดเยอะมาก รบกวนถามใหม่อีกครั้งในอีกสัก 1 นาทีนะครับ 🙏"
            return f"⚠️ AI HTTP error: {e}"
        except Exception as e:
            if attempt < 4:
                time.sleep(2)
                continue
            return f"⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อ: {e}"


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

def build_auto_swing_prompt(candidates_str: str, num_stocks: int = 5) -> str:
    return (
        f"รายชื่อหุ้น US ที่มี Volume/Trending ตอนนี้:\n{candidates_str}\n\n"
        f"คำสั่ง:\n"
        f"1. คัดเลือกหุ้น 'พื้นฐานดี+มีโมเมนต์' จากรายชื่อนี้มา **{num_stocks} ตัว** สำหรับ Swing Trade 3-5 วัน\n"
        "2. **ห้ามใช้ตารางเด็ดขาด** ให้จัดรูปแบบเป็นข้อๆ สวยงาม อ่านง่ายบนมือถือ ตามโครงสร้างนี้เป๊ะๆ:\n\n"
        f"📈 **{num_stocks} หุ้นพื้นฐานดี เหมาะ Swing Trade (3-5 วัน)**\n\n"
        "1️⃣ **[สัญลักษณ์] ([ชื่อบริษัท])**\n"
        "📝 เหตุผล: [รายละเอียด Catalyst/Trend แบบสั้นแต่ชัดเจน]\n"
        "🟢 Entry Zone: $[ราคา] - $[ราคา]\n"
        "🎯 Target: $[ราคา] (≈ +X%)\n"
        "🛑 Stop-Loss: $[ราคา] (≈ -X%)\n\n"
        f"(ทำซ้ำให้ครบ {num_stocks} ตัว)\n\n"
        "🔎 **สรุปสั้นๆ แต่เจาะจง**\n"
        "▪️ [สัญลักษณ์]: [เหตุผลหลัก 1 บรรทัด]\n"
        f"(ทำซ้ำให้ครบ {num_stocks} ตัว)\n\n"
        "💡 **Tip:** [ข้อแนะนำการบริหารความเสี่ยงหรือเคล็ดลับการเทรด]"
    )


# ── Market Pulse ──────────────────────────────────────────────────────────────

def build_market_pulse_prompt(news: str, trending: str, actives: str,
                               spy: str, qqq: str, dia: str) -> str:
    """สรุป Market Pulse รวม News + Trending + Most Active ในคำสั่งเดียว"""
    return (
        f"{HUMANIZE_RULES}\n"
        f"ข้อมูลตลาดสด:\n"
        f"SPY={spy} | QQQ={qqq} | DIA={dia}\n\n"
        f"ข่าว US ล่าสุด 10 ข้อ:\n{news}\n\n"
        f"🔥 Trending Equities วันนี้:\n{trending}\n\n"
        f"⚡ Most Actives (Volume สูง):\n{actives}\n\n"
        "สรุป Market Pulse ภาษาไทย ≤12 บรรทัด แบบเพื่อนสาวสายลงทุน:\n"
        "- สรุปภาพรวมตลาด US วันนี้ 2-3 บรรทัด\n"
        "- เลือก 3 ข่าวสำคัญที่สุดพร้อม Insight กระทบพอร์ต\n"
        "- ระบุหุ้น Trending ที่น่าจับตา 2-3 ตัว พร้อมเหตุผลสั้นๆ\n"
        "ห้ามใช้ตาราง ใส่อีโมจิ อ่านง่ายบนมือถือ"
    )


# ── Bestie Insight Daily (6 Pillar) ──────────────────────────────────────────

INSIGHT_PILLARS = [
    {
        "id": "FUND_SPOTLIGHT",
        "label": "🏦 Fund Spotlight",
        "prompt": "เลือก 1 ETF/Fund ที่น่าสนใจที่สุดตามสถานการณ์ตลาดวันนี้แล้วเขียน Insight: "
                  "ชื่อ ETF, กลยุทธ์ทำงานยังไง, yield เท่าไหร่, ข้อดี-ข้อเสีย, เหมาะกับนักลงทุนแบบไหน "
                  "เชื่อมกับสถานการณ์ตลาดวันนี้ด้วย เน้น: QQQI, JEPQ, SCHD, QQQM, VOO, GLD, IBIT"
    },
    {
        "id": "GURU_WATCH",
        "label": "👑 Guru Watch",
        "prompt": "สุ่มเลือก 1 Guru จาก: Warren Buffett, Cathie Wood, Michael Burry, Bill Ackman, Ray Dalio "
                  "แล้วเขียน Insight เกี่ยวกับ Holdings ล่าสุด ซื้อ/ขายอะไร กลยุทธ์น่าสนใจ "
                  "บทเรียนที่นักลงทุนรายย่อยนำไปใช้ได้"
    },
    {
        "id": "WHY_TRENDING",
        "label": "🔥 Why Trending",
        "prompt": "ดูจากข่าวและ Top Movers วันนี้ เลือก 1 หุ้นที่ Trending มากที่สุด "
                  "อธิบายว่าบริษัทนี้ทำอะไร Catalyst ที่ทำให้ราคาขยับคืออะไร "
                  "มุมมองนักวิเคราะห์เป็นยังไง และความเสี่ยงที่ต้องระวัง"
    },
    {
        "id": "HIDDEN_GEM",
        "label": "💎 Hidden Gem",
        "prompt": "แนะนำ 1 หุ้น Small/Mid Cap (Market Cap $300M-$10B) ที่ยังไม่ดัง "
                  "แต่ Fundamentals แข็งแกร่ง อยู่ใน Sector กำลัง grow "
                  "อธิบายธุรกิจ จุดแข็ง เหตุผลน่าจับตา และความเสี่ยง"
    },
    {
        "id": "SECTOR_ROTATION",
        "label": "📊 Sector Rotation",
        "prompt": "วิเคราะห์จากข่าวและข้อมูลตลาดวันนี้ว่า Smart Money กำลัง rotate "
                  "จาก sector ไหนไป sector ไหน ทำไมถึงเกิดการ rotate แบบนี้ "
                  "หุ้นหรือ ETF อะไรที่น่าจะได้ประโยชน์"
    },
    {
        "id": "INVEST_CONCEPT",
        "label": "🧠 Investing Concept",
        "prompt": "เลือก 1 concept การลงทุนที่เกี่ยวข้องกับสถานการณ์ตลาดวันนี้ "
                  "เช่น P/E ratio, Economic Moat, DCA, Margin of Safety, Risk/Reward, Diversification "
                  "อธิบายให้เข้าใจง่าย พร้อมตัวอย่างที่เชื่อมกับข่าววันนี้"
    },
]

# Custom topics จาก GAS version — หมุนเวียนรายสัปดาห์
CUSTOM_TOPICS = [
    "ทองคำและ Gold ETF (GLD/IAU) vs ซื้อทองแท่งจริง อันไหนดีกว่ากัน",
    "SCHD vs JEPI vs JEPQ vs QQQI เลือกแบบไหนดีสำหรับปันผลรายเดือน",
    "VOO vs QQQ vs QQQM ต่างกันยังไง ซื้อตัวไหนดีสำหรับ DCA ระยะยาว",
    "Bitcoin ETF (IBIT) vs ซื้อ BTC ตรง ต่างกันยังไง เหมาะกับนักลงทุนแบบไหน",
    "Fed ไม่ลดดอกเบี้ย ตลาดหุ้นจะเป็นยังไงต่อ นักลงทุนไทยควรทำอะไร",
    "Dollar Cost Averaging (DCA) กับ Lump Sum ต่างกันยังไง แบบไหนดีกว่าในตลาดแบบนี้",
    "Sector Rotation คืออะไร ดู ETF ตัวไหนรู้ได้เลยว่าเงินกำลังไหลไปที่ไหน",
    "Covered Call ETF ทำงานยังไง ทำไม QQQI และ JEPQ ถึงจ่ายปันผลได้สูงขนาดนี้",
]


def build_bestie_insight_prompt(
    pillar_prompt: str, pillar_label: str,
    news: str, spy: str, qqq: str, gold: str, btc: str, top_movers: str
) -> str:
    """Build Bestie Insight Daily prompt for a specific pillar."""
    return (
        f"{HUMANIZE_RULES}\n"
        f"ข้อมูลตลาดสดวันนี้:\n"
        f"SPY={spy} | QQQ={qqq} | Gold={gold} | BTC={btc}\n"
        f"Top Movers:\n{top_movers}\n\n"
        f"ข่าวตลาดล่าสุด:\n{news}\n\n"
        f"หัวข้อวันนี้: {pillar_label}\n"
        f"คำสั่ง: {pillar_prompt}\n\n"
        "กฎการเขียน:\n"
        "- เริ่มด้วย HOOK ที่ดึงความสนใจทันที (ตัวเลข/คำถาม/Statement ฉุด)\n"
        "- เนื้อหา 150-200 คำ ภาษาไทย เป็นกันเอง มีอีโมจิ\n"
        "- อ้างอิงข้อมูลตลาดสดที่ให้มา ห้ามแต่งตัวเลข\n"
        "- ลงท้ายด้วยคำถามกระตุ้นคิด หรือ CTA สั้นๆ"
    )


def build_watchlist_summary_prompt(symbols_prices: str) -> str:
    """Build prompt to summarize user's watchlist."""
    return (
        f"{HUMANIZE_RULES}\n"
        f"รายการ Watchlist ของผู้ใช้:\n{symbols_prices}\n\n"
        "สรุปภาพรวม Watchlist ภาษาไทย ≤8 บรรทัด:\n"
        "- ภาพรวม performance วันนี้ของแต่ละตัว\n"
        "- ตัวไหนน่าจับตา/น่าห่วงที่สุด พร้อมเหตุผลสั้นๆ\n"
        "- คำแนะนำสั้นๆ 1-2 ข้อ ใส่อีโมจิ"
    )


def build_personal_watchlist_report_prompt(symbols_news: str) -> str:
    """Build prompt for personal watchlist news/trend update."""
    return (
        f"{HUMANIZE_RULES}\n"
        f"ข้อมูลหุ้นใน Watchlist และข่าวที่เกี่ยวข้อง:\n{symbols_news}\n\n"
        "คำสั่ง:\n"
        "- วิเคราะห์และสรุปข่าว/แนวโน้มที่น่าสนใจเป็นพิเศษสำหรับหุ้นเหล่านี้ (ภาษาไทย ≤12 บรรทัด)\n"
        "- เน้นประเด็นที่ 'ต้องรู้' หรือ 'ต้องระวัง' ในวันนี้\n"
        "- ให้คำแนะนำเชิงกลยุทธ์สั้นๆ สำหรับหุ้นแต่ละตัวที่มีข่าว\n"
        "- ใช้โทนเป็นกันเองเหมือนเพื่อนสนิทมาอัปเดตให้ฟัง ห้ามใช้ตาราง ใส่อีโมจิ"
    )
