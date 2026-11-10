// @ts-nocheck
/**
 * ============================================================
 * BESTIE BOT — SUPABASE STORE (LINE / Apps Script)
 * ============================================================
 * ที่เก็บถาวรสำหรับ: watchlist, price alerts, ค่าความเสี่ยง, แผนเทรด, job state
 *
 * ตั้งค่าใน Project Settings → Script Properties:
 *   SUPABASE_URL          เช่น https://abcdxyz.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key (Settings → API) — ห้ามใส่ในโค้ด
 *
 * ถ้ายังไม่ได้ตั้ง 2 ค่านี้ ระบบจะ fallback ไปใช้ Script Properties แบบเดิม
 * (บอทยังทำงานได้ แต่ Script Properties มีพื้นที่รวมแค่ ~500KB)
 *
 * ตาราง: ดู supabase/schema.sql
 * ============================================================
 */

var SB_CHANNEL = "line";

function sbConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty("SUPABASE_URL") || "").replace(/\/+$/, "");
  var key = p.getProperty("SUPABASE_SERVICE_KEY") || "";
  return (url && key) ? { url: url, key: key } : null;
}

function sbEnabled() { return !!sbConfig_(); }

/** REST call to PostgREST. Throws on HTTP >= 300 so callers can fall back. */
function sbRequest_(method, path, body, prefer) {
  var cfg = sbConfig_();
  if (!cfg) throw new Error("Supabase not configured");
  var headers = {
    "apikey": cfg.key,
    "Authorization": "Bearer " + cfg.key,
    "Content-Type": "application/json"
  };
  if (prefer) headers["Prefer"] = prefer;
  var opt = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined && body !== null) opt.payload = JSON.stringify(body);
  var res  = UrlFetchApp.fetch(cfg.url + "/rest/v1/" + path, opt);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) throw new Error("Supabase " + code + ": " + text.substring(0, 300));
  return text ? JSON.parse(text) : null;
}

function sbEq_(v) { return "eq." + encodeURIComponent(String(v)); }

// ── Script Properties fallback helpers ──
function spGetJson_(key, dflt) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    return raw ? JSON.parse(raw) : dflt;
  } catch (e) { return dflt; }
}
function spSetJson_(key, val) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(val));
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  WATCHLIST                                                   ║
// ╚══════════════════════════════════════════════════════════════╝

function storeGetWatchlist(userId) {
  if (sbEnabled()) {
    try {
      var rows = sbRequest_("get", "watchlists?select=symbol&channel=" + sbEq_(SB_CHANNEL) +
                            "&user_id=" + sbEq_(userId) + "&order=created_at.asc");
      return rows.map(function (r) { return r.symbol; });
    } catch (e) { console.error("storeGetWatchlist: " + e); }
  }
  return spGetJson_("WL_" + userId, []);
}

/** Saves the full list: inserts what is new, deletes what was removed. */
function storeSaveWatchlist(userId, list) {
  list = (list || []).map(function (s) { return String(s).toUpperCase().trim(); });
  if (sbEnabled()) {
    try {
      var current = storeGetWatchlist(userId);
      var add = list.filter(function (s) { return current.indexOf(s) === -1; });
      var del = current.filter(function (s) { return list.indexOf(s) === -1; });
      if (add.length) {
        sbRequest_("post", "watchlists?on_conflict=channel,user_id,symbol",
          add.map(function (s) { return { channel: SB_CHANNEL, user_id: userId, symbol: s }; }),
          "resolution=ignore-duplicates,return=minimal");
      }
      if (del.length) {
        sbRequest_("delete", "watchlists?channel=" + sbEq_(SB_CHANNEL) + "&user_id=" + sbEq_(userId) +
          "&symbol=in.(" + del.map(encodeURIComponent).join(",") + ")", null, "return=minimal");
      }
      return;
    } catch (e) { console.error("storeSaveWatchlist: " + e); }
  }
  spSetJson_("WL_" + userId, list);
}

/** Every symbol any LINE user watches (for scans / alerts). */
function storeAllWatchedSymbols() {
  if (sbEnabled()) {
    try {
      var rows = sbRequest_("get", "watchlists?select=symbol&channel=" + sbEq_(SB_CHANNEL));
      var set = {};
      rows.forEach(function (r) { set[r.symbol] = true; });
      return Object.keys(set);
    } catch (e) { console.error("storeAllWatchedSymbols: " + e); }
  }
  var all = PropertiesService.getScriptProperties().getProperties();
  var set2 = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("WL_") === 0 && k.indexOf("WL_CACHE_") !== 0) {
      try { JSON.parse(all[k]).forEach(function (s) { set2[s] = true; }); } catch (e) {}
    }
  });
  return Object.keys(set2);
}

/**
 * ย้าย watchlist เดิมจาก Script Properties (WL_<userId>) ขึ้น Supabase — รันครั้งเดียวด้วยมือ
 * หลังตั้ง SUPABASE_URL / SUPABASE_SERVICE_KEY แล้ว
 */
function migrateWatchlistsToSupabase() {
  if (!sbEnabled()) { console.log("ตั้ง SUPABASE_URL และ SUPABASE_SERVICE_KEY ก่อน"); return; }
  var all = PropertiesService.getScriptProperties().getProperties();
  var rows = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("WL_") !== 0 || k.indexOf("WL_CACHE_") === 0) return;
    var uid = k.substring(3);
    try {
      JSON.parse(all[k]).forEach(function (s) {
        rows.push({ channel: SB_CHANNEL, user_id: uid, symbol: String(s).toUpperCase() });
      });
    } catch (e) {}
  });
  if (rows.length) {
    sbRequest_("post", "watchlists?on_conflict=channel,user_id,symbol", rows,
               "resolution=ignore-duplicates,return=minimal");
  }
  console.log("ย้าย watchlist แล้ว " + rows.length + " แถว");
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  PRICE ALERTS                                                ║
// ╚══════════════════════════════════════════════════════════════╝
// alert = { id, user_id, symbol, kind, level, note, active, created_at, fired_at }

function storeAddAlert(userId, symbol, kind, level, note) {
  var row = { channel: SB_CHANNEL, user_id: userId, symbol: symbol.toUpperCase(), kind: kind,
              level: (level === null || level === undefined) ? null : level, note: note || null };
  if (sbEnabled()) {
    try {
      var out = sbRequest_("post", "price_alerts", row, "return=representation");
      return out && out[0];
    } catch (e) { console.error("storeAddAlert: " + e); }
  }
  var all = spGetJson_("TR_ALERTS", { next: 1, items: [] });
  row.id = all.next++;
  row.active = true;
  row.created_at = new Date().toISOString();
  all.items.push(row);
  spSetJson_("TR_ALERTS", all);
  return row;
}

function storeListAlerts(userId, onlyActive) {
  if (sbEnabled()) {
    try {
      return sbRequest_("get", "price_alerts?select=*&channel=" + sbEq_(SB_CHANNEL) +
        "&user_id=" + sbEq_(userId) + (onlyActive !== false ? "&active=is.true" : "") + "&order=id.asc");
    } catch (e) { console.error("storeListAlerts: " + e); }
  }
  return spGetJson_("TR_ALERTS", { items: [] }).items.filter(function (a) {
    return a.user_id === userId && (onlyActive === false || a.active);
  });
}

function storeAllActiveAlerts() {
  if (sbEnabled()) {
    try {
      return sbRequest_("get", "price_alerts?select=*&channel=" + sbEq_(SB_CHANNEL) + "&active=is.true&order=id.asc");
    } catch (e) { console.error("storeAllActiveAlerts: " + e); }
  }
  return spGetJson_("TR_ALERTS", { items: [] }).items.filter(function (a) { return a.active; });
}

function storeFireAlert(id, price) {
  var patch = { active: false, fired_at: new Date().toISOString(), fired_price: price };
  if (sbEnabled()) {
    try { sbRequest_("patch", "price_alerts?id=" + sbEq_(id), patch, "return=minimal"); return; }
    catch (e) { console.error("storeFireAlert: " + e); }
  }
  var all = spGetJson_("TR_ALERTS", { next: 1, items: [] });
  all.items.forEach(function (a) { if (a.id === id) { a.active = false; a.fired_at = patch.fired_at; a.fired_price = price; } });
  all.items = all.items.filter(function (a) { return a.active || Date.now() - new Date(a.fired_at) < 7 * 86400000; });
  spSetJson_("TR_ALERTS", all);
}

/** Cancels one alert (id) or all of a user's alerts (id = "all"). Returns how many. */
function storeCancelAlerts(userId, id) {
  if (sbEnabled()) {
    try {
      var q = "price_alerts?channel=" + sbEq_(SB_CHANNEL) + "&user_id=" + sbEq_(userId) + "&active=is.true" +
              (id === "all" ? "" : "&id=" + sbEq_(id));
      var out = sbRequest_("patch", q, { active: false }, "return=representation");
      return out ? out.length : 0;
    } catch (e) { console.error("storeCancelAlerts: " + e); }
  }
  var all = spGetJson_("TR_ALERTS", { next: 1, items: [] });
  var n = 0;
  all.items.forEach(function (a) {
    if (a.user_id === userId && a.active && (id === "all" || String(a.id) === String(id))) { a.active = false; n++; }
  });
  spSetJson_("TR_ALERTS", all);
  return n;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TRADER SETTINGS (per user)                                  ║
// ╚══════════════════════════════════════════════════════════════╝

function storeGetSettings(userId) {
  if (sbEnabled()) {
    try {
      var rows = sbRequest_("get", "trader_settings?select=settings&channel=" + sbEq_(SB_CHANNEL) +
                            "&user_id=" + sbEq_(userId));
      return rows.length ? rows[0].settings : {};
    } catch (e) { console.error("storeGetSettings: " + e); }
  }
  return spGetJson_("TR_CFG_" + userId, {});
}

function storeSetSettings(userId, settings) {
  if (sbEnabled()) {
    try {
      sbRequest_("post", "trader_settings?on_conflict=channel,user_id",
        { channel: SB_CHANNEL, user_id: userId, settings: settings, updated_at: new Date().toISOString() },
        "resolution=merge-duplicates,return=minimal");
      return;
    } catch (e) { console.error("storeSetSettings: " + e); }
  }
  spSetJson_("TR_CFG_" + userId, settings);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TRADE PLANS / LOG                                           ║
// ╚══════════════════════════════════════════════════════════════╝

function storeSavePlan(userId, symbol, tradeDate, plan, status) {
  var row = { channel: SB_CHANNEL, user_id: userId, symbol: symbol, trade_date: tradeDate,
              status: status || "planned", plan: plan };
  if (sbEnabled()) {
    try { var out = sbRequest_("post", "trade_plans", row, "return=representation"); return out && out[0]; }
    catch (e) { console.error("storeSavePlan: " + e); }
  }
  var all = spGetJson_("TR_PLANS_" + userId, []);
  row.id = Date.now();
  row.created_at = new Date().toISOString();
  all.push(row);
  spSetJson_("TR_PLANS_" + userId, all.slice(-20));
  return row;
}

/** Plans of one New York date (optionally one status). */
function storeGetPlans(userId, tradeDate, status) {
  if (sbEnabled()) {
    try {
      return sbRequest_("get", "trade_plans?select=*&channel=" + sbEq_(SB_CHANNEL) + "&user_id=" + sbEq_(userId) +
        "&trade_date=" + sbEq_(tradeDate) + (status ? "&status=" + sbEq_(status) : "") + "&order=id.asc");
    } catch (e) { console.error("storeGetPlans: " + e); }
  }
  return spGetJson_("TR_PLANS_" + userId, []).filter(function (p) {
    return p.trade_date === tradeDate && (!status || p.status === status);
  });
}

function storeLatestPlan(userId, symbol) {
  if (sbEnabled()) {
    try {
      var rows = sbRequest_("get", "trade_plans?select=*&channel=" + sbEq_(SB_CHANNEL) + "&user_id=" + sbEq_(userId) +
        (symbol ? "&symbol=" + sbEq_(symbol) : "") + "&status=eq.planned&order=id.desc&limit=1");
      return rows[0] || null;
    } catch (e) { console.error("storeLatestPlan: " + e); }
  }
  var all = spGetJson_("TR_PLANS_" + userId, []).filter(function (p) {
    return p.status === "planned" && (!symbol || p.symbol === symbol);
  });
  return all.length ? all[all.length - 1] : null;
}

function storeSetPlanStatus(userId, id, status) {
  if (sbEnabled()) {
    try { sbRequest_("patch", "trade_plans?id=" + sbEq_(id) + "&user_id=" + sbEq_(userId), { status: status }, "return=minimal"); return; }
    catch (e) { console.error("storeSetPlanStatus: " + e); }
  }
  var all = spGetJson_("TR_PLANS_" + userId, []);
  all.forEach(function (p) { if (p.id === id) p.status = status; });
  spSetJson_("TR_PLANS_" + userId, all);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  KV STATE (job memory)                                       ║
// ╚══════════════════════════════════════════════════════════════╝

function storeKvGet(key, dflt) {
  if (sbEnabled()) {
    try {
      var rows = sbRequest_("get", "kv_state?select=value&key=" + sbEq_(key));
      return rows.length ? rows[0].value : dflt;
    } catch (e) { console.error("storeKvGet: " + e); }
  }
  return spGetJson_("KV_" + key, dflt);
}

function storeKvSet(key, value) {
  if (sbEnabled()) {
    try {
      sbRequest_("post", "kv_state?on_conflict=key", { key: key, value: value, updated_at: new Date().toISOString() },
                 "resolution=merge-duplicates,return=minimal");
      return;
    } catch (e) { console.error("storeKvSet: " + e); }
  }
  spSetJson_("KV_" + key, value);
}

/** ทดสอบการเชื่อมต่อ — รันด้วยมือจาก editor */
function testSupabaseConnection() {
  if (!sbEnabled()) { console.log("❌ ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_KEY"); return; }
  try {
    sbRequest_("get", "watchlists?select=symbol&limit=1");
    sbRequest_("get", "price_alerts?select=id&limit=1");
    sbRequest_("get", "trader_settings?select=user_id&limit=1");
    sbRequest_("get", "trade_plans?select=id&limit=1");
    sbRequest_("get", "kv_state?select=key&limit=1");
    console.log("✅ เชื่อม Supabase ได้ ตารางครบ 5 ตาราง");
  } catch (e) { console.log("❌ " + e); }
}
