-- ============================================================
-- photo-puzzle · 收紧 anon 对 photos 表的「列级」读取权限
--
-- 【背景：安全审计实测发现】
--   anon key 是**公开**的（随前端 bundle 下发，任何人都能取到）。
--   之前 anon 持有的是整表 SELECT（grant select on public.photos to anon），
--   而 RLS 只负责收窄「行」（is_active = true），不限制「列」。
--   结果：任何人用 anon key 直接打 REST 接口，都能读到
--         · unlock_text        → 解锁专属文案被提前剧透
--         · storage_path / thumb_path / raw_path → 私有 bucket 的对象路径
--   实测：GET /rest/v1/photos?select=id,unlock_text → 200 且返回文案
--         （对照：unlocks / admin_credentials / admin_users 均 42501 拒绝，说明 RLS 本身是好的）
--
-- 【本文件做什么：选项 A】
--   保留「匿名只能读『已上架』照片的元数据」这一语义，只砍掉敏感列：
--   整表授权 → 列级授权，anon 仅可读：
--     id, title, is_active, sort_order, created_at
--   仍然叠加 RLS（只能看到 is_active = true 的行）→ 行 + 列 两层收窄。
--
-- 【为什么不会影响线上站点】
--   · 本站所有照片 / 解锁数据的读写都在**服务端**完成，用的是 service_role
--     （src/lib/photos.service.ts 顶部 `import "server-only"` + getAdminClient()），
--     service_role 权限不变量，不受本文件影响；
--   · 浏览器端唯一一次 Supabase 调用是管理员上传照片用的 uploadToSignedUrl，
--     它依靠**一次性签名令牌**校验（见 20261014000100_storage_policies.sql 的说明），
--     不依赖这里的表/列权限。
--   → 无需改任何代码，也无需重新部署；对已经发出去的链接无感。
--
-- 【执行方式】
--   Supabase 控制台 → SQL Editor → 粘贴本文件内容 → Run
--   或：pnpm db:push
--
-- 【回滚（一行复原）】
--   grant select on public.photos to anon;
-- ============================================================

-- 1) 撤销整表 SELECT，改成只授予非敏感列
revoke select on public.photos from anon;

grant select (
  id,
  title,
  is_active,
  sort_order,
  created_at
) on public.photos to anon;

-- 2) 防御性补一刀：万一历史上存在过列级授权，这里再显式撤掉敏感列
--    （在干净库上执行会输出 "no privileges could be revoked" 之类的提示，属正常，不是错误）
revoke select (
  storage_path,
  thumb_path,
  raw_path,
  unlock_text,
  width,
  height,
  updated_at
) on public.photos from anon;

-- 3) 让 PostgREST 立刻刷新权限快照，避免仍按旧权限放行
notify pgrst, 'reload schema';
