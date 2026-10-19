-- ------------------------------------------------------------
-- 访问统计（自建、无第三方、无 IP、无跨站追踪）
--
-- 设计取舍：
--   * **不存 IP、不存 User-Agent 原文**。device_hash = HMAC-SHA256(匿名 session id, SESSION_PASSWORD)
--     的前 24 位十六进制，只用于「同一台设备去重 / 回访判断」，无法反推、也无法跨站关联。
--   * day 固定按 **北京时间** 归档（受众在国内），避免「今天」跨时区错位。
--   * kind：view = 打开首页，play = 进入拼图页；两种各记一行，PV 就是行数，UV 就是 distinct device_hash。
--   * 写入只走服务端 service_role（绕过 RLS）；RLS 只放行管理员读。
-- ------------------------------------------------------------
create table if not exists public.visits (
  id            bigserial   primary key,
  day           date        not null default ((now() at time zone 'Asia/Shanghai')::date),
  device_hash   text        not null check (char_length(device_hash) between 8 and 64),
  kind          text        not null check (kind in ('view', 'play')),
  client        text        check (client in ('wechat', 'mobile', 'desktop', 'bot', 'other')),
  referrer_host text,
  created_at    timestamptz not null default now()
);

create index if not exists visits_day_idx        on public.visits (day desc);
create index if not exists visits_day_device_idx on public.visits (day, device_hash);
create index if not exists visits_kind_day_idx   on public.visits (kind, day desc);

alter table public.visits enable row level security;

-- 只有管理员可读（is_admin() 在 20261014000000_init.sql 里定义）
drop policy if exists "visits admin read" on public.visits;
create policy "visits admin read"
  on public.visits
  for select
  to authenticated
  using (public.is_admin());

comment on table public.visits is
  '自建访问计数：只记日期、设备哈希、类型、粗分类客户端与来源域名；不存 IP 与 UA 原文。';
