-- ============================================================
-- photo-puzzle · 初始化 schema / RLS / 私有 bucket
-- 适用：Supabase Postgres（托管）
-- 运行：supabase db push  或  supabase migration up
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. 照片元数据（原图只存在 Storage 私有 bucket，这里只存路径与文案）
-- ------------------------------------------------------------
create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  storage_path        text        not null,          -- 归一化后的「大图」对象路径
  thumb_path          text,                           -- 拼图/相册墙用的缩略图路径
  raw_path            text,                           -- 管理员直传的原始对象路径（可选）
  title               text        not null default '一段回忆',
  unlock_text         text        not null default '你居然真的认识我',
  is_active           boolean     not null default true,
  sort_order          integer     not null default 0,
  width               integer,
  height              integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint photos_storage_path_key unique (storage_path)
);

create index if not exists photos_active_sort_idx
  on public.photos (is_active, sort_order desc, created_at desc);

-- ------------------------------------------------------------
-- 2. 解锁记录（匿名会话维度，用于统计 + 未来跨设备合并）
-- ------------------------------------------------------------
create table if not exists public.unlocks (
  id               uuid primary key default gen_random_uuid(),
  photo_id         uuid        not null references public.photos (id) on delete cascade,
  anon_session_id  text        not null,              -- 服务端签发 cookie 中的 sid，不是认证凭证
  best_time_ms     integer     not null check (best_time_ms > 0 and best_time_ms < 86400000),
  difficulty       smallint    not null check (difficulty in (3, 4, 5)),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint unlocks_photo_session_difficulty_key unique (photo_id, anon_session_id, difficulty)
);

create index if not exists unlocks_photo_idx on public.unlocks (photo_id);
create index if not exists unlocks_session_idx on public.unlocks (anon_session_id);

-- ------------------------------------------------------------
-- 3. 管理员凭据（自建密码登录；不存在客户端可读的字段）
--    优先方案是 Supabase Auth，这里只作为「无 Auth 也可用」的兜底。
-- ------------------------------------------------------------
create table if not exists public.admin_credentials (
  id            integer primary key default 1 check (id = 1),
  password_hash text        not null,                 -- pgcrypto crypt(..., gen_salt('bf', 12))
  updated_at    timestamptz not null default now()
);

-- Supabase Auth 管理员邮箱白名单
create table if not exists public.admin_users (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- 管理操作审计（新增/上下架/删除照片都会落一条）
create table if not exists public.admin_audit_log (
  id          bigserial primary key,
  action      text        not null,
  target_id   uuid,
  detail      jsonb       not null default '{}'::jsonb,
  actor       text        not null default 'unknown',
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. updated_at 自动维护
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists photos_set_updated_at on public.photos;
create trigger photos_set_updated_at
  before update on public.photos
  for each row execute function public.set_updated_at();

drop trigger if exists unlocks_set_updated_at on public.unlocks;
create trigger unlocks_set_updated_at
  before update on public.unlocks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. 管理员判定函数
--    security definer：绕过 admin_users 自身的 RLS，但只暴露 boolean
--    只能由 authenticated 调用，anon 调用直接 false。
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.role(), '') = 'authenticated'
    and exists (
      select 1
      from public.admin_users au
      where au.email = (auth.jwt() ->> 'email')
    );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- 6. 开启 RLS + 策略
--    原则：默认拒绝；anon 只能读 is_active = true 的照片元数据。
-- ------------------------------------------------------------
alter table public.photos           enable row level security;
alter table public.unlocks          enable row level security;
alter table public.admin_credentials enable row level security;
alter table public.admin_users      enable row level security;
alter table public.admin_audit_log  enable row level security;

-- photos：anon 仅可读「已上架」的元数据（storage_path 不等于可访问权限）
drop policy if exists "photos anon read active" on public.photos;
create policy "photos anon read active"
  on public.photos
  for select
  to anon
  using (is_active = true);

-- photos：authenticated 中仅白名单管理员可读写
drop policy if exists "photos admin read all" on public.photos;
create policy "photos admin read all"
  on public.photos
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "photos admin write" on public.photos;
create policy "photos admin write"
  on public.photos
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- unlocks：不通匿名开放读写（服务端用 service_role 写入）；仅管理员可读
drop policy if exists "unlocks admin read" on public.unlocks;
create policy "unlocks admin read"
  on public.unlocks
  for select
  to authenticated
  using (public.is_admin());

-- admin_audit_log：仅管理员可读（写入通过 service_role）
drop policy if exists "audit admin read" on public.admin_audit_log;
create policy "audit admin read"
  on public.admin_audit_log
  for select
  to authenticated
  using (public.is_admin());

-- admin_users / admin_credentials：不创建任何 policy → 默认全拒。
-- 服务端 service_role 绕过 RLS，函数 security definer 亦可读取。

-- ------------------------------------------------------------
-- 7. 私有 bucket
--    注意：storage.objects 的 owner 是 supabase_storage_admin，
--    postgres 角色不能对其执行 ALTER TABLE / ENABLE ROW LEVEL SECURITY，
--    因此 storage 的 policy 单独放在 20261014000100_storage_policies.sql，
--    且只包含 CREATE POLICY 语句。
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
