-- ============================================================
-- photo-puzzle · storage.objects RLS（policy-only）
--
-- 重要（Supabase 托管项目的坑）：
--   storage.objects 的 owner 是 supabase_storage_admin，
--   postgres / dashboard 用户都不能对它执行 ALTER TABLE 或
--   ENABLE / DISABLE ROW LEVEL SECURITY。
--   因此本文件只包含 CREATE POLICY 语句，
--   这样 `supabase db push` 才能干净应用。
--
-- 补充：storage.objects 的表级权限由 Supabase 预置给 anon / authenticated，
--       本文件只需要处理行级策略，不需要额外 GRANT。
--
-- 语义：
--   * anon：没有任何 policy → 既不能 list，也不能 download。
--     拼图/相册墙的图片一律走服务端 createSignedUrl（5 分钟）签发的短期链接。
--   * authenticated：也要满足 public.is_admin()（admin_users 白名单）才能读写。
--     注意 uploadToSignedUrl 走签名令牌校验，不依赖这里的 policy。
-- ============================================================

CREATE POLICY "admins read files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.is_admin());

CREATE POLICY "admins insert files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND public.is_admin());

CREATE POLICY "admins update files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'photos' AND public.is_admin());

CREATE POLICY "admins delete files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND public.is_admin());
