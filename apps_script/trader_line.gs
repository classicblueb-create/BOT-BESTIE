// @ts-nocheck
/**
 * ============================================================
 * BESTIE BOT — TRADER COMMANDS สำหรับ LINE
 * ============================================================
 * ต่อจาก trader_core.gs + supabase_store.gs
 * doPost (ไฟล์หลัก) เรียก handleTraderCommand(userInput, userId, replyToken) ก่อน route อื่น
 *
 * คำสั่ง (พิมพ์ใน LINE):
 *   เทรดเดอร์ / trader             เมนูคำสั่งทั้งหมด
 *   สแกน / scan                    สแกนหุ้นรายวัน (Breakout 20 วัน, Bull flag, MA20, Oversold)
 *   สแกน orb / orb                 หุ้นที่ทะลุกรอบเปิดตลาด 15 นาทีวันนี้
 *   เข้าไหม TSLA / entry TSLA      สถานะจุดเข้า ORB: รอ / ทะลุแล้ว / หมดเวลา
 *   แผน TSLA [stop] [target]       Stop/Target/จำนวนหุ้น/ตรวจความเสี่ยง (เช่น แผน TSLA atr:1.5 2R)
 *   แผน TSLA 364.18 358.32 370.04  แผนจากราคาที่กำหนดเอง (เข้า / stop / target)
 *   โอกาส TSLA / odds TSLA         Time Machine จำลอง 10,000 รอบ + ย้อนดูอดีต
 *   เตือน TSLA > 370 | < 350 | +5% | -5%   ตั้งเตือนราคา
 *   เตือนแผน TSLA                  เตือน stop + target + ปิดสถานะก่อนตลาดปิด จากแผนล่าสุด
 *   เตือนเปิดตลาด                  เตือนตอนตลาด US เปิด
 *   เตือน / รายการเตือน             ดูการเตือนที่ตั้งไว้
 *   ยกเลิกเตือน 12 | ทั้งหมด        ยกเลิกการเตือน
 *   ข่าว TSLA / news TSLA          ข่าว + 8-K ติดแท็ก + % จากราคาปิดเมื่อวาน
 *   งบ TSLA / earnings TSLA        สรุปงบรายไตรมาสจาก SEC
 *   ตั้งค่าเทรด                     ดู/ตั้งค่าความเสี่ยงของคุณ
 *   ตั้งค่า budget 5000 | maxloss 50 | dailyloss 150 | trades 3 | rr 1.5 | buffer 10
 *   เข้าไม้แล้ว TSLA                จดว่าเข้าไม้ตามแผนแล้ว (ใช้นับลิมิตขาดทุน/จำนวนไม้ต่อวัน)
 *
 * บอทนี้ "ไม่ส่งคำสั่งซื้อขายจริง" — เป็น bot ให้ข้อมูลแบบ broadcast
 * ทุกข้อความไม่ใช่คำแนะนำการลงทุน
 *
 * Triggers (รัน traderInstallTriggers() ครั้งเดียวจาก editor):
 *   traderAlertsTick  ทุก 5 นาที — เช็คราคาเฉพาะตอนตลาด US เปิด แล้ว push ถึงผู้ใช้
 * ============================================================
 */

var TR_DISCLAIMER = "⚠️ ข้อมูลเพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน บอทไม่ส่งคำสั่งซื้อขายใดๆ";
var TR_SYM = "([A-Za-z]{1,5}(?:[.\\-][A-Za-z])?)";

var TR_SETTING_KEYS = {
  budget:    { key: "budget",                 th: "งบพอร์ต ($)" },
  maxloss:   { key: "max_loss_per_trade_usd", th: "ขาดทุนสูงสุดต่อไม้ ($)" },
  dailyloss: { key: "max_daily_loss_usd",     th: "ขาดทุนสูงสุดต่อวัน ($)" },
  trades:    { key: "max_trades_per_day",     th: "จำนวนไม้สูงสุดต่อวัน" },
  rr:        { key: "min_reward_risk",        th: "Reward:Risk ขั้นต่ำ" },
  buffer:    { key: "cash_buffer_pct",        th: "กันเงินสดสำรอง (%)" },
  cap:       { key: "max_position_pct",       th: "เพดานต่อหุ้น (% ของงบ)" },
  maxorder:  { key: "max_order_usd",          th: "ยอดสั่งซื้อสูงสุดต่อไม้ ($)" }
};

/** Returns true when the message was a trader command (and has been replied to). */
function handleTraderCommand(userInput, userId, replyToken) {
  var t = String(userInput || "").trim();
  var m;
  var reply = function (text) { replyToLine(replyToken, trTextWithQuickReply(text)); return true; };
  try {
    if (/^(เทรดเดอร์|trader|เมนูเทรด|day ?trade)$/i.test(t)) return reply(trHelpText());

    if (/^(ตั้งค่าเทรด|ค่าความเสี่ยง|risk settings?)$/i.test(t)) return reply(trSettingsText(userId));
    if ((m = t.match(/^(?:ตั้งค่า|set)\s+([a-z]+)\s+([\d.,]+)$/i))) return reply(trSetSetting(userId, m[1].toLowerCase(), m[2]));

    if (/^(สแกน|scan)$/i.test(t)) return reply(trScanDailyText());
    if (/^(สแกน\s*orb|scan\s*orb|orb)$/i.test(t)) return reply(trScanOrbText());

    if ((m = t.match(new RegExp("^(?:เข้าไหม|จุดเข้า|entry)\\s+" + TR_SYM + "$", "i")))) return reply(trEntryText(m[1].toUpperCase(), userId));

    if ((m = t.match(new RegExp("^(?:แผน|plan)\\s+" + TR_SYM + "((?:\\s+\\S+){0,3})$", "i")))) {
      return reply(trPlanText(userId, m[1].toUpperCase(), m[2].trim() ? m[2].trim().split(/\s+/) : []));
    }
    if ((m = t.match(new RegExp("^(?:โอกาส|odds|ไทม์แมชชีน|time ?machine)\\s+" + TR_SYM + "$", "i")))) return reply(trOddsText(userId, m[1].toUpperCase()));

    if ((m = t.match(new RegExp("^(?:เตือนแผน|alert ?plan)\\s+" + TR_SYM + "$", "i")))) return reply(trAlertFromPlan(userId, m[1].toUpperCase()));
    if (/^(เตือนเปิดตลาด|alert ?bell|เตือนตลาดเปิด)$/i.test(t)) {
      storeAddAlert(userId, "SPY", "bell", null, "ตลาด US เปิด");
      return reply("🔔 ตั้งเตือนตอนตลาด US เปิดแล้วค่า (เตือนครั้งเดียว)");
    }
    if ((m = t.match(new RegExp("^(?:เตือน|alert)\\s+" + TR_SYM + "\\s*(>=|<=|>|<|\\+|-)?\\s*\\$?([\\d.]+)\\s*(%)?$", "i")))) {
      return reply(trAddPriceAlert(userId, m[1].toUpperCase(), m[2] || "", Number(m[3]), !!m[4]));
    }
    if (/^(เตือน|รายการเตือน|alerts?)$/i.test(t)) return reply(trAlertListText(userId));
    if ((m = t.match(/^(?:ยกเลิกเตือน|cancel ?alert)\s+(\d+|ทั้งหมด|all)$/i))) {
      var id = /^\d+$/.test(m[1]) ? Number(m[1]) : "all";
      var n = storeCancelAlerts(userId, id);
      return reply(n ? "🗑️ ยกเลิกการเตือนแล้ว " + n + " รายการค่า" : "ไม่พบการเตือนนี้ค่า 🤔");
    }

    if ((m = t.match(new RegExp("^(?:ข่าว|news)\\s+" + TR_SYM + "$", "i")))) return reply(trNewsText(m[1].toUpperCase()));
    if ((m = t.match(new RegExp("^(?:งบ|earnings|ผลประกอบการ)\\s+" + TR_SYM + "$", "i")))) return reply(trEarningsText(m[1].toUpperCase()));

    if ((m = t.match(new RegExp("^(?:เข้าไม้แล้ว|took|taken)\\s+" + TR_SYM + "$", "i")))) return reply(trMarkTaken(userId, m[1].toUpperCase()));
  } catch (e) {
    console.error("handleTraderCommand: " + e + "\n" + (e.stack || ""));
    return reply("ขออภัยค่า ระบบเทรดขัดข้องชั่วคราว 😅 ลองใหม่อีกครั้งนะคะ");
  }
  return false;
}

// ── LINE helpers ──

function trTextWithQuickReply(text) {
  if (text.length > 4900) text = text.substring(0, 4880) + "\n…";
  var items = [
    ["🔎 สแกน", "สแกน"], ["🚀 สแกน ORB", "สแกน orb"], ["🔔 การเตือน", "เตือน"],
    ["⚙️ ตั้งค่าเทรด", "ตั้งค่าเทรด"], ["📖 คำสั่งเทรด", "เทรดเดอร์"], ["🏠 เมนูหลัก", "เมนู"]
  ];
  return { type: "text", text: text,
           quickReply: { items: items.map(function (x) { return { type: "action", action: { type: "message", label: x[0], text: x[1] } }; }) } };
}

function trPush(userId, text) {
  var token = getConfig().lineToken;
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post", muteHttpExceptions: true,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: "text", text: text }] })
  });
  if (res.getResponseCode() >= 300) console.error("push " + res.getResponseCode() + ": " + res.getContentText());
  return res.getResponseCode() < 300;
}

function trPct(x, d) { return (x >= 0 ? "+" : "") + x.toFixed(d == null ? 2 : d) + "%"; }
function trP(x) { return "$" + Number(x).toFixed(2); }
function trBig(x) {
  var a = Math.abs(x), s = x < 0 ? "-" : "";
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  return s + "$" + a.toLocaleString("en-US");
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HELP + SETTINGS                                             ║
// ╚══════════════════════════════════════════════════════════════╝

function trHelpText() {
  return "📈 Bestie Trader — คำสั่งเทรด\n" +
    "ตัวเลขทุกตัวคำนวณด้วยกฎตายตัว ไม่ได้ให้ AI เดา\n\n" +
    "🔎 หาหุ้น\n• สแกน — หุ้นเข้าเงื่อนไขรายวัน\n• สแกน orb — ทะลุกรอบเปิดตลาดวันนี้\n\n" +
    "🎯 วางแผน\n• เข้าไหม TSLA — สถานะจุดเข้า\n• แผน TSLA — Stop / Target / จำนวนหุ้น\n" +
    "• แผน TSLA atr:1.5 2R — เลือกกฎเอง\n• แผน TSLA 364.18 358.32 370.04\n• โอกาส TSLA — จำลอง 10,000 รอบ\n\n" +
    "🔔 เตือนราคา\n• เตือน TSLA > 370 / < 350 / +5%\n• เตือนแผน TSLA\n• เตือนเปิดตลาด\n• เตือน — ดูทั้งหมด\n• ยกเลิกเตือน 3 / ทั้งหมด\n\n" +
    "📰 ข้อมูล\n• ข่าว TSLA — ข่าว + 8-K\n• งบ TSLA — งบรายไตรมาส\n\n" +
    "⚙️ ความเสี่ยง\n• ตั้งค่าเทรด\n• ตั้งค่า budget 5000\n• ตั้งค่า maxloss 50\n• เข้าไม้แล้ว TSLA — นับลิมิตรายวัน\n\n" + TR_DISCLAIMER;
}

function trUserCfg(userId) { return tdMergeCfg(storeGetSettings(userId)); }

function trSettingsText(userId) {
  var c = trUserCfg(userId);
  var lines = Object.keys(TR_SETTING_KEYS).map(function (k) {
    var d = TR_SETTING_KEYS[k];
    return "• " + d.th + ": " + c[d.key] + "   (ตั้งค่า " + k + " …)";
  });
  var today = tdTodayLog(userId);
  return "⚙️ ค่าความเสี่ยงของคุณ\n\n" + lines.join("\n") +
    "\n• ห้ามเข้าก่อน/หลัง: " + c.no_entries_before + " / " + c.no_entries_after + " (เวลา NY)" +
    "\n• ปิดสถานะภายใน: " + c.flat_by + " NY" +
    "\n\nวันนี้เข้าไปแล้ว " + today.trades + " ไม้ เสี่ยงรวม " + tdMoney(today.riskUsd) +
    "\n\nตัวอย่าง: ตั้งค่า maxloss 30" + (sbEnabled() ? "" : "\n\n(ยังไม่ได้เชื่อม Supabase — เก็บใน Script Properties)");
}

function trSetSetting(userId, key, value) {
  var d = TR_SETTING_KEYS[key];
  if (!d) return "ไม่รู้จัก '" + key + "' ค่า ใช้ได้: " + Object.keys(TR_SETTING_KEYS).join(", ");
  var v = Number(String(value).replace(/,/g, ""));
  if (!(v >= 0) || (key === "buffer" && v >= 100) || (key === "cap" && (v <= 0 || v > 100))) return "ค่าไม่ถูกต้องค่า 🙏";
  var s = storeGetSettings(userId) || {};
  s[d.key] = key === "trades" ? Math.floor(v) : v;
  storeSetSettings(userId, s);
  return "✅ ตั้ง " + d.th + " = " + s[d.key] + " แล้วค่า";
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  SCANNER                                                     ║
// ╚══════════════════════════════════════════════════════════════╝

function trScanDailyText() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("TR_SCAN_DAILY");
  if (hit) return hit;
  var r = tdScanDaily();
  var lines = r.hits.slice(0, 15).map(function (h, i) {
    return (i + 1) + ". " + h.symbol + " " + trP(h.price) + " | RSI " + h.rsi + "\n   " +
           h.setups.map(function (s) { return TD_SETUP_TH[s] || s; }).join(", ");
  });
  var text = "🔎 สแกนหุ้นรายวัน (ราคาปิด " + (r.hits[0] ? r.hits[0].closeDate : "-") + ")\n" +
    "สแกน " + r.counts.scanned + " ตัว | เข้าเงื่อนไข " + r.counts.hits + " ตัว\n" +
    "(ราคา ≥ $5, วอลุ่ม ≥ 1M — เรียงตามมูลค่าซื้อขาย)\n\n" +
    (lines.length ? lines.join("\n") : "วันนี้ไม่มีหุ้นเข้าเงื่อนไขค่า") +
    "\n\nสแกนคือรายชื่อกราฟที่เข้ากฎ ไม่ใช่รายชื่อหุ้นที่ควรซื้อ\nต่อด้วย: แผน " + (r.hits[0] ? r.hits[0].symbol : "TSLA") + "\n\n" + TR_DISCLAIMER;
  cache.put("TR_SCAN_DAILY", text, 1800);
  return text;
}

function trScanOrbText() {
  var r = tdScanOrb();
  if (r.error) return "🚀 สแกน ORB\n\n" + r.error;
  var lines = r.hits.sort(function (a, b) { return a.entryMin - b.entryMin; }).slice(0, 15).map(function (h, i) {
    return (i + 1) + ". " + h.symbol + " เข้า " + trP(h.entry) + " (" + tdBkkClock(r.date, h.entryMin) + " น.)\n" +
           "   กรอบ " + trP(h.orLow) + "–" + trP(h.orHigh) + " | เหนือกรอบ " + trPct(h.overPct) + " | ตอนนี้ " + trP(h.price);
  });
  return "🚀 ทะลุกรอบเปิดตลาด 15 นาที (" + r.date + ")\n" +
    "ผ่านด่านแรก " + r.candidates + " ตัว | ยืนยัน " + r.confirmed + " ตัว" + (r.partial ? " (บางส่วน)" : "") + "\n\n" +
    (lines.length ? lines.join("\n") : "ยังไม่มีตัวไหนทะลุกรอบค่า") +
    "\n\nเวลา = เวลาไทยที่แท่ง 5 นาทีปิดเหนือกรอบ\nต่อด้วย: แผน " + (r.hits[0] ? r.hits[0].symbol : "TSLA") + " หรือ โอกาส " + (r.hits[0] ? r.hits[0].symbol : "TSLA") + "\n\n" + TR_DISCLAIMER;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  ENTRY                                                       ║
// ╚══════════════════════════════════════════════════════════════╝

function trEntryText(sym, userId) {
  var e = tdEntryCheck(sym, 15, null, trUserCfg(userId));
  var head = "🎯 จุดเข้า " + sym + " (ทะลุกรอบเปิดตลาด 15 นาที)\n\n";
  switch (e.status) {
    case "closed":   return head + "วันนี้ตลาด US ปิด (" + e.reason + ")";
    case "not_open": return head + "ตลาดยังไม่เปิด — เปิด " + e.opensBkk + " น. เวลาไทย\nกรอบเปิดตลาดจะครบหลังเปิด 15 นาที";
    case "forming":  return head + "⏳ กรอบเปิดตลาดยังไม่ครบ (" + e.bars + "/" + e.needed + " แท่ง)\nราคาตอนนี้ " + trP(e.price);
    case "error":    return head + e.error;
    case "waiting":
      return head + "⏳ รอ — ยังไม่มีแท่ง 5 นาทีปิดเหนือกรอบ\n" +
        "กรอบ: " + trP(e.orLow) + " – " + trP(e.orHigh) + "\nราคาตอนนี้: " + trP(e.price) +
        (e.distancePct != null ? " (ต้องขึ้นอีก " + trPct(e.distancePct) + ")" : "") +
        "\n\nเตือนเมื่อทะลุ: เตือน " + sym + " > " + e.orHigh.toFixed(2);
    case "triggered":
      var volNote = e.volAvg ? "\nวอลุ่มแท่งที่ทะลุ " + (e.vol / e.volAvg).toFixed(1) + " เท่าของค่าเฉลี่ยวันนี้" : "";
      return head + "✅ ทะลุแล้ว — แท่ง 5 นาทีปิดเหนือกรอบที่ " + trP(e.entry) + " (" + e.entryBkk + " น. เวลาไทย)\n" +
        "กรอบ: " + trP(e.orLow) + " – " + trP(e.orHigh) + "\nราคาตอนนี้: " + trP(e.price) + volNote +
        "\n\nต่อด้วย: แผน " + sym + " แล้ว โอกาส " + sym;
    case "expired":
      return head + "⌛ หมดเวลาเข้าไม้วันนี้ (ไม่ทะลุกรอบก่อนเวลาที่ตั้งไว้)\nกรอบ: " + trP(e.orLow) + " – " + trP(e.orHigh);
  }
  return head + "ไม่ทราบสถานะ";
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  PLAN = exit + budget + risk                                 ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * Builds a plan. args: [] | [stopRule] | [stopRule, targetRule] | [entry, stop, target]
 * → {ok, kind:'day'|'swing', symbol, exit, sizing, risk, basis, entryState, orHigh, orLow, entrySlot, date} | {ok:false, error}
 */
function tdBuildPlan(userId, sym, args) {
  var cfg = userId ? trUserCfg(userId) : tdMergeCfg({});
  var ms = tdMarketState();
  var exitOpts, kind, basis, extra = {};
  var nums = args.length === 3 && args.every(function (a) { return /^\$?[\d.]+$/.test(a); });
  var stopArg = !nums && args[0] ? tdParseStopRule(args[0]) : null;
  var tgtArg = !nums && args[1] ? tdParseTargetRule(args[1]) : null;
  if (!nums && args[0] && !stopArg) return { ok: false, error: "ไม่เข้าใจกฎ stop '" + args[0] + "' (ใช้ or-mid, or-low, pct:1, atr:1.5 หรือราคา)" };
  if (!nums && args[1] && !tgtArg) return { ok: false, error: "ไม่เข้าใจ target '" + args[1] + "' (ใช้ 2R, 1.5R หรือราคา)" };

  if (nums) {
    exitOpts = { entry: +args[0].replace("$", ""), stopRule: "price", stopParam: +args[1].replace("$", ""),
                 targetRule: "price", targetParam: +args[2].replace("$", "") };
    kind = ms.state === "open" ? "day" : "swing";
    basis = "ราคาที่คุณกำหนดเอง";
  } else {
    var e = ms.state === "open" ? tdEntryCheck(sym, 15, null, cfg) : { status: ms.state };
    if (e.status === "triggered" || e.status === "waiting") {
      kind = "day";
      var entry = e.status === "triggered" ? e.entry : Math.round((e.orHigh + 0.01) * 100) / 100;
      exitOpts = { entry: entry, orHigh: e.orHigh, orLow: e.orLow,
                   stopRule: stopArg ? stopArg.rule : "or_mid", stopParam: stopArg && stopArg.param,
                   targetRule: tgtArg ? tgtArg.rule : "r", targetParam: tgtArg ? tgtArg.param : 2 };
      if (exitOpts.stopRule === "atr") {
        var a = tdAtr(e.bars || []);
        exitOpts.atr = a && a.atr; exitOpts.atrBars = a && a.bars;
      }
      basis = e.status === "triggered"
        ? "Day trade: ทะลุกรอบเปิดตลาดแล้วที่ " + trP(e.entry) + " (" + e.entryBkk + " น.)"
        : "Day trade (ถ้าทะลุ): ยังรอ — คิดราคาเข้าที่ขอบบนกรอบ " + trP(entry);
      extra = { entryState: e.status, orHigh: e.orHigh, orLow: e.orLow, date: e.date,
                entrySlot: e.status === "triggered" ? (e.entryMin - 570) / 5 - 1 : 2 };
    } else {
      // Swing: daily bars, ATR(14) stop
      kind = "swing";
      var ch = tdChart(sym, "6mo", "1d");
      if (!ch || ch.bars.length < 20) return { ok: false, error: "ดึงข้อมูลรายวันของ " + sym + " ไม่ได้ (ตรวจชื่อหุ้น)" };
      var price = ch.meta.regularMarketPrice || ch.bars[ch.bars.length - 1].c;
      var atr = tdAtr(ch.bars, 14);
      var lo20 = Math.min.apply(null, ch.bars.slice(-20).map(function (b) { return b.l; }));
      exitOpts = { entry: price, atr: atr && atr.atr, atrBars: atr && atr.bars,
                   stopRule: stopArg ? stopArg.rule : "atr", stopParam: stopArg ? stopArg.param : 1.5,
                   targetRule: tgtArg ? tgtArg.rule : "r", targetParam: tgtArg ? tgtArg.param : 2 };
      if (exitOpts.stopRule === "or_mid" || exitOpts.stopRule === "or_low") return { ok: false, error: "ตลาดไม่ได้เปิด จึงไม่มีกรอบเปิดตลาด — ใช้ atr:1.5 หรือ pct:3 แทน" };
      basis = "Swing (ถือหลายวัน): ราคาล่าสุด " + trP(price) + ", ATR14 รายวัน " + trP(atr.atr) + ", จุดต่ำสุด 20 วัน " + trP(lo20);
      extra = { atrDaily: atr.atr, low20: lo20 };
    }
  }
  var ex = tdComputeExit(exitOpts);
  if (!ex.ok) return { ok: false, error: ex.error };
  var sizing = tdSizeTrade({ symbol: sym, entry: ex.entry, stop: ex.stop, target: ex.target }, cfg);
  var risk = tdRiskCheck(sizing, cfg, userId ? tdTodayLog(userId) : null, kind);
  var out = { ok: true, kind: kind, symbol: sym, exit: ex, sizing: sizing, risk: risk, basis: basis, cfg: cfg,
              date: extra.date || ms.et.date, stopRule: exitOpts.stopRule, stopParam: exitOpts.stopParam };
  Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

function trPlanText(userId, sym, args) {
  var p = tdBuildPlan(userId, sym, args);
  if (!p.ok) return "📋 แผน " + sym + "\n\n❌ " + p.error;
  var ex = p.exit, s = p.sizing, c = p.cfg;
  var stopPct = (ex.entry - ex.stop) / ex.entry * 100, tgtPct = (ex.target - ex.entry) / ex.entry * 100;
  var text = "📋 แผน " + sym + " — " + (p.kind === "day" ? "Day trade" : "Swing") + "\n" + p.basis + "\n\n" +
    "💵 ราคาเข้า: " + trP(ex.entry) + "\n" +
    "🛑 Stop: " + trP(ex.stop) + " (-" + stopPct.toFixed(2) + "%) — " + ex.stopLabel + "\n" +
    "🎯 Target: " + trP(ex.target) + " (+" + tgtPct.toFixed(2) + "%) — " + ex.targetLabel + "\n" +
    "⚖️ เสี่ยง " + trP(ex.risk) + "/หุ้น | Reward:Risk " + ex.rr + "\n";
  if (p.kind === "day") text += "⏰ ปิดสถานะภายใน " + c.flat_by + " NY (" + tdBkkClock(p.date, tdParseHHMM(c.flat_by)) + " น. เวลาไทย) ไม่ว่ากำไรหรือขาดทุน\n";
  text += "\n📦 ขนาดไม้ (งบ " + tdMoney(c.budget) + ", ยอมเสียไม่เกิน " + tdMoney(c.max_loss_per_trade_usd) + "/ไม้)\n";
  if (s.qty > 0) {
    text += "• " + s.qty + " หุ้น = " + tdMoney(s.cost) + "\n• ถ้าโดน stop เสียประมาณ " + tdMoney(s.maxLoss) +
            "\n• ตัวกำหนดจำนวน: " + s.boundTh + "\n";
  } else {
    text += "• ❌ " + s.refusal + "\n";
  }
  text += "\n🛡️ ตรวจความเสี่ยง: " + (p.risk.verdict === "PASS" ? "✅ ผ่าน" : "⛔ ไม่ผ่าน") + "\n";
  p.risk.reasons.forEach(function (r) { text += "• " + r + "\n"; });
  p.risk.warnings.forEach(function (w) { text += "• ⚠️ " + w + "\n"; });
  if (s.qty > 0) {
    try {
      storeSavePlan(userId, sym, p.date, { kind: p.kind, entry: ex.entry, stop: ex.stop, target: ex.target, qty: s.qty,
        max_loss: s.maxLoss, rr: ex.rr, stop_rule: p.stopRule, target_r: ex.targetR, flat_by: c.flat_by,
        or_high: p.orHigh || null, or_low: p.orLow || null, entry_slot: p.entrySlot != null ? p.entrySlot : null,
        verdict: p.risk.verdict });
    } catch (e) {}
    text += "\nต่อด้วย:\n• โอกาส " + sym + " — จำลอง 10,000 รอบ\n• เตือนแผน " + sym + " — เตือน stop/target\n• เข้าไม้แล้ว " + sym + " — ถ้าคุณเข้าไม้จริง";
  }
  return text + "\n\n" + TR_DISCLAIMER;
}

function trMarkTaken(userId, sym) {
  var plan = storeLatestPlan(userId, sym);
  if (!plan) return "ยังไม่มีแผนของ " + sym + " ค่า พิมพ์ แผน " + sym + " ก่อนนะคะ";
  storeSetPlanStatus(userId, plan.id, "taken");
  var today = tdTodayLog(userId);
  var c = trUserCfg(userId);
  return "📝 จดไว้แล้วว่าเข้า " + sym + " " + plan.plan.qty + " หุ้นที่ " + trP(plan.plan.entry) +
    "\nวันนี้ " + today.trades + "/" + c.max_trades_per_day + " ไม้ | เสี่ยงรวม " + tdMoney(today.riskUsd) + "/" + tdMoney(c.max_daily_loss_usd) +
    "\n\nตั้งเตือน stop/target: เตือนแผน " + sym;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TIME MACHINE                                                ║
// ╚══════════════════════════════════════════════════════════════╝

function trOddsText(userId, sym) {
  var saved = storeLatestPlan(userId, sym);
  var p, src;
  var today = tdNowET().date;
  if (saved && saved.trade_date === today && saved.plan.kind === "day") {
    p = { symbol: sym, entry: saved.plan.entry, stop: saved.plan.stop, target: saved.plan.target, targetR: saved.plan.target_r,
          stopRule: saved.plan.stop_rule === "pct" ? "pct" : saved.plan.stop_rule === "or_low" ? "or_low" : "or_mid",
          entrySlot: saved.plan.entry_slot, flatBy: saved.plan.flat_by, orMinutes: 15 };
    src = "จากแผนล่าสุดของคุณ";
  } else {
    var b = tdBuildPlan(userId, sym, []);
    if (!b.ok) return "🕰️ Time Machine " + sym + "\n\n❌ " + b.error;
    if (b.kind !== "day") {
      // นอกเวลาตลาด: จำลองกฎ ORB มาตรฐานทั้งวัน ด้วยสัดส่วน stop/target จากแท่ง 5 นาทีล่าสุด
      var ch = tdChart(sym, "5d", "5m");
      var lastDay = ch && ch.bars.length ? ch.bars[ch.bars.length - 1].date : null;
      var bars = lastDay ? tdSessionBars5m_(ch, lastDay, Date.now()) : [];
      if (bars.length < 4) return "🕰️ Time Machine " + sym + "\n\n❌ ข้อมูลแท่ง 5 นาทีไม่พอ";
      var oh = Math.max(bars[0].h, bars[1].h, bars[2].h), ol = Math.min(bars[0].l, bars[1].l, bars[2].l);
      var e0 = Math.round((oh + 0.01) * 100) / 100, s0 = Math.floor((oh + ol) / 2 * 100) / 100;
      p = { symbol: sym, entry: e0, stop: s0, target: Math.round((e0 + 2 * (e0 - s0)) * 100) / 100, targetR: 2,
            stopRule: "or_mid", entrySlot: 3, orMinutes: 15 };
      src = "ตลาดปิดอยู่ — ใช้กฎ ORB มาตรฐาน (stop กึ่งกลางกรอบ, target 2R) กับกรอบของวันล่าสุด " + lastDay;
    } else {
      p = { symbol: sym, entry: b.exit.entry, stop: b.exit.stop, target: b.exit.target, targetR: b.exit.targetR,
            stopRule: b.stopRule === "pct" ? "pct" : b.stopRule === "or_low" ? "or_low" : "or_mid", stopPct: b.stopParam,
            entrySlot: b.entrySlot, orMinutes: 15 };
      src = b.basis;
    }
  }
  var r = tdTimeMachine(p, 10000, 19, 2);
  if (r.error) return "🕰️ Time Machine " + sym + "\n\n❌ " + r.error;
  var mc = r.mc, h = r.history;
  var pc = function (x) { return (x * 100).toFixed(1) + "%"; };
  var text = "🕰️ Time Machine " + sym + "\n" + src + "\n" +
    "เข้า " + trP(p.entry) + " | Stop " + trP(p.stop) + " | Target " + trP(p.target) + "\n\n" +
    "🎲 จำลอง " + mc.replays.toLocaleString() + " รอบ (จากแท่ง 5 นาที " + r.sessions + " วันที่ผ่านมา, seed " + mc.seed + ")\n" +
    "• ถึง Target ก่อน: " + pc(mc.pTarget) + "\n• โดน Stop ก่อน: " + pc(mc.pStop) +
    "\n• ไม่ถึงทั้งคู่จนปิด: " + pc(mc.pNeither) + "\n• จบเป็นบวก: " + pc(mc.pGreen) +
    "\n• R เฉลี่ย: " + (mc.avgR >= 0 ? "+" : "") + mc.avgR.toFixed(2) + "R" +
    "\n• ราคาตอนปิด: กลาง " + trP(mc.median) + " (90% อยู่ใน " + trP(mc.p5) + "–" + trP(mc.p95) + ")\n\n" +
    "📜 กฎเดียวกันกับ " + h.sessions + " วันจริงที่ผ่านมา: เกิดสัญญาณ " + h.triggered + " ครั้ง\n" +
    "• ถึง Target " + h.target + " | โดน Stop " + h.stop + " | ไม่ถึงทั้งคู่ " + h.close +
    (h.avgR != null ? "\n• R เฉลี่ย " + (h.avgR >= 0 ? "+" : "") + h.avgR.toFixed(2) + "R" : "") + "\n\n" +
    "🧭 สรุป: " + r.verdict.th;
  if (r.verdict.even != null) {
    text += "\n(ที่ " + (Math.round(mc.rAtTarget * 100) / 100) + "R ต้องถึง Target ก่อน ≥ " + (r.verdict.even * 100).toFixed(0) +
            "% ของรอบที่แตะฝั่งใดฝั่งหนึ่งถึงจะคุ้ม — ได้ " + (r.verdict.share * 100).toFixed(0) + "%)";
  }
  if (mc.pNeither > 0.4) text += "\nกว่า 40% ของรอบไม่แตะทั้งคู่ — ราคาตอนปิดเป็นตัวตัดสิน";
  return text + "\n\nการจำลองจากข้อมูล 60 วันล่าสุด ไม่ใช่คำทำนาย งบ/ข่าว/การหยุดซื้อขายทำสิ่งที่ 60 วันนั้นไม่เคยเห็นได้\n" + TR_DISCLAIMER;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  ALERTS                                                      ║
// ╚══════════════════════════════════════════════════════════════╝

var TR_ALERT_TH = { above: "ขึ้นถึง", below: "ลงถึง", stop: "🛑 Stop", target: "🎯 Target",
                    pct_up: "ขึ้น ≥", pct_down: "ลง ≥", flat_by: "⏰ ปิดสถานะ", bell: "🔔 ตลาดเปิด" };

function trAddPriceAlert(userId, sym, op, val, isPct) {
  if (!(val > 0)) return "ราคาไม่ถูกต้องค่า";
  var kind;
  if (isPct) kind = op === "-" ? "pct_down" : "pct_up";
  else if (op === "<" || op === "<=" || op === "-") kind = "below";
  else if (op === ">" || op === ">=" || op === "+") kind = "above";
  else {
    var q = tdQuotes([sym])[sym];
    if (!q) return "หาราคา " + sym + " ไม่เจอค่า ตรวจชื่อหุ้นอีกครั้งนะคะ";
    kind = val >= q.price ? "above" : "below";
  }
  var a = storeAddAlert(userId, sym, kind, val, null);
  return "🔔 ตั้งเตือน #" + (a && a.id) + ": " + sym + " " + TR_ALERT_TH[kind] + " " + (isPct ? val + "%" : trP(val)) +
         "\nเช็คทุก 5 นาทีช่วงตลาด US เปิด เตือนครั้งเดียว";
}

function trAlertFromPlan(userId, sym) {
  var plan = storeLatestPlan(userId, sym);
  if (!plan) return "ยังไม่มีแผนของ " + sym + " ค่า พิมพ์ แผน " + sym + " ก่อนนะคะ";
  var p = plan.plan;
  storeAddAlert(userId, sym, "stop", p.stop, "แผน #" + plan.id);
  storeAddAlert(userId, sym, "target", p.target, "แผน #" + plan.id);
  if (p.kind === "day") storeAddAlert(userId, sym, "flat_by", null, (p.flat_by || "15:55") + "|" + plan.trade_date);
  return "🔔 ตั้งเตือนจากแผน " + sym + " แล้วค่า\n• Stop " + trP(p.stop) + "\n• Target " + trP(p.target) +
         (p.kind === "day" ? "\n• ปิดสถานะ " + (p.flat_by || "15:55") + " NY" : "");
}

function trAlertListText(userId) {
  var list = storeListAlerts(userId, true);
  if (!list.length) return "ยังไม่มีการเตือนค่า\nลองพิมพ์: เตือน TSLA > 400";
  return "🔔 การเตือนของคุณ (" + list.length + ")\n\n" + list.map(function (a) {
    var lv = a.kind === "pct_up" || a.kind === "pct_down" ? a.level + "%" : a.level != null ? trP(a.level) : "";
    return "#" + a.id + " " + (a.kind === "bell" ? "" : a.symbol + " ") + TR_ALERT_TH[a.kind] + " " + lv + (a.note && a.kind !== "flat_by" ? " (" + a.note + ")" : "");
  }).join("\n") + "\n\nยกเลิก: ยกเลิกเตือน <เลข> หรือ ยกเลิกเตือน ทั้งหมด";
}

/** Time trigger, every 5 minutes. Rings each alert once, only while the US market is open. */
function traderAlertsTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var ms = tdMarketState();
    if (ms.state !== "open") return;
    var alerts = storeAllActiveAlerts();
    if (!alerts.length) return;
    var syms = alerts.filter(function (a) { return a.kind !== "bell" && a.kind !== "flat_by"; }).map(function (a) { return a.symbol; });
    var quotes = syms.length ? tdQuotes(syms) : {};
    alerts.forEach(function (a) {
      var q = quotes[a.symbol];
      var msg = null;
      if (a.kind === "bell") {
        msg = "🔔 ตลาด US เปิดแล้วค่า (" + tdBkkClock(ms.et.date, ms.session.open) + " น. เวลาไทย)";
      } else if (a.kind === "flat_by") {
        var parts = String(a.note || "15:55").split("|");
        var flat = tdParseHHMM(parts[0]) || 955;
        if (ms.session.early) flat = Math.min(flat, ms.session.close - 5);
        if (parts[1] && parts[1] < ms.et.date) { storeFireAlert(a.id, null); return; }   // stale day
        if (ms.et.min >= flat) msg = "⏰ " + a.symbol + " ถึงเวลาปิดสถานะ Day trade แล้วค่า ไม่ว่ากำไรหรือขาดทุน";
      } else if (tdAlertHit(a, q)) {
        var lv = a.kind === "pct_up" || a.kind === "pct_down" ? a.level + "%" : trP(a.level);
        msg = "🔔 " + a.symbol + " " + TR_ALERT_TH[a.kind] + " " + lv + "\nราคาตอนนี้ " + trP(q.price) +
              (q.prev ? " (" + trPct((q.price / q.prev - 1) * 100) + " จากปิดเมื่อวาน)" : "") +
              (a.kind === "stop" ? "\nทำตามแผน: ออกตาม stop" : a.kind === "target" ? "\nถึงเป้าตามแผนแล้วค่า" : "");
      }
      if (msg && trPush(a.user_id, msg + "\n\n(เตือน #" + a.id + " — ราคาจาก Yahoo อาจดีเลย์)")) storeFireAlert(a.id, q ? q.price : null);
    });
  } finally { lock.releaseLock(); }
}

/** รันครั้งเดียวจาก editor เพื่อตั้ง trigger ของระบบเทรด */
function traderInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "traderAlertsTick") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("traderAlertsTick").timeBased().everyMinutes(5).create();
  console.log("✅ ตั้ง traderAlertsTick ทุก 5 นาทีแล้ว");
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  NEWS + EARNINGS                                             ║
// ╚══════════════════════════════════════════════════════════════╝

function trNewsText(sym) {
  var n = tdNews(sym, 48);
  var head = "📰 ข่าว " + sym + (n.quote ? " — " + trP(n.quote.price) + (n.movePct != null ? " (" + trPct(n.movePct) + ")" : "") : "") + "\n";
  if (n.movePct != null && Math.abs(n.movePct) >= 3) head += "⚡ ขยับแรงกว่า 3% จากราคาปิดเมื่อวาน\n";
  if (!n.items.length) return head + "\nไม่พบข่าวใน 48 ชม. ค่า";
  var lines = n.items.map(function (it, i) {
    var when = isFinite(it.ms) ? Utilities.formatDate(new Date(it.ms), "Asia/Bangkok", "d MMM HH:mm") : "";
    return (i + 1) + ". " + (it.important ? "❗" : "") + it.title + (it.tags.length ? " [" + it.tags.join(", ") + "]" : "") + (when ? "\n   " + when + " น." : "");
  });
  return head + "\n" + lines.join("\n") + (n.secEnabled ? "" : "\n\n(ตั้ง SEC_USER_AGENT เพื่อดูเอกสาร 8-K ด้วย)") + "\n\nเวลาแสดงเป็นเวลาไทย";
}

function trEarningsText(sym) {
  var r = tdEarnings(sym);
  if (r.error) return "📊 งบ " + sym + "\n\n❌ " + r.error;
  if (!r.quarters.length) return "📊 งบ " + sym + "\n\nไม่พบตัวเลขรายไตรมาสใน SEC ค่า";
  var yo = function (x) { return x == null ? "" : " (" + trPct(x, 1) + " YoY)"; };
  var rows = r.quarters.slice().reverse().map(function (q) {
    return "▸ " + q.q + " (สิ้นงวด " + q.end + ")\n" +
      (q.revenue != null ? "  รายได้ " + trBig(q.revenue) + yo(q.yoy.revenue) + "\n" : "") +
      (q.net_income != null ? "  กำไรสุทธิ " + trBig(q.net_income) + yo(q.yoy.net_income) + "\n" : "") +
      (q.eps_diluted != null ? "  EPS " + q.eps_diluted.toFixed(2) + yo(q.yoy.eps_diluted) + "\n" : "") +
      [q.gross_margin != null ? "GM " + q.gross_margin.toFixed(1) + "%" : "", q.op_margin != null ? "OPM " + q.op_margin.toFixed(1) + "%" : "",
       q.net_margin != null ? "NPM " + q.net_margin.toFixed(1) + "%" : ""].filter(String).map(function (x, i) { return (i ? " | " : "  ") + x; }).join("");
  });
  var text = "📊 งบ " + sym + " — " + r.name + "\n(ตัวเลขที่ยื่นต่อ SEC, ไตรมาสปฏิทิน)\n\n" + rows.join("\n\n");
  if (r.ttm) text += "\n\n12 เดือนล่าสุด: รายได้ " + trBig(r.ttm.revenue) + (r.ttm.net_income != null ? " | กำไร " + trBig(r.ttm.net_income) : "");
  try {
    var ai = callOpenRouter("สรุปงบนี้เป็นภาษาไทย 3-4 บรรทัด ว่าอะไรเปลี่ยนไป (รายได้ มาร์จิ้น กำไร) ห้ามแต่งตัวเลขที่ไม่มีในข้อมูล ห้ามแนะนำซื้อขาย:\n" + text);
    if (ai && ai.indexOf("ขออภัย") !== 0) text += "\n\n💡 Bestie สรุป:\n" + ai;
  } catch (e) {}
  return text + "\n\n" + TR_DISCLAIMER;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HOOK สำหรับ Swing เดิม (buildSingleSwingFlex)               ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * ตัวเลขแผน Swing ที่คำนวณแล้ว สำหรับใส่ใน prompt ของ AI
 * คืน "" ถ้าคำนวณไม่ได้ (prompt เดิมจะทำงานต่อได้ตามปกติ)
 */
function traderSwingNumbersForPrompt(symbol, userId) {
  try {
    var cfg = userId ? trUserCfg(userId) : tdMergeCfg({});
    var ch = tdChart(symbol, "6mo", "1d");
    if (!ch || ch.bars.length < 30) return "";
    var price = ch.meta.regularMarketPrice || ch.bars[ch.bars.length - 1].c;
    var atr = tdAtr(ch.bars, 14);
    var ex = tdComputeExit({ entry: price, stopRule: "atr", stopParam: 1.5, atr: atr.atr, atrBars: atr.bars, targetRule: "r", targetParam: 2 });
    if (!ex.ok) return "";
    var s = tdSizeTrade({ symbol: symbol, entry: ex.entry, stop: ex.stop, target: ex.target }, cfg);
    var f = tdFindSetups(ch.bars.map(function (b) { return b.c; }));
    return "ตัวเลขแผนที่ระบบคำนวณแล้ว (ต้องใช้ตัวเลขนี้เป๊ะๆ ในหัวข้อ Entry/Target/Stop-Loss ห้ามเปลี่ยน ห้ามแต่งเพิ่ม):\n" +
      "- Entry: " + trP(ex.entry) + " (ราคาล่าสุด)\n" +
      "- Stop-Loss: " + trP(ex.stop) + " (-" + ((ex.entry - ex.stop) / ex.entry * 100).toFixed(2) + "%, 1.5×ATR14 รายวัน = " + trP(atr.atr) + ")\n" +
      "- Target: " + trP(ex.target) + " (+" + ((ex.target - ex.entry) / ex.entry * 100).toFixed(2) + "%, 2R)\n" +
      "- Reward:Risk: " + ex.rr + "\n" +
      "- RSI14: " + (f.rsi != null ? f.rsi.toFixed(1) : "N/A") + " | MA20: " + trP(f.ma20) + " | สูงสุด 20 วัน: " + trP(f.high20) + "\n" +
      "- สัญญาณกราฟ: " + (f.tags.length ? f.tags.map(function (x) { return TD_SETUP_TH[x]; }).join(", ") : "ไม่เข้าเงื่อนไขสแกน") + "\n" +
      "- ขนาดไม้ (งบ " + tdMoney(cfg.budget) + ", ยอมเสีย " + tdMoney(cfg.max_loss_per_trade_usd) + "/ไม้): " +
      (s.qty > 0 ? s.qty + " หุ้น ≈ " + tdMoney(s.cost) + ", ถ้าโดน stop เสีย ≈ " + tdMoney(s.maxLoss) : s.refusal) + "\n";
  } catch (e) {
    console.error("traderSwingNumbersForPrompt: " + e);
    return "";
  }
}
