# Bestie Bot — Apps Script (LINE)

โค้ดฝั่ง LINE รันบน Google Apps Script โปรเจกต์ "BESTIE BOT"
ไฟล์หลักคือ `../App Script` (ใน Apps Script ชื่อ `รหัส.gs`) ส่วนไฟล์ในโฟลเดอร์นี้เป็นไฟล์ `.gs` อื่นในโปรเจกต์เดียวกัน
ทุกไฟล์ใช้ global scope ร่วมกัน

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase_store.gs` | ที่เก็บถาวรใน Supabase: watchlist, การเตือนราคา, ค่าความเสี่ยง, แผนเทรด (ถ้ายังไม่ได้ตั้งค่า Supabase จะใช้ Script Properties แทน) |
| `trader_core.gs` | ระบบเทรดที่ port มาจาก day-trader-skill: เวลา NY/NYSE, scanner, entry, exit, budget, risk, time machine, alerts, news, analyst |
| `trader_line.gs` | คำสั่ง LINE, trigger เช็คการเตือน และ hook ที่ป้อนตัวเลขให้ Swing เดิม |
| `bestie_memory_mem0.gs`, `untitled*.gs`, `appsscript.json` | ไฟล์เดิมในโปรเจกต์ |

## ติดตั้ง

1. **Supabase**: สร้างโปรเจกต์ แล้วไปที่ SQL Editor → วางเนื้อหา `../supabase/schema.sql` → กด Run
2. **Apps Script → Project Settings → Script Properties** เพิ่มค่าเหล่านี้
   - `SUPABASE_URL` = `https://<project>.supabase.co`
   - `SUPABASE_SERVICE_KEY` = service_role key (Supabase → Settings → API) **ห้ามใส่ในโค้ด**
   - `SEC_USER_AGENT` = `ชื่อ อีเมล` (ใช้กับคำสั่ง `งบ` และ 8-K ใน `ข่าว` เพราะ SEC บังคับให้ระบุตัวตน)
   - (ไม่บังคับ) `SCAN_UNIVERSE` = `AAPL,MSFT,...` ใช้แทนรายชื่อหุ้น 120 ตัวที่สแกนเป็นค่าเริ่มต้น
3. วางโค้ดใน Apps Script
   - เปิด `รหัส.gs` แทนที่ทั้งไฟล์ด้วยเนื้อหาของ `../App Script`
   - กด ➕ → Script สร้างไฟล์ `supabase_store`, `trader_core` และ `trader_line` แล้ววางเนื้อหาของแต่ละไฟล์
4. เลือกฟังก์ชันจาก editor แล้วกด Run ตามลำดับ
   - `testSupabaseConnection` ควรขึ้น ✅ ตารางครบ 5 ตาราง
   - `migrateWatchlistsToSupabase` ย้าย watchlist เดิมขึ้น Supabase (รันครั้งเดียว)
   - `traderInstallTriggers` ตั้ง trigger `traderAlertsTick` ให้รันทุก 5 นาที
5. **Deploy → Manage deployments → Edit → New version** (ถ้าไม่ทำขั้นนี้ webhook ของ LINE จะยังเรียกโค้ดเก่า)

## คำสั่งใน LINE

พิมพ์ `เทรดเดอร์` เพื่อดูเมนูคำสั่งทั้งหมด:
`สแกน`, `สแกน orb`, `เข้าไหม TSLA`, `แผน TSLA`, `โอกาส TSLA`, `เตือน TSLA > 400`, `เตือนแผน TSLA`,
`ข่าว TSLA`, `งบ TSLA`, `ตั้งค่าเทรด`, `ตั้งค่า maxloss 50`, `เข้าไม้แล้ว TSLA`

คำสั่ง `swing NVDA` เดิมจะได้ Entry / Stop / Target / ขนาดไม้ ที่คำนวณด้วยโค้ด (1.5×ATR14 รายวัน, 2R) แล้ว AI ทำหน้าที่อธิบายเท่านั้น

## ข้อจำกัด

- **บอทไม่ส่งคำสั่งซื้อขายจริง** เพราะเป็น bot ให้ข้อมูลแบบ broadcast (ไม่ได้ port trader-broker และ trader-pelosi มา)
- การเตือนราคาส่งผ่าน LINE **push message** ซึ่งนับรวมใน quota ข้อความรายเดือนของ LINE OA
- ข้อมูลจาก Yahoo ไม่ใช่ API ทางการ อาจดีเลย์ การสแกนจึงจำกัดไว้ที่ ~120 ตัว บวกหุ้นใน watchlist ของผู้ใช้ เพื่อไม่ให้ชน quota UrlFetch (20,000 ครั้ง/วัน)
- Time Machine ใช้ seeded RNG ของ JavaScript จึงได้ตัวเลขใกล้กับเวอร์ชัน Python แต่ไม่ตรงทุกหลัก (ส่วน history ตรงกันทุกตัว)

## เครดิต

`trader_core.gs` และ `trader_line.gs` ดัดแปลงจาก [day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill)
— MIT License, Copyright (c) Jake Schincariol
