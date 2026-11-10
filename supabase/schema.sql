-- ============================================================
-- Bestie Bot — Supabase schema
-- รันไฟล์นี้ใน Supabase Dashboard → SQL Editor → New query → Run
--
-- ใช้ร่วมกันทั้ง LINE (Apps Script, channel = 'line')
-- และ Telegram (Python, channel = 'telegram')
--
-- บอทเรียกผ่าน REST ด้วย service_role key (ข้าม RLS)
-- เปิด RLS ไว้โดยไม่มี policy → anon key อ่าน/เขียนไม่ได้เลย
-- ============================================================

-- ── Watchlist (แทน watchlist.json / Script Properties WL_*) ──
create table if not exists public.watchlists (
  channel    text        not null,             -- 'line' | 'telegram'
  user_id    text        not null,
  symbol     text        not null,
  created_at timestamptz not null default now(),
  primary key (channel, user_id, symbol)
);

-- ── Price alerts (trader-alerts) ──
create table if not exists public.price_alerts (
  id         bigint generated always as identity primary key,
  channel    text        not null,
  user_id    text        not null,
  symbol     text        not null,
  kind       text        not null check (kind in ('above','below','stop','target','pct_up','pct_down','flat_by','bell')),
  level      numeric,                          -- ราคา หรือ % (pct_up/pct_down); flat_by/bell = null
  note       text,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  fired_at   timestamptz,
  fired_price numeric
);
create index if not exists price_alerts_active_idx on public.price_alerts (active, channel);
create index if not exists price_alerts_user_idx   on public.price_alerts (channel, user_id);

-- ── ค่าความเสี่ยงต่อผู้ใช้ (trader-budget / trader-risk config) ──
create table if not exists public.trader_settings (
  channel    text        not null,
  user_id    text        not null,
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (channel, user_id)
);

-- ── แผนเทรด + บันทึกไม้ที่ผู้ใช้ยืนยัน (trader-exit / trader-broker) ──
create table if not exists public.trade_plans (
  id         bigint generated always as identity primary key,
  channel    text        not null,
  user_id    text        not null,
  symbol     text        not null,
  trade_date date        not null,             -- วันที่ตามเวลานิวยอร์ก
  status     text        not null default 'planned' check (status in ('planned','taken','closed','cancelled')),
  plan       jsonb       not null,             -- entry/stop/target/qty/max_loss/...
  created_at timestamptz not null default now()
);
create index if not exists trade_plans_user_day_idx on public.trade_plans (channel, user_id, trade_date);

-- ── State เล็กๆ ของ job (เช่น DocID ของ Pelosi ที่แจ้งไปแล้ว) ──
create table if not exists public.kv_state (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.watchlists      enable row level security;
alter table public.price_alerts    enable row level security;
alter table public.trader_settings enable row level security;
alter table public.trade_plans     enable row level security;
alter table public.kv_state        enable row level security;
