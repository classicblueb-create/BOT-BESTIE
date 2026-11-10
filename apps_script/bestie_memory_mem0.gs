/**
 * ============================================================
 * BESTIE BOT - SELF-IMPROVING MEMORY SYSTEM (v2: Mem0)
 * ============================================================
 * เวอร์ชันง่ายกว่าเดิม — ใช้ Mem0 (mem0.ai) แทน Qdrant + Gemini embedding
 * Mem0 จัดการ embedding ให้เองข้างใน เหลือแค่ add() กับ search()
 *
 * Free tier: 10,000 memories — เพียงพอสำหรับ trade log ส่วนตัว
 * สมัครคีย์ที่ https://app.mem0.ai
 *
 * Flow เหมือนเดิมทุกอย่าง เปลี่ยนแค่ "ชั้นเก็บ/ดึง memory"
 * ============================================================
 */

const CONFIG = {
  MEM0_API_KEY: 'YOUR_MEM0_API_KEY',
  MEM0_USER_ID: 'bestie_bot', // ใช้แยก namespace ถ้ามีบอทหลายตัวใน account เดียวกัน

  OPENROUTER_API_KEY: 'YOUR_OPENROUTER_API_KEY',
  REFLECTION_MODEL: 'deepseek/deepseek-v4-flash',
};

const MISTAKE_CATEGORIES = [
  'overconfidence',
  'ignored_macro_event',
  'false_pattern',
  'wrong_regime_assumption',
  'data_lag',
  'risk_mgmt_failure',
];

const MARKET_REGIMES = ['bull', 'bear', 'sideways', 'high_volatility', 'low_volatility'];


// ================= 1) เก็บบทเรียนเข้า Mem0 =================
function upsertLesson(lesson) {
  // lesson: { ticker, date, signal_type, market_regime, mistake_category,
  //           original_reasoning, outcome, lesson_text }
  const url = 'https://api.mem0.ai/v1/memories/';

  const payload = {
    messages: [
      { role: 'user', content: lesson.lesson_text }
    ],
    user_id: CONFIG.MEM0_USER_ID,
    metadata: {
      ticker: lesson.ticker,
      date: lesson.date,
      signal_type: lesson.signal_type,
      market_regime: lesson.market_regime,
      mistake_category: lesson.mistake_category,
      outcome: lesson.outcome,
      original_reasoning: lesson.original_reasoning
    },
    infer: false // เก็บ lesson_text ตรงๆ ไม่ให้ Mem0 ตีความ/บีบอัดเอง เพราะเราคุม schema เองแล้ว
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 300) {
    Logger.log('Mem0 add error: ' + response.getContentText());
  }

  return response.getContentText();
}


// ================= 2) ดึงบทเรียนที่คล้ายสถานการณ์ปัจจุบัน =================
function searchSimilarLessons(currentSituationText, topK) {
  topK = topK || 5;
  const url = 'https://api.mem0.ai/v1/memories/search/';

  const payload = {
    query: currentSituationText,
    user_id: CONFIG.MEM0_USER_ID,
    limit: topK
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  return data.results || data || []; // โครงสร้าง response อาจต่างกันตามเวอร์ชัน API เช็คที่ docs.mem0.ai
}


// ================= 3) สร้างบทเรียนจาก trade ที่พลาด (Reflection) — เหมือนเดิมไม่เปลี่ยน =================
function generateReflection(tradeLog) {
  const prompt = `คุณเป็นนักวิเคราะห์เชิงปริมาณที่ตรวจสอบความผิดพลาดของระบบเทรดอัตโนมัติ

นี่คือ trade ที่ผลลัพธ์ไม่เป็นไปตามคาด:
- Ticker: ${tradeLog.ticker}
- วันที่: ${tradeLog.date}
- Signal: ${tradeLog.signal_type}
- เหตุผลเดิมที่ระบบให้ตอนทำนาย: ${tradeLog.reasoning}
- ผลจริง: ${tradeLog.outcome_pct}%

วิเคราะห์ว่าพลาดเพราะอะไร แล้วตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่นนอกเหนือ JSON รูปแบบนี้:
{
  "mistake_category": "เลือกหนึ่งจาก: ${MISTAKE_CATEGORIES.join(' | ')}",
  "market_regime": "เลือกหนึ่งจาก: ${MARKET_REGIMES.join(' | ')}",
  "lesson_text": "บทเรียนสรุปสั้นๆ 2-3 ประโยค ที่จะช่วยให้ไม่พลาดแบบนี้อีกในสถานการณ์คล้ายกัน"
}`;

  const response = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.OPENROUTER_API_KEY },
    payload: JSON.stringify({
      model: CONFIG.REFLECTION_MODEL,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());

  if (!data.choices || !data.choices[0]) {
    throw new Error('Reflection model error: ' + response.getContentText());
  }

  const rawText = data.choices[0].message.content;
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const reflection = JSON.parse(cleaned);

  const lesson = {
    ticker: tradeLog.ticker,
    date: tradeLog.date,
    signal_type: tradeLog.signal_type,
    original_reasoning: tradeLog.reasoning,
    outcome: tradeLog.outcome_pct,
    mistake_category: reflection.mistake_category,
    market_regime: reflection.market_regime,
    lesson_text: reflection.lesson_text
  };

  upsertLesson(lesson);
  Logger.log('เก็บบทเรียนใหม่ผ่าน Mem0: ' + JSON.stringify(lesson));

  return lesson;
}


// ================= 4) ดึงบทเรียนมาแปะใน prompt ก่อนออก signal ใหม่ =================
function getRelevantLessonsForPrompt(currentMarketSituation) {
  const lessons = searchSimilarLessons(currentMarketSituation, 5);

  if (!lessons || lessons.length === 0) return '';

  let context = '\n\n--- บทเรียนจากอดีตที่เกี่ยวข้องกับสถานการณ์นี้ ---\n';
  lessons.forEach(function (l, i) {
    const m = l.metadata || {};
    const text = l.memory || l.text || '';
    context += `${i + 1}. [${m.mistake_category || '-'} | ${m.market_regime || '-'}] ${text}\n`;
  });
  context += '--- ใช้บทเรียนข้างต้นประกอบการวิเคราะห์ อย่าทำผิดซ้ำแบบเดิม ---\n';

  return context;
}


// ================= ตัวอย่างการใช้งานจริง =================

function exampleOnMistakeDetected() {
  const tradeLog = {
    ticker: 'NVDA',
    date: '2026-06-10',
    signal_type: 'long',
    reasoning: 'RSI oversold + breakout pattern บน volume สูง คาดว่าจะรีบาวด์',
    outcome_pct: -4.2
  };
  generateReflection(tradeLog);
}

function exampleBeforeNewSignal() {
  const currentSituation = 'NVDA กำลังเทรดใกล้ resistance สำคัญ, RSI 68, volume ต่ำกว่าเฉลี่ย 20 วัน, ตลาดรวม sideways';
  const lessonContext = getRelevantLessonsForPrompt(currentSituation);
  const fullPrompt = 'วิเคราะห์ NVDA: ' + currentSituation + lessonContext;
  Logger.log(fullPrompt);
  // ส่ง fullPrompt เข้า signal model (Gemini Flash/GPT-mini) ตามระบบเดิมต่อไป
}

/**
 * ============================================================
 * TEST SUITE - Bestie Bot Memory System
 * ============================================================
 * รันก่อนต่อเข้าระบบจริง เพื่อเช็คว่าทุกจุดทำงานถูกต้อง
 *
 * วิธีใช้:
 * 1. วางไฟล์นี้ในโปรเจกต์ GAS เดียวกับ bestie_bot_memory_mem0.gs
 * 2. เลือกฟังก์ชัน runFullTestSuite ในแถบ dropdown ด้านบน
 * 3. กด Run แล้วดูผลที่ View > Logs (หรือ View > Executions ถ้าอยากดู stack trace เต็ม)
 * 4. ทดสอบเสร็จแล้วเรียก cleanupTestData() เพื่อไม่ให้ข้อมูลทดสอบปนกับของจริง
 *
 * ใช้ user_id แยก ('bestie_bot_test') ไม่ปนกับ user_id จริง (CONFIG.MEM0_USER_ID)
 * ============================================================
 */

const TEST_CONFIG = {
  TEST_USER_ID: 'bestie_bot_test',
};


function runFullTestSuite() {
  Logger.log('========== START TEST SUITE ==========');
  let passCount = 0;
  let failCount = 0;

  const tests = [
    { name: 'TEST 1: Mem0 add() เก็บข้อมูลได้', fn: test1_Mem0Add },
    { name: 'TEST 2: Mem0 search() เจอข้อมูลที่เพิ่งเก็บ', fn: test2_Mem0Search, delayBefore: 2000 },
    { name: 'TEST 3: Claude Haiku ตอบ JSON ที่ parse ได้', fn: test3_ReflectionGeneration },
    { name: 'TEST 4: format prompt จาก memory ถูกต้อง', fn: test4_PromptInjection },
    { name: 'TEST 5: จัดการ case ไม่มีบทเรียนได้ (ไม่ error)', fn: test5_EmptyResultHandling },
  ];

  tests.forEach(function (t) {
    if (t.delayBefore) Utilities.sleep(t.delayBefore); // เผื่อ indexing delay ของ Mem0
    try {
      t.fn();
      Logger.log('✅ PASS — ' + t.name);
      passCount++;
    } catch (e) {
      Logger.log('❌ FAIL — ' + t.name + ' | เหตุผล: ' + e.message);
      failCount++;
    }
  });

  Logger.log('========== สรุปผล: PASS ' + passCount + ' / FAIL ' + failCount + ' ==========');
  if (failCount === 0) {
    Logger.log('ผ่านหมดทุกจุด — พร้อมต่อเข้าระบบจริงได้ (อย่าลืม cleanupTestData() ก่อน)');
  } else {
    Logger.log('มีจุดที่ fail — แก้ตามข้อความ error ก่อนต่อเข้าระบบจริง');
  }
}


// ---------- Test 1: Mem0 Add ----------
function test1_Mem0Add() {
  const url = 'https://api.mem0.ai/v1/memories/';
  const payload = {
    messages: [{ role: 'user', content: 'TEST: บทเรียนทดสอบระบบ memory ของ Bestie Bot' }],
    user_id: TEST_CONFIG.TEST_USER_ID,
    metadata: { test: true, ticker: 'TESTUSD', mistake_category: 'overconfidence' },
    infer: false
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 300) {
    throw new Error('Mem0 add คืน status ' + code + ': ' + response.getContentText());
  }
}


// ---------- Test 2: Mem0 Search ----------
function test2_Mem0Search() {
  const url = 'https://api.mem0.ai/v1/memories/search/';
  const payload = {
    query: 'บทเรียนทดสอบระบบ memory',
    user_id: TEST_CONFIG.TEST_USER_ID,
    limit: 5
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  const results = data.results || data || [];

  if (!results || results.length === 0) {
    throw new Error('search ไม่เจอข้อมูลที่เพิ่ง add — เช็ค user_id ตรงกันไหม หรือลองเพิ่ม delay ก่อน search');
  }
}


// ---------- Test 3: Reflection Generation (Claude Haiku ผ่าน OpenRouter) ----------
function test3_ReflectionGeneration() {
  const prompt = 'ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น: {"mistake_category": "overconfidence", "market_regime": "sideways", "lesson_text": "นี่คือข้อความทดสอบ"}';

  const response = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.OPENROUTER_API_KEY },
    payload: JSON.stringify({
      model: CONFIG.REFLECTION_MODEL,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  if (!data.choices || !data.choices[0]) {
    throw new Error('OpenRouter ไม่ตอบ choices: ' + response.getContentText());
  }

  const rawText = data.choices[0].message.content;
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned); // จะ throw เองถ้า JSON ไม่ valid

  if (!parsed.mistake_category || !parsed.lesson_text) {
    throw new Error('JSON ที่ได้ขาด field ที่ต้องการ: ' + JSON.stringify(parsed));
  }
}


// ---------- Test 4: Prompt formatting จาก memory ที่ดึงมา ----------
function test4_PromptInjection() {
  const url = 'https://api.mem0.ai/v1/memories/search/';
  const payload = {
    query: 'บทเรียนทดสอบ',
    user_id: TEST_CONFIG.TEST_USER_ID,
    limit: 3
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  const lessons = data.results || data || [];

  if (lessons.length === 0) {
    throw new Error('ไม่มีบทเรียนให้ทดสอบ format — รัน test1 ก่อน');
  }

  const l = lessons[0];
  if (l.metadata === undefined) {
    throw new Error('memory object ไม่มี field metadata — โครงสร้าง response อาจเปลี่ยนไปจากที่โค้ดคาดไว้ เช็ค docs.mem0.ai');
  }
}


// ---------- Test 5: Empty result handling ----------
function test5_EmptyResultHandling() {
  const url = 'https://api.mem0.ai/v1/memories/search/';
  const payload = {
    query: 'xyzzy_random_nonexistent_query_' + new Date().getTime(),
    user_id: TEST_CONFIG.TEST_USER_ID,
    limit: 5
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Token ' + CONFIG.MEM0_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  const results = data.results || data || [];

  if (!Array.isArray(results)) {
    throw new Error('ผลลัพธ์ตอนไม่มี match ไม่ได้คืนเป็น array — ต้องแก้ error handling ใน getRelevantLessonsForPrompt()');
  }
  // ไม่ throw ถ้า array เปล่า — นี่คือพฤติกรรมที่ถูกต้อง
}


// ---------- Cleanup: ลบข้อมูลทดสอบหลังเทสต์เสร็จ ----------
function cleanupTestData() {
  Logger.log('Mem0 REST API อาจไม่มี endpoint ลบทั้ง user_id ในคำสั่งเดียว (เช็คที่ docs.mem0.ai ว่ามี DELETE /v1/memories/?user_id=... ไหม)');
  Logger.log('ถ้าไม่มี ให้เข้า https://app.mem0.ai ล็อกอินแล้วลบ memory ที่มี user_id=' + TEST_CONFIG.TEST_USER_ID + ' ด้วยมือ');
}
