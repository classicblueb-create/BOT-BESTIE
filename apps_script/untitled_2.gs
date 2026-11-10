function checkQuota() {
  const token = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/quota/consumption", {
    "method": "get",
    "headers": { "Authorization": "Bearer " + token },
    "muteHttpExceptions": true
  });
  console.log(res.getContentText());
}

