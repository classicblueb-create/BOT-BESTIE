import requests

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}

def fetch_brief_price(symbol: str) -> str:
    try:
        url  = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol)}?interval=1d&range=1d"
        resp = requests.get(url, headers=YAHOO_HEADERS, timeout=8)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        if not data.get("chart", {}).get("result"):
            print(f"No result for {symbol}")
            return "N/A"
        meta = data["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice", 0)
        print(f"Price for {symbol}: {price}")
        return str(price)
    except Exception as e:
        print(f"Error: {e}")
        return "N/A"

fetch_brief_price("INDI")
fetch_brief_price("EOSE")
