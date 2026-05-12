"""
services/data.py — Market data fetching
Mirrors GAS: fetchBriefPrice, fetchGoldPrice, fetchRealTimeMarketNews,
fetchThaiGoldPrice, fetchTrendingEquities, fetchMostActives, fetchWorldIndices
"""
import requests
import xml.etree.ElementTree as ET
from datetime import datetime

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}

# ── Price helpers ──────────────────────────────────────────────────────────────

def fetch_brief_price(symbol: str) -> str:
    """Return a short price string like '$185.20 (+1.23%)'."""
    try:
        url  = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol)}?interval=1d&range=1d"
        meta = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice", 0)
        prev  = meta.get("previousClose") or meta.get("chartPreviousClose") or price
        pct   = ((price - prev) / prev * 100) if prev else 0
        sign  = "+" if pct >= 0 else ""
        return f"${price:,.2f} ({sign}{pct:.2f}%)"
    except Exception:
        return "N/A"


def fetch_gold_price() -> str:
    """Fetch XAU/USD spot price string."""
    try:
        url  = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d"
        meta = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice", 0)
        prev  = meta.get("previousClose") or price
        pct   = ((price - prev) / prev * 100) if prev else 0
        sign  = "+" if pct >= 0 else ""
        return f"${price:,.2f} ({sign}{pct:.2f}%)"
    except Exception:
        return "N/A"


def fetch_gold_price_detail() -> dict:
    """Return dict with price, change, changePct for gold signals."""
    try:
        url  = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d"
        meta = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()["chart"]["result"][0]["meta"]
        price  = meta.get("regularMarketPrice", 0)
        prev   = meta.get("previousClose") or price
        change = price - prev
        pct    = (change / prev * 100) if prev else 0
        return {"price": price, "change": change, "changePct": pct}
    except Exception:
        return {}


def fetch_thai_gold_price() -> list[dict]:
    """Fetch Thai gold prices from thaigold.info."""
    try:
        url  = "https://www.thaigold.info/RealTimeDataV2/gtdata_.txt"
        rows = requests.get(url, timeout=8).json()
        if not isinstance(rows, list):
            return []
        # put สมาคมฯ first
        rows.sort(key=lambda r: (0 if r.get("name") == "สมาคมฯ" else 1))
        result = []
        for r in rows:
            name = r.get("name", "")
            if not name or name == "Update" or name[:1].isascii() and name[:1].isalpha():
                continue
            def fmt(v):
                try:
                    return f"{float(str(v).replace(',', '')):,.0f}"
                except Exception:
                    return str(v)
            diff = float(str(r.get("diff", "0")).replace(",", "")) if r.get("diff") else 0
            result.append({
                "name": name,
                "bid":  fmt(r.get("bid")),
                "ask":  fmt(r.get("ask")),
                "diff": diff,
            })
        return result
    except Exception:
        return []


def fetch_world_indices() -> str:
    """Return formatted string of major world indices."""
    indices = [
        ("^GSPC", "S&P 500"),
        ("^DJI",  "Dow Jones"),
        ("^IXIC", "NASDAQ"),
    ]
    lines = []
    for sym, name in indices:
        try:
            url  = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(sym)}?interval=1d&range=1d"
            meta = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()["chart"]["result"][0]["meta"]
            price  = meta.get("regularMarketPrice", 0)
            prev   = meta.get("previousClose") or meta.get("chartPreviousClose") or price
            change = price - prev
            pct    = (change / prev * 100) if prev else 0
            sign   = "+" if pct >= 0 else ""
            arrow  = "📈" if pct >= 0 else "📉"
            lines.append(f"{arrow} {name}: {price:,.2f} ({sign}{pct:.2f}%)")
        except Exception:
            lines.append(f"• {name}: N/A")
    return "\n".join(lines)


def fetch_trending_equities() -> list[dict]:
    """Top trending US equities from Yahoo."""
    try:
        url  = "https://query1.finance.yahoo.com/v1/finance/trending/US?count=10&useQuotes=true"
        data = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()
        quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
        if not quotes:
            raise ValueError("empty")
        result = []
        for q in quotes[:10]:
            result.append({
                "symbol": q.get("symbol", ""),
                "name":   (q.get("shortName") or q.get("symbol", ""))[:20],
                "price":  q.get("regularMarketPrice", 0),
                "pct":    q.get("regularMarketChangePercent", 0),
            })
        return result
    except Exception:
        return []


def fetch_most_actives() -> list[dict]:
    """Most active US equities by volume from Yahoo."""
    try:
        url  = ("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
                "?formatted=false&lang=en-US&region=US&scrIds=most_actives&count=10")
        data   = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()
        quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
        result = []
        for q in quotes[:10]:
            vol = q.get("regularMarketVolume", 0)
            vol_str = (f"{vol/1e9:.1f}B" if vol >= 1e9 else
                       f"{vol/1e6:.0f}M" if vol >= 1e6 else
                       f"{vol/1e3:.0f}K")
            result.append({
                "symbol": q.get("symbol", ""),
                "name":   (q.get("shortName") or q.get("symbol", ""))[:20],
                "price":  q.get("regularMarketPrice", 0),
                "pct":    q.get("regularMarketChangePercent", 0),
                "vol":    vol_str,
            })
        return result
    except Exception:
        return []


def fetch_top_movers() -> str:
    """Return a short string of top movers for AI prompts."""
    try:
        url  = ("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
                "?formatted=false&lang=en-US&region=US&scrIds=day_gainers&count=5")
        data   = requests.get(url, headers=YAHOO_HEADERS, timeout=8).json()
        quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
        lines  = []
        for q in quotes[:5]:
            sym = q.get("symbol", "")
            pct = q.get("regularMarketChangePercent", 0)
            p   = q.get("regularMarketPrice", 0)
            lines.append(f"{sym}: ${p:.2f} ({pct:+.2f}%)")
        return "\n".join(lines)
    except Exception:
        return "N/A"


# ── News ───────────────────────────────────────────────────────────────────────

RSS_FEEDS = [
    "https://finance.yahoo.com/rss/headline?s=SPY",
    "https://finance.yahoo.com/rss/headline?s=GC=F",
    "https://finance.yahoo.com/rss/headline?s=BTC-USD",
    "https://finance.yahoo.com/rss/topfinstories",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://www.marketwatch.com/rss/topstories",
    "https://news.google.com/rss/search?q=stock+market+US&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=gold+price+XAU&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=federal+reserve+interest+rate&hl=en-US&gl=US&ceid=US:en",
]

RELEVANT_KW = {
    "market", "stock", "fed", "rate", "economy", "gdp", "inflation",
    "earnings", "crypto", "gold", "oil", "index", "trade", "tariff",
    "nasdaq", "s&p", "dow", "bond", "yield", "invest", "finance",
    "bank", "tech", "ai", "chip", "semiconductor",
}


def fetch_real_time_news(limit: int = 15) -> str:
    """Aggregate latest financial news from RSS feeds."""
    seen: set[str] = set()
    all_news: list[dict] = []

    for feed_url in RSS_FEEDS:
        try:
            res = requests.get(feed_url, headers=YAHOO_HEADERS, timeout=8)
            root = ET.fromstring(res.text)
            for item in root.iter("item"):
                title_el = item.find("title")
                if title_el is None:
                    continue
                title = (title_el.text or "").strip()
                if not title or title in seen:
                    continue
                lower = title.lower()
                if not any(kw in lower for kw in RELEVANT_KW):
                    continue
                seen.add(title)
                pub = (item.findtext("pubDate") or "")
                all_news.append({"title": title, "pub": pub})
        except Exception:
            continue

    # sort newest first
    def _parse_date(s):
        try:
            from email.utils import parsedate_to_datetime
            return parsedate_to_datetime(s)
        except Exception:
            return datetime.min

    all_news.sort(key=lambda x: _parse_date(x["pub"]), reverse=True)
    top = all_news[:limit]
    if not top:
        return "ไม่พบข่าวใหม่ในขณะนี้"
    return "\n".join(f"{i+1}. {n['title']}" for i, n in enumerate(top))


def fetch_symbol_news(symbol: str, limit: int = 5) -> str:
    """Fetch latest news for a specific stock symbol via Yahoo RSS."""
    try:
        url = f"https://finance.yahoo.com/rss/headline?s={requests.utils.quote(symbol)}"
        res = requests.get(url, headers=YAHOO_HEADERS, timeout=8)
        root = ET.fromstring(res.text)
        news = []
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            if title:
                news.append(title)
            if len(news) >= limit:
                break
        return "\n".join(news) if news else "No specific news found."
    except Exception:
        return "N/A"
