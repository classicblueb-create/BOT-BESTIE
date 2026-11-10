// @ts-nocheck
/**
 * ============================================================
 * BESTIE BOT — TRADER CORE (LINE / Apps Script)
 * ============================================================
 * Port ของ day-trader-skill (9 จาก 11 skills) เป็น Apps Script
 *   https://github.com/Jakeschincariol/day-trader-skill  — MIT License
 *   Copyright (c) Jake Schincariol
 *
 * หลักการ: "ตัวเลขมาจากโค้ด — AI แค่อธิบาย"
 *   entry / stop / target / จำนวนหุ้น / ความเสี่ยง / โอกาส คำนวณที่นี่ทั้งหมด
 *
 * ไฟล์นี้มีแต่ logic + การดึงข้อมูล ส่วนข้อความ LINE อยู่ใน trader_line.gs
 *   1. เวลา NY + ปฏิทิน NYSE           (ทุก skill)
 *   2. Yahoo bars                      (scanner / entry / exit / timemachine / alerts)
 *   3. trader-exit      tdComputeExit
 *   4. trader-budget    tdSizeTrade
 *   5. trader-risk      tdRiskCheck
 *   6. trader-entry     tdEntryCheck
 *   7. trader-scanner   tdScanDaily / tdScanOrb
 *   8. trader-timemachine tdTimeMachine
 *   9. trader-alerts    tdQuotes / tdAlertHit
 *  10. trader-news      tdNews
 *  11. trader-analyst   tdEarnings
 *  ไม่ได้ port: trader-broker (บอทไม่ส่งคำสั่งซื้อขายจริง — เป็น bot แบบ broadcast)
 *               trader-pelosi
 *
 * ข้อมูลฟรีจาก Yahoo ไม่ใช่ API ทางการ อาจดีเลย์ — ไม่ใช่คำแนะนำการลงทุน
 * ============================================================
 */

// ── ค่าตั้งต้นเหมือน config.example.json ของ day-trader-skill ──
var TD_DEFAULTS = {
  budget: 5000,
  cash_buffer_pct: 10,
  max_position_pct: 75,
  max_order_usd: 4000,
  min_order_usd: 5,
  max_loss_per_trade_usd: 50,
  max_daily_loss_usd: 150,
  max_trades_per_day: 3,
  min_reward_risk: 1.0,
  require_stop: true,
  no_entries_before: "09:45",
  no_entries_after: "15:30",
  flat_by: "15:55",
  blocked: []
};

var TD_UA = "Mozilla/5.0 (compatible; BestieBot/1.0)";
var TD_MIN_RISK_PCT = 0.05;   // risk < 0.05% ของราคา = แคบเกิน spread
var TD_SESSION_BARS = 78;     // 9:30–16:00 แท่ง 5 นาที

// รายชื่อหุ้นสภาพคล่องสูงสำหรับสแกน (แทนการสแกน ~5,900 ตัว เพื่อไม่ชน quota UrlFetch)
// แก้ได้ด้วย Script Property SCAN_UNIVERSE = "AAPL,MSFT,..."
var TD_UNIVERSE = (
  "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AVGO,AMD,NFLX,ORCL,CRM,ADBE,INTC,QCOM,MU,TXN,AMAT,LRCX,KLAC," +
  "ARM,SMCI,PLTR,SNOW,CRWD,PANW,NET,DDOG,ZS,MDB,SHOP,UBER,ABNB,DASH,COIN,HOOD,SOFI,PYPL,SQ,MSTR," +
  "JPM,BAC,WFC,C,GS,MS,SCHW,V,MA,AXP,BRK.B,UNH,LLY,JNJ,ABBV,MRK,PFE,TMO,ISRG,NVO," +
  "XOM,CVX,COP,OXY,SLB,CAT,DE,GE,BA,LMT,RTX,HON,UPS,FDX,WMT,COST,TGT,HD,LOW,NKE," +
  "SBUX,MCD,KO,PEP,PG,DIS,CMCSA,T,VZ,TMUS,RIVN,LCID,NIO,F,GM,DELL,HPQ,IBM,CSCO,ANET," +
  "MRVL,ON,ASML,TSM,BABA,PDD,JD,SNAP,PINS,RBLX,U,AFRM,UPST,RDDT,APP,IONQ,RKLB,ASTS,CVNA,CELH"
).split(",");

var NYSE_HOLIDAYS = {
  "2026-01-01": "New Year's Day", "2026-01-19": "MLK Day", "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)", "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day", "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day", "2027-01-18": "MLK Day", "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday", "2027-05-31": "Memorial Day", "2027-06-18": "Juneteenth (observed)",
  "2027-07-05": "Independence Day (observed)", "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day", "2027-12-24": "Christmas Day (observed)"
};
var NYSE_EARLY_CLOSE = { "2026-11-27": "day after Thanksgiving", "2026-12-24": "Christmas Eve",
                         "2027-11-26": "day after Thanksgiving" };

// ╔══════════════════════════════════════════════════════════════╗
// ║  1. TIME — New York (DST) + NYSE calendar                    ║
// ╚══════════════════════════════════════════════════════════════╝

function tdNthSundayUtc_(year, month0, n, hourUtc) {
  var d = new Date(Date.UTC(year, month0, 1));
  var add = (7 - d.getUTCDay()) % 7 + (n - 1) * 7;
  return Date.UTC(year, month0, 1 + add, hourUtc);
}

/** -4 (EDT) or -5 (EST) for a UTC epoch ms. US rule since 2007. */
function tdEasternOffset(ms) {
  var y = new Date(ms).getUTCFullYear();
  var start = tdNthSundayUtc_(y, 2, 2, 7);   // 2nd Sun Mar, 2:00 EST
  var end   = tdNthSundayUtc_(y, 10, 1, 6);  // 1st Sun Nov, 2:00 EDT
  return (ms >= start && ms < end) ? -4 : -5;
}

/** {date:'YYYY-MM-DD', min: minutes after midnight, dow: 0..6, ms} in New York. */
function tdToET(ms) {
  var off = tdEasternOffset(ms);
  var d = new Date(ms + off * 3600000);
  var iso = d.toISOString();
  return { date: iso.substring(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(),
           dow: d.getUTCDay(), ms: ms, offset: off };
}

function tdNowET() { return tdToET(Date.now()); }

/** {open: 570, close: 960|780, early: bool} or null if closed all day. */
function tdSession(dateStr) {
  var d = new Date(dateStr + "T12:00:00Z");
  var dow = d.getUTCDay();
  if (dow === 0 || dow === 6 || NYSE_HOLIDAYS[dateStr]) return null;
  var early = !!NYSE_EARLY_CLOSE[dateStr];
  return { open: 570, close: early ? 780 : 960, early: early };
}

function tdHHMM(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}
function tdParseHHMM(s) {
  var m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/** NY minutes → Bangkok "HH:MM" on a given NY date (for Thai users). */
function tdBkkClock(dateStr, nyMin) {
  var noonUtc = Date.parse(dateStr + "T12:00:00Z");
  var off = tdEasternOffset(noonUtc);
  var utcMs = Date.parse(dateStr + "T00:00:00Z") + (nyMin - off * 60) * 60000;
  var b = new Date(utcMs + 7 * 3600000);
  return tdHHMM(b.getUTCHours() * 60 + b.getUTCMinutes());
}

/** Market status now: {state: 'open'|'pre'|'after'|'closed', et, session} */
function tdMarketState() {
  var et = tdNowET();
  var s = tdSession(et.date);
  if (!s) return { state: "closed", et: et, session: null };
  if (et.min < s.open) return { state: "pre", et: et, session: s };
  if (et.min >= s.close) return { state: "after", et: et, session: s };
  return { state: "open", et: et, session: s };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  2. YAHOO DATA                                               ║
// ╚══════════════════════════════════════════════════════════════╝

function tdFetchJson_(path) {
  var hosts = ["query2", "query1"];
  for (var i = 0; i < hosts.length; i++) {
    try {
      var res = UrlFetchApp.fetch("https://" + hosts[i] + ".finance.yahoo.com" + path,
                                  { muteHttpExceptions: true, headers: { "User-Agent": TD_UA } });
      var code = res.getResponseCode();
      if (code === 200) return JSON.parse(res.getContentText());
      if (code === 429) Utilities.sleep(1500);
    } catch (e) {}
  }
  return null;
}

/**
 * Bars of a v8 chart: [{t (epoch s), date, min (NY), o,h,l,c,v}] with null closes dropped.
 * Also returns meta.
 */
function tdChart(symbol, range, interval) {
  var doc = tdFetchJson_("/v8/finance/chart/" + encodeURIComponent(symbol) +
                         "?range=" + range + "&interval=" + interval + "&includePrePost=false");
  var r = doc && doc.chart && doc.chart.result && doc.chart.result[0];
  if (!r) return null;
  var ts = r.timestamp || [];
  var q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  var bars = [];
  for (var i = 0; i < ts.length; i++) {
    if (q.close == null || q.close[i] == null) continue;
    var et = tdToET(ts[i] * 1000);
    bars.push({ t: ts[i], date: et.date, min: et.min,
                o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume && q.volume[i]) || 0 });
  }
  return { meta: r.meta || {}, bars: bars };
}

/** Today's (or the latest session's) completed 5-minute session bars, keyed by slot 0..77. */
function tdSessionBars5m_(chart, dateStr, nowMs) {
  var s = tdSession(dateStr);
  if (!s) return [];
  var out = [];
  chart.bars.forEach(function (b) {
    if (b.date !== dateStr) return;
    if (b.min < s.open || b.min >= s.close) return;
    if ((b.min - s.open) % 5 !== 0) return;                 // live tick off the grid
    if ((b.t + 300) * 1000 > nowMs) return;                  // bar still forming
    b.slot = (b.min - s.open) / 5;
    out.push(b);
  });
  return out;
}

/** Latest prices via spark, 20 symbols a request. → {SYM: {price, prev, vol}} */
function tdQuotes(symbols) {
  var out = {};
  var uniq = symbols.filter(function (s, i) { return s && symbols.indexOf(s) === i; });
  var reqs = [];
  for (var i = 0; i < uniq.length; i += 20) {
    var chunk = uniq.slice(i, i + 20);
    reqs.push({ url: "https://query2.finance.yahoo.com/v7/finance/spark?symbols=" +
                     chunk.map(encodeURIComponent).join(",") + "&range=1d&interval=5m",
                muteHttpExceptions: true, headers: { "User-Agent": TD_UA } });
  }
  if (!reqs.length) return out;
  UrlFetchApp.fetchAll(reqs).forEach(function (res) {
    try {
      var doc = JSON.parse(res.getContentText());
      (doc.spark.result || []).forEach(function (r) {
        var m = r.response && r.response[0] && r.response[0].meta;
        if (m && m.regularMarketPrice != null) {
          out[r.symbol] = { price: m.regularMarketPrice, prev: m.chartPreviousClose || m.previousClose,
                            vol: m.regularMarketVolume, time: m.regularMarketTime };
        }
      });
    } catch (e) {}
  });
  return out;
}

/** Daily closes (3 months) via spark for many symbols. → {SYM: {meta, closes:[{date,c}]}} */
function tdDailySpark_(symbols) {
  var out = {};
  var reqs = [];
  for (var i = 0; i < symbols.length; i += 20) {
    reqs.push({ url: "https://query2.finance.yahoo.com/v7/finance/spark?symbols=" +
                     symbols.slice(i, i + 20).map(encodeURIComponent).join(",") + "&range=3mo&interval=1d",
                muteHttpExceptions: true, headers: { "User-Agent": TD_UA } });
  }
  for (var b = 0; b < reqs.length; b += 10) {               // 10 parallel requests at a time
    UrlFetchApp.fetchAll(reqs.slice(b, b + 10)).forEach(function (res) {
      try {
        var doc = JSON.parse(res.getContentText());
        (doc.spark.result || []).forEach(function (r) {
          var x = r.response && r.response[0];
          if (!x) return;
          var cl = (x.indicators && x.indicators.quote && x.indicators.quote[0].close) || [];
          var rows = [];
          (x.timestamp || []).forEach(function (t, k) {
            if (cl[k] != null) rows.push({ date: tdToET(t * 1000).date, c: cl[k] });
          });
          out[r.symbol] = { meta: x.meta || {}, closes: rows };
        });
      } catch (e) {}
    });
  }
  return out;
}

function tdUniverse() {
  var p = PropertiesService.getScriptProperties().getProperty("SCAN_UNIVERSE");
  var list = p ? p.split(/[\s,]+/) : TD_UNIVERSE.slice();
  try { list = list.concat(storeAllWatchedSymbols()); } catch (e) {}
  var seen = {};
  return list.map(function (s) { return s.toUpperCase().trim(); })
             .filter(function (s) { if (!s || seen[s]) return false; seen[s] = true; return true; });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  MONEY MATH (integer cents, like the Decimal code)           ║
// ╚══════════════════════════════════════════════════════════════╝

function tdCents(x) { return Math.round(Number(x) * 100); }                       // half-up-ish to the cent
function tdFloorCents(x) { return Math.floor(Math.round(Number(x) * 1e6) / 1e4); } // round DOWN to the cent
function tdUsd(c) { return (c / 100).toFixed(2); }
function tdMoney(x) { return "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** Average true range of the last n bars (all if fewer). */
function tdAtr(bars, n) {
  n = n || 14;
  var trs = [], prev = null;
  bars.forEach(function (b) {
    var tr = b.h - b.l;
    if (prev !== null) tr = Math.max(tr, Math.abs(b.h - prev), Math.abs(b.l - prev));
    trs.push(tr);
    prev = b.c;
  });
  var use = trs.slice(-n);
  if (!use.length) return null;
  return { atr: use.reduce(function (a, b) { return a + b; }, 0) / use.length, bars: use.length };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  3. trader-exit — stop & target BEFORE the entry             ║
// ╚══════════════════════════════════════════════════════════════╝
/**
 * opts: { entry, stopRule: 'or_mid'|'or_low'|'price'|'pct'|'atr', stopParam,
 *         targetRule: 'r'|'price', targetParam, orHigh, orLow, atr, atrBars }
 * → {ok:true, entry, stop, target, risk, rr, stopLabel, targetLabel} (dollars)
 * → {ok:false, error}
 */
function tdComputeExit(o) {
  var e = tdCents(o.entry);
  if (!(e > 0)) return { ok: false, error: "ราคาเข้าต้องมากกว่า $0" };
  var raw, label;
  if (o.stopRule === "or_mid" || o.stopRule === "or_low") {
    if (o.orHigh == null || o.orLow == null) return { ok: false, error: "stop แบบ Opening Range ต้องมีกรอบ OR" };
    var oh = tdCents(o.orHigh), ol = tdCents(o.orLow);
    if (oh <= ol) return { ok: false, error: "กรอบ OR ไม่ถูกต้อง (high ต้องมากกว่า low)" };
    raw = o.stopRule === "or_mid" ? (oh + ol) / 2 : ol;
    label = o.stopRule === "or_mid" ? "กึ่งกลางกรอบเปิดตลาด (OR mid)" : "ก้นกรอบเปิดตลาด (OR low)";
  } else if (o.stopRule === "price") {
    raw = Number(o.stopParam) * 100; label = "ราคาที่กำหนดเอง";
  } else if (o.stopRule === "pct") {
    raw = e * (1 - Number(o.stopParam) / 100); label = o.stopParam + "% ใต้ราคาเข้า";
  } else if (o.stopRule === "atr") {
    if (o.atr == null) return { ok: false, error: "stop แบบ ATR ต้องมีข้อมูลแท่งเทียน" };
    raw = e - Number(o.stopParam) * o.atr * 100;
    label = o.stopParam + "×ATR(" + (o.atrBars || 14) + ") ใต้ราคาเข้า";
  } else {
    return { ok: false, error: "ไม่รู้จักกฎ stop: " + o.stopRule };
  }
  var stop = Math.floor(Math.round(raw * 1e4) / 1e4);   // a long's stop rounds DOWN, away from the entry
  if (stop >= e) return { ok: false, error: "Stop $" + tdUsd(stop) + " (" + label + ") อยู่เท่าหรือสูงกว่าราคาเข้า $" + tdUsd(e) + " — ขาซื้อ stop ต้องอยู่ใต้ราคาเข้า" };
  if (stop <= 0) return { ok: false, error: "Stop คำนวณได้ $" + tdUsd(stop) + " — เลือก stop ที่สูงกว่า $0" };
  var risk = e - stop;
  if (risk < e * TD_MIN_RISK_PCT / 100) {
    return { ok: false, error: "Stop ห่างราคาเข้าแค่ $" + tdUsd(risk) + " (< 0.05% ของราคา) แคบเกินไป โดน spread กินก็หลุดแล้ว — ขยาย stop ออก" };
  }
  var target, tLabel, tr = null;
  if (o.targetRule === "price") {
    target = tdCents(o.targetParam);
  } else {
    tr = Number(o.targetParam || 2);
    target = Math.round(e + tr * risk);
    tLabel = tr + "R";
  }
  if (target <= e) return { ok: false, error: "Target $" + tdUsd(target) + " ต้องสูงกว่าราคาเข้า $" + tdUsd(e) };
  var rr = Math.round((target - e) / risk * 100) / 100;
  if (!tLabel) tLabel = "ราคาที่กำหนดเอง (" + rr + "R)";
  return { ok: true, entry: e / 100, stop: stop / 100, target: target / 100, risk: risk / 100,
           rr: rr, targetR: tr || rr, stopLabel: label, targetLabel: tLabel };
}

/** "pct:1" | "atr:1.5" | "or-mid" | "or-low" | "358.32" → {rule, param} */
function tdParseStopRule(s) {
  s = String(s || "").toLowerCase().trim();
  if (s === "or-mid" || s === "ormid" || s === "mid") return { rule: "or_mid" };
  if (s === "or-low" || s === "orlow" || s === "low") return { rule: "or_low" };
  var m;
  if ((m = s.match(/^pct:?([\d.]+)%?$/)) || (m = s.match(/^([\d.]+)%$/))) return { rule: "pct", param: +m[1] };
  if ((m = s.match(/^atr:?([\d.]+)$/))) return { rule: "atr", param: +m[1] };
  if ((m = s.match(/^\$?([\d.]+)$/))) return { rule: "price", param: +m[1] };
  return null;
}
/** "2R" | "1.5r" | "370.04" → {rule, param} */
function tdParseTargetRule(s) {
  s = String(s || "").toLowerCase().trim();
  var m;
  if ((m = s.match(/^([\d.]+)r$/))) return { rule: "r", param: +m[1] };
  if ((m = s.match(/^\$?([\d.]+)$/))) return { rule: "price", param: +m[1] };
  return null;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  4. trader-budget — size to the max loss per trade           ║
// ╚══════════════════════════════════════════════════════════════╝
/**
 * plan {symbol, entry, stop, target}, cfg (merged with TD_DEFAULTS)
 * shares = floor(min(max loss / risk, position cap / entry, max order / entry, cash / entry))
 */
function tdSizeTrade(plan, cfg) {
  var c = tdMergeCfg(cfg);
  var sym = String(plan.symbol || "").toUpperCase();
  if ((c.blocked || []).map(function (b) { return String(b).toUpperCase(); }).indexOf(sym) !== -1) {
    return { qty: 0, refusal: sym + " อยู่ในรายชื่อที่คุณบล็อกไว้" };
  }
  var ref = tdCents(plan.entry), stop = tdCents(plan.stop), target = tdCents(plan.target);
  if (stop >= ref) return { qty: 0, refusal: "Stop ไม่ได้อยู่ใต้ราคาเข้า" };
  if (target <= ref) return { qty: 0, refusal: "Target ไม่ได้อยู่เหนือราคาเข้า — ราคาวิ่งไปแล้ว ข้ามไม้นี้หรือทำแผนใหม่" };
  var riskC = ref - stop, rewardC = target - ref;
  var budget = Number(c.budget) || 0;
  if (budget <= 0) return { qty: 0, refusal: "ยังไม่ได้ตั้งงบ — พิมพ์ ตั้งค่า budget 5000" };
  var buffer = Math.round(budget * Number(c.cash_buffer_pct || 0)) / 100;
  var available = Math.max(0, budget - buffer);

  var limits = [];
  var shares = function (usd, perCents) { return perCents > 0 ? Math.floor((usd * 100 + 1e-6) / perCents) : 0; };
  if (c.max_loss_per_trade_usd) limits.push({ name: "max loss", th: "ขาดทุนสูงสุดต่อไม้", shares: shares(Number(c.max_loss_per_trade_usd), riskC) });
  if (c.max_position_pct) limits.push({ name: "position cap", th: "เพดานต่อหุ้น " + c.max_position_pct + "%", shares: shares(budget * c.max_position_pct / 100, ref) });
  if (c.max_order_usd) limits.push({ name: "max order", th: "ยอดสั่งซื้อสูงสุด", shares: shares(Number(c.max_order_usd), ref) });
  limits.push({ name: "cash", th: "เงินสดหลังกันสำรอง", shares: shares(available, ref) });

  var qty = Math.max(0, Math.min.apply(null, limits.map(function (l) { return l.shares; })));
  var bound = limits.filter(function (l) { return l.shares === qty; })[0];
  var cost = qty * ref / 100;
  var maxLoss = qty * riskC / 100;
  var rr = Math.round(rewardC / riskC * 100) / 100;
  var refusal = null;
  if (qty === 0) {
    refusal = bound.name === "max loss"
      ? "หุ้น 1 ตัวเสี่ยง " + tdMoney(riskC / 100) + " มากกว่าขาดทุนสูงสุดต่อไม้ " + tdMoney(c.max_loss_per_trade_usd) + " ของคุณ — ข้ามไม้นี้ หรือวาง stop ให้ใกล้ขึ้น"
      : "หุ้น " + sym + " 1 ตัวราคา " + tdMoney(ref / 100) + " เกินวงเงิน (" + bound.th + ")";
  } else if (c.min_reward_risk && rewardC < c.min_reward_risk * riskC - 1e-9) {
    refusal = "Reward:Risk " + rr + " ต่ำกว่าขั้นต่ำ " + c.min_reward_risk + " ที่คุณตั้งไว้ — ข้ามไม้นี้หรือทำแผนใหม่";
  } else if (cost < Number(c.min_order_usd || 0)) {
    refusal = "ยอดซื้อ " + tdMoney(cost) + " ต่ำกว่าขั้นต่ำ " + tdMoney(c.min_order_usd);
  }
  return { symbol: sym, qty: refusal ? 0 : qty, rawQty: qty, boundBy: bound.name, boundTh: bound.th,
           entry: ref / 100, stop: stop / 100, target: target / 100, riskPerShare: riskC / 100,
           cost: cost, maxLoss: maxLoss, rr: rr, budget: budget, cashBuffer: buffer,
           available: available, limits: limits, refusal: refusal };
}

function tdMergeCfg(cfg) {
  var c = {};
  Object.keys(TD_DEFAULTS).forEach(function (k) { c[k] = TD_DEFAULTS[k]; });
  Object.keys(cfg || {}).forEach(function (k) { if (cfg[k] !== null && cfg[k] !== undefined) c[k] = cfg[k]; });
  return c;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  5. trader-risk — PASS / BLOCK before anything goes out      ║
// ╚══════════════════════════════════════════════════════════════╝
/**
 * sizing: tdSizeTrade result; today: {trades: n, riskUsd: x} (ไม้ที่ยืนยันวันนี้)
 * kind: 'day' (intraday, checks the entry window) | 'swing'
 */
function tdRiskCheck(sizing, cfg, today, kind) {
  var c = tdMergeCfg(cfg);
  var reasons = [], warns = [];
  today = today || { trades: 0, riskUsd: 0 };
  if (sizing.refusal) reasons.push("ขนาด: " + sizing.refusal);
  if (c.require_stop && !(sizing.stop > 0)) reasons.push("stop: ทุกไม้ต้องมี stop");
  if (sizing.stop >= sizing.entry) reasons.push("stop: ต้องอยู่ใต้ราคาเข้า");
  if (sizing.target <= sizing.entry) reasons.push("target: ต้องอยู่เหนือราคาเข้า");
  if (sizing.qty > 0) {
    if (sizing.maxLoss > Number(c.max_loss_per_trade_usd) + 0.005) {
      reasons.push("ขาดทุนต่อไม้: " + tdMoney(sizing.maxLoss) + " เกิน " + tdMoney(c.max_loss_per_trade_usd));
    }
    if (c.min_reward_risk && sizing.rr < Number(c.min_reward_risk) - 1e-9) {
      reasons.push("Reward:Risk " + sizing.rr + " ต่ำกว่าขั้นต่ำ " + c.min_reward_risk);
    }
    var dayRisk = Number(today.riskUsd || 0) + sizing.maxLoss;
    if (c.max_daily_loss_usd && dayRisk > Number(c.max_daily_loss_usd) + 0.005) {
      reasons.push("ขาดทุนรวมวันนี้: เสี่ยงไปแล้ว " + tdMoney(today.riskUsd || 0) + " + ไม้นี้ " + tdMoney(sizing.maxLoss) +
                   " = " + tdMoney(dayRisk) + " เกินลิมิตรายวัน " + tdMoney(c.max_daily_loss_usd));
    }
    if (c.max_trades_per_day && (today.trades || 0) >= Number(c.max_trades_per_day)) {
      reasons.push("จำนวนไม้: วันนี้ยืนยันไปแล้ว " + today.trades + " ไม้ ครบลิมิต " + c.max_trades_per_day + " ไม้/วัน");
    }
    if (sizing.cost > Number(c.max_order_usd) + 0.005) reasons.push("ยอดสั่งซื้อ " + tdMoney(sizing.cost) + " เกิน " + tdMoney(c.max_order_usd));
  }
  if (kind === "day") {
    var ms = tdMarketState();
    var before = tdParseHHMM(c.no_entries_before), after = tdParseHHMM(c.no_entries_after);
    if (ms.state !== "open") {
      warns.push("ตลาดยังไม่เปิด/ปิดแล้ว (" + ms.et.date + " " + tdHHMM(ms.et.min) + " NY) — แผนนี้ใช้ได้เมื่อตลาดเปิดเท่านั้น");
    } else {
      if (ms.session.early && after !== null) { after -= 180; warns.push("วันนี้ตลาดปิดเร็ว 13:00 NY"); }
      if (before !== null && ms.et.min < before) reasons.push("ช่วงเวลา: ห้ามเข้าก่อน " + c.no_entries_before + " NY (ตอนนี้ " + tdHHMM(ms.et.min) + ")");
      if (after !== null && ms.et.min > after) reasons.push("ช่วงเวลา: ห้ามเข้าหลัง " + tdHHMM(after) + " NY (ตอนนี้ " + tdHHMM(ms.et.min) + ")");
    }
  }
  warns.push("Stop คือแผน ไม่ใช่การรับประกัน — ตลาดเร็วหรือ gap อาจหลุดเลย stop ได้");
  return { verdict: reasons.length ? "BLOCK" : "PASS", reasons: reasons, warnings: warns };
}

/** ไม้ที่ผู้ใช้ "ยืนยัน" วันนี้ → {trades, riskUsd} สำหรับลิมิตรายวัน */
function tdTodayLog(userId) {
  var et = tdNowET();
  var taken = [];
  try { taken = storeGetPlans(userId, et.date, "taken"); } catch (e) {}
  var risk = 0;
  taken.forEach(function (p) { risk += Number((p.plan && p.plan.max_loss) || 0); });
  return { trades: taken.length, riskUsd: Math.round(risk * 100) / 100 };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  6. trader-entry — opening-range breakout, bar by bar        ║
// ╚══════════════════════════════════════════════════════════════╝
/**
 * → {status: 'closed'|'not_open'|'forming'|'waiting'|'triggered'|'expired'|'error',
 *    orHigh, orLow, price, entry, entryMin, distancePct, bars}
 * Entry = first COMPLETED 5-min bar after the range that CLOSES above the range high
 * (or above `level` when given).
 */
function tdEntryCheck(symbol, orMinutes, level, cfg) {
  orMinutes = orMinutes || 15;
  var c = tdMergeCfg(cfg);
  var ms = tdMarketState();
  if (!ms.session) return { status: "closed", reason: NYSE_HOLIDAYS[ms.et.date] || "วันหยุดสุดสัปดาห์" };
  if (ms.state === "pre") return { status: "not_open", opensBkk: tdBkkClock(ms.et.date, ms.session.open) };
  var chart = tdChart(symbol, "1d", "5m");
  if (!chart || !chart.bars.length) return { status: "error", error: "ดึงแท่ง 5 นาทีของ " + symbol + " ไม่ได้" };
  var bars = tdSessionBars5m_(chart, ms.et.date, Date.now());
  var n = orMinutes / 5;
  var price = chart.meta.regularMarketPrice || (bars.length ? bars[bars.length - 1].c : null);
  if (bars.length < n) return { status: "forming", price: price, bars: bars.length, needed: n };
  var orBars = bars.slice(0, n);
  var orHigh = Math.max.apply(null, orBars.map(function (b) { return b.h; }));
  var orLow  = Math.min.apply(null, orBars.map(function (b) { return b.l; }));
  var trigger = level != null ? Number(level) : orHigh;
  var after = tdParseHHMM(c.no_entries_after) || 930;
  if (ms.session.early) after -= 180;
  for (var i = n; i < bars.length; i++) {
    var closeMin = bars[i].min + 5;
    if (closeMin > after) break;
    if (bars[i].c > trigger) {
      return { status: "triggered", orHigh: orHigh, orLow: orLow, trigger: trigger, entry: Math.round(bars[i].c * 100) / 100,
               entryMin: closeMin, entryBkk: tdBkkClock(ms.et.date, closeMin), price: price, bars: bars, date: ms.et.date,
               vol: bars[i].v, volAvg: tdAvg_(bars.slice(0, i).map(function (b) { return b.v; })) };
    }
  }
  var lastMin = bars[bars.length - 1].min + 5;
  if (ms.state === "after" || lastMin > after) {
    return { status: "expired", orHigh: orHigh, orLow: orLow, trigger: trigger, price: price, date: ms.et.date };
  }
  return { status: "waiting", orHigh: orHigh, orLow: orLow, trigger: trigger, price: price, date: ms.et.date,
           distancePct: price ? (trigger - price) / price * 100 : null, bars: bars };
}

function tdAvg_(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

// ╔══════════════════════════════════════════════════════════════╗
// ║  7. trader-scanner                                           ║
// ╚══════════════════════════════════════════════════════════════╝

/** Wilder RSI 14 on closes (oldest first). */
function tdRsi(c, n) {
  n = n || 14;
  if (c.length < n + 1) return null;
  var ag = 0, al = 0, i;
  for (i = 1; i <= n; i++) { var d = c[i] - c[i - 1]; ag += Math.max(0, d); al += Math.max(0, -d); }
  ag /= n; al /= n;
  for (i = n + 1; i < c.length; i++) {
    var d2 = c[i] - c[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d2)) / n;
    al = (al * (n - 1) + Math.max(0, -d2)) / n;
  }
  return al ? 100 - 100 / (1 + ag / al) : 100;
}

/** Same rules as scan.py find_setups (closes oldest first, >= 30). */
function tdFindSetups(c) {
  var last = c[c.length - 1];
  var hi20 = Math.max.apply(null, c.slice(-21, -1));
  var ma20 = tdAvg_(c.slice(-20));
  var ma20Prev = tdAvg_(c.slice(-21, -1));
  var run = c[c.length - 6] / c[c.length - 16] - 1;
  var last5 = c.slice(-5);
  var rng5 = (Math.max.apply(null, last5) - Math.min.apply(null, last5)) / last;
  var r = tdRsi(c), rPrev = tdRsi(c.slice(0, -1));
  var tags = [];
  if (last > hi20) tags.push("breakout_20d");
  if (run > 0.10 && rng5 < 0.05) tags.push("bull_flag");
  if (c[c.length - 2] < ma20Prev && last > ma20) tags.push("reclaim_ma20");
  if (r !== null && r < 30) tags.push("oversold");
  if (rPrev !== null && rPrev < 30 && last > c[c.length - 2]) tags.push("oversold_bounce");
  return { tags: tags, rsi: r, high20: hi20, ma20: ma20, runPct: run * 100, range5Pct: rng5 * 100 };
}

var TD_SETUP_TH = {
  breakout_20d: "ทะลุจุดสูงสุด 20 วัน", bull_flag: "ธงขาขึ้น (Bull flag)", reclaim_ma20: "ยืนกลับเหนือ MA20",
  oversold: "Oversold (RSI<30)", oversold_bounce: "เด้งจาก Oversold", orb: "ทะลุกรอบเปิดตลาด (ORB)"
};

/** Pre-market scan of daily closes. → {hits:[{symbol, setups, price, rsi, volume}], counts} */
function tdScanDaily(symbols, minPrice, minVolume) {
  minPrice = minPrice == null ? 5 : minPrice;
  minVolume = minVolume == null ? 1000000 : minVolume;
  symbols = symbols || tdUniverse();
  var data = tdDailySpark_(symbols);
  var ms = tdMarketState();
  var todayDone = !ms.session || ms.state === "after";
  var hits = [], counts = { requested: symbols.length, fetched: 0, illiquid: 0, short: 0, scanned: 0 };
  symbols.forEach(function (sym) {
    var s = data[sym];
    if (!s) return;
    counts.fetched++;
    var rows = s.closes.filter(function (r) { return todayDone || r.date !== ms.et.date; });  // drop today's unfinished bar
    var price = s.meta.regularMarketPrice != null ? s.meta.regularMarketPrice : (rows.length ? rows[rows.length - 1].c : null);
    var vol = s.meta.regularMarketVolume;
    if (price == null || price < minPrice || (minVolume > 0 && (vol == null || vol < minVolume))) { counts.illiquid++; return; }
    if (rows.length < 30) { counts.short++; return; }
    counts.scanned++;
    var closes = rows.map(function (r) { return r.c; });
    var f = tdFindSetups(closes);
    if (f.tags.length) {
      hits.push({ symbol: sym, setups: f.tags, price: Math.round(closes[closes.length - 1] * 100) / 100,
                  closeDate: rows[rows.length - 1].date, rsi: Math.round(f.rsi * 10) / 10, volume: vol || 0 });
    }
  });
  hits.sort(function (a, b) { return b.price * b.volume - a.price * a.volume; });
  counts.hits = hits.length;
  return { hits: hits, counts: counts };
}

/**
 * Opening-range breakouts so far today (5-min bars). Two stages like scan.py:
 *  1) spark closes for every symbol → candidates where a bar after the range closed >= highest OR close
 *  2) v8 chart (real highs) for up to maxConfirm candidates → first close above the OR high
 */
function tdScanOrb(symbols, orMinutes, maxConfirm) {
  orMinutes = orMinutes || 15; maxConfirm = maxConfirm || 25;
  var ms = tdMarketState();
  if (!ms.session) return { error: "ตลาดปิด (" + (NYSE_HOLIDAYS[ms.et.date] || "วันหยุด") + ")" };
  if (ms.state === "pre") return { error: "ตลาดยังไม่เปิด — เปิด " + tdBkkClock(ms.et.date, ms.session.open) + " น. เวลาไทย" };
  var n = orMinutes / 5;
  if (ms.state === "open" && ms.et.min < ms.session.open + orMinutes + 5) {
    return { error: "รอให้กรอบเปิดตลาด " + orMinutes + " นาทีปิดก่อน (หลัง " + tdBkkClock(ms.et.date, ms.session.open + orMinutes + 5) + " น. เวลาไทย)" };
  }
  symbols = symbols || tdUniverse();
  // stage 1
  var cands = [];
  var reqs = [];
  for (var i = 0; i < symbols.length; i += 20) {
    reqs.push({ url: "https://query2.finance.yahoo.com/v7/finance/spark?symbols=" +
                     symbols.slice(i, i + 20).map(encodeURIComponent).join(",") + "&range=1d&interval=5m",
                muteHttpExceptions: true, headers: { "User-Agent": TD_UA } });
  }
  UrlFetchApp.fetchAll(reqs).forEach(function (res) {
    try {
      JSON.parse(res.getContentText()).spark.result.forEach(function (r) {
        var x = r.response && r.response[0];
        if (!x || !x.timestamp) return;
        var cl = x.indicators.quote[0].close, closes = [];
        x.timestamp.forEach(function (t, k) {
          var et = tdToET(t * 1000);
          if (cl[k] == null || et.date !== ms.et.date || et.min < 570 || (et.min - 570) % 5 !== 0) return;
          if ((t + 300) * 1000 > Date.now()) return;
          closes.push(cl[k]);
        });
        if (closes.length <= n) return;
        var orTop = Math.max.apply(null, closes.slice(0, n));
        var price = x.meta.regularMarketPrice || closes[closes.length - 1];
        if (price < 5) return;
        if (closes.slice(n).some(function (c) { return c >= orTop; })) {
          cands.push({ symbol: r.symbol, dollars: price * (x.meta.regularMarketVolume || 0) });
        }
      });
    } catch (e) {}
  });
  cands.sort(function (a, b) { return b.dollars - a.dollars; });
  // stage 2
  var hits = [];
  var take = cands.slice(0, maxConfirm);
  var creqs = take.map(function (c) {
    return { url: "https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(c.symbol) + "?range=1d&interval=5m",
             muteHttpExceptions: true, headers: { "User-Agent": TD_UA } };
  });
  UrlFetchApp.fetchAll(creqs).forEach(function (res, k) {
    try {
      var r = JSON.parse(res.getContentText()).chart.result[0];
      var q = r.indicators.quote[0];
      var chart = { meta: r.meta, bars: [] };
      r.timestamp.forEach(function (t, j) {
        if (q.close[j] == null) return;
        var et = tdToET(t * 1000);
        chart.bars.push({ t: t, date: et.date, min: et.min, o: q.open[j], h: q.high[j], l: q.low[j], c: q.close[j], v: q.volume[j] || 0 });
      });
      var bars = tdSessionBars5m_(chart, ms.et.date, Date.now());
      if (bars.length <= n) return;
      var oh = Math.max.apply(null, bars.slice(0, n).map(function (b) { return b.h; }));
      var ol = Math.min.apply(null, bars.slice(0, n).map(function (b) { return b.l; }));
      for (var j = n; j < bars.length; j++) {
        if (bars[j].c > oh) {
          hits.push({ symbol: take[k].symbol, orHigh: oh, orLow: ol, entry: Math.round(bars[j].c * 100) / 100,
                      entryMin: bars[j].min + 5, overPct: (bars[j].c / oh - 1) * 100, price: r.meta.regularMarketPrice });
          break;
        }
      }
    } catch (e) {}
  });
  return { hits: hits, candidates: cands.length, confirmed: take.length, partial: cands.length > take.length, date: ms.et.date };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  8. trader-timemachine — 10,000 replays + history            ║
// ╚══════════════════════════════════════════════════════════════╝

/** Seeded RNG (mulberry32) so the same plan + seed gives the same numbers. */
function tdRng_(seed) {
  var a = seed >>> 0;
  var next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next: next, int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); } };
}

/**
 * plan: {symbol, entry, stop, target, targetR, orMinutes, stopRule ('or_mid'|'or_low'|'pct'), stopPct,
 *        entrySlot (index of the entry bar's close in today's session, -1 = before the open)}
 * Uses 60 days of 5-minute bars. → result doc or {error}
 */
function tdTimeMachine(plan, replays, seed, windowSlots) {
  replays = replays || 10000; seed = seed || 19; windowSlots = windowSlots == null ? 2 : windowSlots;
  var chart = tdChart(plan.symbol, "60d", "5m");
  if (!chart || !chart.bars.length) return { error: "ดึงแท่ง 5 นาที 60 วันของ " + plan.symbol + " ไม่ได้" };
  var today = tdNowET().date;
  // full sessions before today: exactly 78 bars, 9:30–16:00
  var byDay = {};
  chart.bars.forEach(function (b) {
    if (b.date >= today || b.min < 570 || b.min >= 960 || (b.min - 570) % 5 !== 0) return;
    (byDay[b.date] = byDay[b.date] || {})[(b.min - 570) / 5] = b;
  });
  var sessions = [];
  Object.keys(byDay).sort().forEach(function (d) {
    var s = tdSession(d);
    if (!s || s.early) return;
    var D = byDay[d], arr = [];
    for (var i = 0; i < TD_SESSION_BARS; i++) { if (!D[i]) return; arr.push(D[i]); }
    sessions.push({ date: d, bars: arr });
  });
  if (sessions.length < 20) return { error: "มีวันเทรดเต็มวันแค่ " + sessions.length + " วัน (ต้องการอย่างน้อย 20)" };

  // pool[i] = every past session's bar i as ratios to bar i-1's close
  var pool = [];
  for (var i = 0; i < TD_SESSION_BARS; i++) pool.push([]);
  sessions.forEach(function (S) {
    for (var i = 1; i < TD_SESSION_BARS; i++) {
      var pc = S.bars[i - 1].c, b = S.bars[i];
      pool[i].push([b.o / pc, b.h / pc, b.l / pc, b.c / pc]);
    }
  });

  var last = TD_SESSION_BARS - 1;
  var flat = tdParseHHMM(plan.flatBy || TD_DEFAULTS.flat_by);
  if (flat) last = Math.min(last, Math.floor((flat - 570) / 5) - 1);
  var k = plan.entrySlot != null && plan.entrySlot >= 0 ? plan.entrySlot : (plan.orMinutes || 15) / 5 - 1;
  if (k >= last) return { error: "เหลือเวลาในวันไม่พอให้จำลอง" };

  var entry = plan.entry, stop = plan.stop, target = plan.target;
  var risk = entry - stop;
  var rT = Math.round((target - entry) / risk * 10000) / 10000;
  var rng = tdRng_(seed);
  var slot = function (i) { return windowSlots === 0 ? i : Math.min(TD_SESSION_BARS - 1, Math.max(1, i + rng.int(-windowSlots, windowSlots))); };
  var cnt = { target: 0, stop: 0, close: 0 }, green = 0, sumR = 0, closes = [];
  for (var n = 0; n < replays; n++) {
    var p = entry, outcome = null;
    for (var j = k + 1; j <= last; j++) {
      var arr = pool[slot(j)];
      var bar = arr[Math.floor(rng.next() * arr.length)];
      if (outcome === null) {
        if (p * bar[2] <= stop) outcome = "stop";            // both in one bar → count the loss
        else if (p * bar[1] >= target) outcome = "target";
      }
      p = p * bar[3];
    }
    outcome = outcome || "close";
    cnt[outcome]++;
    if (outcome === "target" || (outcome === "close" && p > entry)) green++;
    sumR += outcome === "target" ? rT : outcome === "stop" ? -1 : (p - entry) / risk;
    closes.push(p);
  }
  closes.sort(function (a, b) { return a - b; });
  var pct = function (q) { return closes[Math.min(closes.length - 1, Math.floor(q * closes.length))]; };
  var mc = { replays: replays, seed: seed, barsLeft: last - k, pTarget: cnt.target / replays, pStop: cnt.stop / replays,
             pNeither: cnt.close / replays, pGreen: green / replays, avgR: sumR / replays, rAtTarget: rT,
             median: pct(0.5), p5: pct(0.05), p95: pct(0.95), untilMin: 570 + (last + 1) * 5 };

  // history: the same ORB rule on every past full session
  var orN = (plan.orMinutes || 15) / 5;
  var trades = [];
  sessions.forEach(function (S) {
    var D = S.bars;
    var oh = Math.max.apply(null, D.slice(0, orN).map(function (b) { return b.h; }));
    var ol = Math.min.apply(null, D.slice(0, orN).map(function (b) { return b.l; }));
    var kk = -1;
    for (var i = orN; i <= last; i++) { if (D[i].c > oh) { kk = i; break; } }
    if (kk < 0) return;
    var e = Math.round(D[kk].c * 100) / 100;
    var s = plan.stopRule === "or_low" ? ol : plan.stopRule === "pct" ? e * (1 - (plan.stopPct || 1) / 100) : (oh + ol) / 2;
    s = Math.floor(Math.round(s * 1e6) / 1e4) / 100;
    var rk = e - s;
    if (rk <= 0) return;
    var t = Math.round((e + (plan.targetR || rT) * rk) * 100) / 100;
    var oc = null;
    for (var b = kk + 1; b <= last; b++) {
      if (D[b].l <= s) { oc = "stop"; break; }
      if (D[b].h >= t) { oc = "target"; break; }
    }
    var R = oc === "target" ? (t - e) / rk : oc === "stop" ? -1 : (D[last].c - e) / rk;
    trades.push({ date: S.date, outcome: oc || "close", R: R });
  });
  var hist = { sessions: sessions.length, triggered: trades.length,
               target: trades.filter(function (x) { return x.outcome === "target"; }).length,
               stop: trades.filter(function (x) { return x.outcome === "stop"; }).length,
               close: trades.filter(function (x) { return x.outcome === "close"; }).length,
               avgR: trades.length ? tdAvg_(trades.map(function (x) { return x.R; })) : null };
  return { mc: mc, history: hist, verdict: tdTmVerdict_(mc), sessions: sessions.length };
}

/** Verdict thresholds from timemachine.py: <5 pts coin flip, 5–15 lean, >=15 strong. */
function tdTmVerdict_(mc) {
  var pt = mc.pTarget, ps = mc.pStop;
  if (pt + ps <= 0) return { code: "none", th: "ไม่มีรอบไหนแตะ target หรือ stop เลย ราคาตอนปิดเป็นตัวตัดสินทั้งหมด" };
  var r = mc.rAtTarget || 1;
  var share = pt / (pt + ps), even = 1 / (1 + r), d = share - even;
  var th;
  if (Math.abs(d) < 0.05) th = Math.abs(r - 1) < 0.005 ? "ใกล้เคียงโยนเหรียญ" : "ใกล้จุดคุ้มทุน";
  else if (Math.abs(d) < 0.15) th = d > 0 ? "เอียงไปทาง Target" : "เอียงไปทาง Stop";
  else th = d > 0 ? "เอียงไปทาง Target ชัดเจน" : "เอียงไปทาง Stop ชัดเจน";
  return { code: d > 0 ? "target" : "stop", th: th, share: share, even: even, gap: d };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  9. trader-alerts — level check                              ║
// ╚══════════════════════════════════════════════════════════════╝

/** Does an alert ring at this quote? (bell / flat_by handled by the tick job) */
function tdAlertHit(a, q) {
  if (!q || q.price == null) return false;
  var lv = Number(a.level);
  switch (a.kind) {
    case "above": case "target": return q.price >= lv;
    case "below": case "stop":   return q.price <= lv;
    case "pct_up":   return q.prev ? (q.price / q.prev - 1) * 100 >= lv : false;
    case "pct_down": return q.prev ? (1 - q.price / q.prev) * 100 >= lv : false;
  }
  return false;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  10. trader-news — headlines + SEC 8-K, tagged               ║
// ╚══════════════════════════════════════════════════════════════╝

var TD_NEWS_TAGS = [
  ["earnings", /\bearnings\b|\bresults\b|\bEPS\b|\bguidance\b|\bforecast\b/i, "งบ"],
  ["analyst", /\bupgrade[sd]?\b|\bdowngrade[sd]?\b|price target|\boutperform\b|\bunderperform\b/i, "นักวิเคราะห์"],
  ["legal", /\blawsuit\b|\bsued\b|\bprobe\b|\binvestigation\b|\bSEC charges\b|\bantitrust\b|\bjudge\b|\bcourt\b/i, "กฎหมาย"],
  ["deal", /\bacqui(?:re|res|red|sition)\b|\bmerger\b|\bbuyout\b|\btakeover\b|\bdeal\b/i, "ดีล"],
  ["capital", /\bdividend\b|\bbuyback\b|\brepurchase\b|\bstock split\b|\boffering\b/i, "ทุน/ปันผล"],
  ["people", /\bCEO\b|\bCFO\b|\bresign|\bsteps down\b|\bappoint/i, "ผู้บริหาร"],
  ["risk", /\brecall\b|\bbankrupt|\bdefault\b|\bdelist|\bhack|\bbreach\b|\boutage\b/i, "ความเสี่ยง"],
  ["halt", /\bhalt(?:s|ed)?\b|\btrading (?:pause|suspen)/i, "หยุดซื้อขาย"],
  ["regulatory", /\bFDA\b|\bapproval\b|\bapproves\b|\bclinical\b|\bFTC\b|\bDOJ\b/i, "หน่วยงานรัฐ"],
  ["macro", /\bFed\b|\bFOMC\b|\bCPI\b|\binflation\b|\bjobs report\b|\bpayrolls\b|\btariffs?\b|\bfutures\b/i, "มหภาค"]
];
var TD_8K_ITEMS = {
  "1.01": "สัญญาสำคัญ", "1.02": "ยกเลิกสัญญา", "1.03": "ล้มละลาย", "1.05": "เหตุไซเบอร์",
  "2.01": "ซื้อ/ขายสินทรัพย์", "2.02": "ประกาศงบ", "2.03": "หนี้ใหม่", "2.04": "หนี้ถูกเร่งชำระ",
  "2.05": "ต้นทุนปรับโครงสร้าง", "2.06": "ด้อยค่าสินทรัพย์", "3.01": "แจ้งเตือนเพิกถอน",
  "3.02": "ขายหุ้นนอกตลาด", "3.03": "เปลี่ยนสิทธิผู้ถือหุ้น", "4.01": "เปลี่ยนผู้สอบบัญชี",
  "4.02": "งบเก่าเชื่อถือไม่ได้", "5.01": "เปลี่ยนผู้ควบคุม", "5.02": "เปลี่ยนกรรมการ/ผู้บริหาร",
  "5.03": "แก้ข้อบังคับ", "5.07": "ผลโหวตผู้ถือหุ้น", "7.01": "เปิดเผยข้อมูล Reg FD", "8.01": "เหตุการณ์อื่น"
};
var TD_8K_IMPORTANT = ["1.03", "1.05", "2.02", "2.04", "2.06", "3.01", "4.02", "5.01", "5.02"];

function tdTagHeadline(title) {
  return TD_NEWS_TAGS.filter(function (t) { return t[1].test(title); }).map(function (t) { return t[2]; });
}

function tdSecUA_() {
  var ua = PropertiesService.getScriptProperties().getProperty("SEC_USER_AGENT") || "";
  return (ua && ua.indexOf("@") > 0 && ua.indexOf("example.com") < 0) ? ua : null;
}

/** Ticker → zero-padded CIK (cached 6 h). */
function tdCik(symbol) {
  var ua = tdSecUA_();
  if (!ua) return null;
  var cache = CacheService.getScriptCache();
  var key = "CIK_" + symbol.toUpperCase();
  var hit = cache.get(key);
  if (hit) return hit;
  try {
    var res = UrlFetchApp.fetch("https://www.sec.gov/files/company_tickers.json",
                                { muteHttpExceptions: true, headers: { "User-Agent": ua } });
    var doc = JSON.parse(res.getContentText());
    var found = null, put = {};
    Object.keys(doc).forEach(function (k) {
      var row = doc[k];
      var t = String(row.ticker).toUpperCase().replace("-", ".");
      var cik = ("0000000000" + row.cik_str).slice(-10);
      if (["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AMD","NFLX","AVGO"].indexOf(t) >= 0) put["CIK_" + t] = cik;
      if (t === symbol.toUpperCase().replace("-", ".")) found = cik;
    });
    if (found) put[key] = found;
    cache.putAll(put, 21600);
    return found;
  } catch (e) { return null; }
}

/** Yahoo headlines + 8-K filings for one ticker within `hours`. */
function tdNews(symbol, hours) {
  hours = hours || 24;
  var since = Date.now() - hours * 3600000;
  var items = [];
  try {
    var rss = UrlFetchApp.fetch("https://finance.yahoo.com/rss/headline?s=" + encodeURIComponent(symbol),
                                { muteHttpExceptions: true, headers: { "User-Agent": TD_UA } }).getContentText();
    (rss.match(/<item>[\s\S]*?<\/item>/g) || []).forEach(function (blk) {
      var t = (blk.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
      var d = (blk.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
      var l = (blk.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      t = t.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      var ms = d ? Date.parse(d) : NaN;
      if (t && (!isFinite(ms) || ms >= since)) items.push({ kind: "headline", title: t, ms: ms, link: l, tags: tdTagHeadline(t) });
    });
  } catch (e) {}
  var ua = tdSecUA_(), cik = ua ? tdCik(symbol) : null;
  if (cik) {
    try {
      var atom = UrlFetchApp.fetch("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + cik +
                                   "&type=8-K&dateb=&owner=include&count=10&output=atom",
                                   { muteHttpExceptions: true, headers: { "User-Agent": ua } }).getContentText();
      (atom.match(/<entry>[\s\S]*?<\/entry>/g) || []).forEach(function (blk) {
        var upd = (blk.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1];
        var ms = upd ? Date.parse(upd) : NaN;
        if (isFinite(ms) && ms < since) return;
        var summary = ((blk.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "").replace(/&lt;[^&]*&gt;/g, " ");
        var codes = (summary.match(/\b\d\.\d{2}\b/g) || []).filter(function (c, i, a) { return c !== "9.01" && a.indexOf(c) === i; });
        var link = (blk.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
        items.push({ kind: "8-K", title: "8-K: " + (codes.map(function (c) { return TD_8K_ITEMS[c] || ("item " + c); }).join(", ") || "filing"),
                     ms: ms, link: link, items: codes,
                     important: codes.some(function (c) { return TD_8K_IMPORTANT.indexOf(c) >= 0; }),
                     tags: codes.indexOf("2.02") >= 0 ? ["งบ"] : [] });
      });
    } catch (e) {}
  }
  items.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
  var q = tdQuotes([symbol])[symbol];
  return { symbol: symbol, items: items.slice(0, 12), quote: q, secEnabled: !!cik,
           movePct: q && q.prev ? (q.price / q.prev - 1) * 100 : null };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  11. trader-analyst — reported numbers from SEC XBRL         ║
// ╚══════════════════════════════════════════════════════════════╝

var TD_CONCEPTS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenuesNetOfInterestExpense",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  gross_profit: ["GrossProfit"],
  operating_income: ["OperatingIncomeLoss"],
  net_income: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  eps_diluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]
};

/** Quarterly numbers (SEC frames CYyyyyQn) with YoY. → {name, quarters:[{q, revenue,...,yoy}], error} */
function tdEarnings(symbol) {
  var ua = tdSecUA_();
  if (!ua) return { error: "ต้องตั้ง Script Property SEC_USER_AGENT = \"ชื่อ อีเมล\" ก่อน (SEC บังคับ)" };
  var cik = tdCik(symbol);
  if (!cik) return { error: "ไม่พบ " + symbol + " ในรายชื่อบริษัทของ SEC (อาจเป็น ETF/หุ้นต่างประเทศ)" };
  var doc;
  try {
    var res = UrlFetchApp.fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json",
                                { muteHttpExceptions: true, headers: { "User-Agent": ua } });
    if (res.getResponseCode() !== 200) return { error: "SEC ตอบ " + res.getResponseCode() };
    doc = JSON.parse(res.getContentText());
  } catch (e) { return { error: "อ่านข้อมูล SEC ไม่ได้: " + e }; }
  var gaap = (doc.facts && doc.facts["us-gaap"]) || {};
  var byQ = {};
  Object.keys(TD_CONCEPTS).forEach(function (metric) {
    var names = TD_CONCEPTS[metric];
    for (var i = 0; i < names.length; i++) {
      var f = gaap[names[i]];
      if (!f || !f.units) continue;
      var unit = f.units.USD || f.units["USD/shares"];
      if (!unit) continue;
      var got = false;
      unit.forEach(function (u) {
        if (!u.frame || !/^CY\d{4}Q\d$/.test(u.frame)) return;     // discrete quarters only
        (byQ[u.frame] = byQ[u.frame] || { q: u.frame.substring(2), end: u.end, form: u.form, filed: u.filed });
        if (byQ[u.frame][metric] == null) { byQ[u.frame][metric] = u.val; got = true; }
      });
      if (got) break;
    }
  });
  var keys = Object.keys(byQ).sort();
  var rows = keys.map(function (k) { return byQ[k]; }).filter(function (r) { return r.revenue != null || r.net_income != null; });
  rows.forEach(function (r) {
    var py = byQ["CY" + (Number(r.q.substring(0, 4)) - 1) + r.q.substring(4)];
    r.yoy = {};
    ["revenue", "net_income", "eps_diluted", "operating_income"].forEach(function (m) {
      if (py && py[m] && r[m] != null) r.yoy[m] = (r[m] - py[m]) / Math.abs(py[m]) * 100;
    });
    if (r.revenue) {
      if (r.gross_profit != null) r.gross_margin = r.gross_profit / r.revenue * 100;
      if (r.operating_income != null) r.op_margin = r.operating_income / r.revenue * 100;
      if (r.net_income != null) r.net_margin = r.net_income / r.revenue * 100;
    }
  });
  var last4 = rows.slice(-4);
  var ttm = null;
  if (last4.length === 4 && last4.every(function (r) { return r.revenue != null; })) {
    ttm = { revenue: last4.reduce(function (a, r) { return a + r.revenue; }, 0),
            net_income: last4.every(function (r) { return r.net_income != null; }) ? last4.reduce(function (a, r) { return a + r.net_income; }, 0) : null };
  }
  return { symbol: symbol, name: doc.entityName, quarters: rows.slice(-5), ttm: ttm };
}
