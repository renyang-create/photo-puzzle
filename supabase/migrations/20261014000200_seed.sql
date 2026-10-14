-- ============================================================
-- photo-puzzle · seed
--   * 幂等：重复执行不会覆盖已有管理员密码
--   * 初始管理员密码为「随机生成」，只在执行时通过 RAISE NOTICE 打印一次
--     （仓库里不存在任何明文密码，也不存在默认 admin123）
-- 运行：supabase db push（会带上本文件）
--      或直接在 SQL Editor 执行
-- ============================================================

do $$
declare
  v_password text;
begin
  -- 1) 初始管理员密码：仅当还没有任何凭据时生成
  if exists (select 1 from public.admin_credentials where id = 1) then
    raise notice '[seed] admin_credentials 已存在，跳过初始化（不会覆盖现有密码）。';
  else
    -- 24 字节随机 → 32 位 base64，避免肉眼可猜
    v_password := translate(encode(gen_random_bytes(24), 'base64'), '+/=', 'xyz');

    insert into public.admin_credentials (id, password_hash, updated_at)
    values (1, crypt(v_password, gen_salt('bf', 12)), now());

    raise notice '============================================================';
    raise notice '[seed] 初始管理员密码（只显示这一次，请立刻保存）：%', v_password;
    raise notice '[seed] 登录入口：连续点击封面标题 5 次 或 直接访问 /admin';
    raise notice '[seed] 登录后请立即在 /admin 修改密码。';
    raise notice '============================================================';
  end if;

  -- 2) bucket 兜底（正常已在 init migration 建好）
  insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do update set public = false;

  -- 3) 若使用 Supabase Auth 登录管理员，请把邮箱写进白名单，例如：
  -- insert into public.admin_users (email, note)
  -- values ('you@example.com', 'owner')
  -- on conflict (email) do nothing;

  raise notice '[seed] 完成。别忘了：storage.objects 的 policy 在下一支 migration 中。';
end $$;
