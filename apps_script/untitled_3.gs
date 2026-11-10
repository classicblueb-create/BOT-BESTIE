function cleanupOldProperties() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  var deleted = 0;

  // ลบเฉพาะ key ที่เป็น cache/temp — ไม่แตะ token และ API keys
  var safeToDelete = ["LAST_SNIPER_ALERT_", "NEWHIGH_V2_", "INSIGHT_USED_",
    "LAST_MORNING_", "LAST_EVENING_", "LAST_GOLD_", "LAST_MINDSET_",
    "LAST_PREMARKET_", "LAST_ECON_CAL_", "LAST_WEEKLY_", "LAST_PROMO_",
    "LAST_MARKET_PULSE_", "INSIGHT_AM_", "INSIGHT_PM_", "INSIGHT_EVE_",
    "WL_CACHE_", "BESTIE_TRENDING_"];

  Object.keys(all).forEach(function(key) {
    if (safeToDelete.some(function(prefix) { return key.startsWith(prefix); })) {
      props.deleteProperty(key);
      deleted++;
    }
  });

  console.log("Deleted " + deleted + " old properties");
  console.log("Remaining: " + Object.keys(props.getProperties()).length);
}
