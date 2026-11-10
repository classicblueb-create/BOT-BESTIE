function testNewModel() {
  var props  = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty("OPENROUTER_API_KEY");
  
  var res = UrlFetchApp.fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", muteHttpExceptions: true,
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    payload: JSON.stringify({
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      max_tokens: 50,
      messages: [{ role: "user", content: "ตอบว่า OK ได้เลย" }]
    })
  });
  
  console.log("Status: " + res.getResponseCode());
  console.log("Response: " + res.getContentText().substring(0, 200));
}
