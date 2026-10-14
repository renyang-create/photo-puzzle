import {
  bootstrapAdminPassword,
  checkAdmin,
  hasAdminCredential,
  issueAdminCookie,
  verifyPassword,
  writeAudit,
} from "@/lib/admin-auth";
import { guardRequest, jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/login
 *
 * 两条路径，任选其一或并存：
 *   1. Supabase Auth：{ email, password } → 登录后校验邮箱是否在 admin_users / ADMIN_EMAILS 白名单；
 *   2. 自建密码：{ password }（首次部署时额外带 { setupToken } 完成初始化）。
 * 密码只在服务端做 bcrypt 比对，前端没有任何校验逻辑。
 */
export async function POST(request: Request) {
  // 登录是最容易被撞库的入口，单独收紧限流
  const blocked = guardRequest(request, "admin-login", { windowMs: 60_000, max: 8 });
  if (blocked) return blocked;

  const parsed = await parseJsonBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;
  const { email, password, setupToken } = parsed.data;

  try {
    if (email) {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password,
      });
      if (error || !data.user) {
        return jsonError("unauthorized", "邮箱或密码不正确");
      }

      const check = await checkAdmin();
      if (!check.isAdmin) {
        await supabase.auth.signOut();
        await writeAudit("admin.login.denied", null, { email }, email);
        return jsonError(
          "forbidden",
          "该账号不在管理员白名单里（请把邮箱写入 public.admin_users 或 ADMIN_EMAILS）",
        );
      }

      await issueAdminCookie(check.identity);
      await writeAudit("admin.login", null, { method: "supabase" }, check.identity.actor);
      return jsonOk({ ok: true, actor: check.identity.actor, method: "supabase" });
    }

    if (!(await hasAdminCredential())) {
      if (!setupToken) {
        return jsonError(
          "unauthorized",
          "尚未初始化管理员密码：请带上 ADMIN_SETUP_TOKEN 与环境变量中的值一起提交",
        );
      }
      const boot = await bootstrapAdminPassword(setupToken, password);
      if (!boot.ok) return jsonError("unauthorized", boot.error);
      await issueAdminCookie({ actor: "owner", method: "password" });
      return jsonOk({ ok: true, actor: "owner", method: "password", initialized: true });
    }

    const verified = await verifyPassword(password);
    if (!verified.ok) {
      await writeAudit("admin.login.failed", null, {}, "unknown");
      return jsonError("unauthorized", verified.error);
    }

    await issueAdminCookie({ actor: "owner", method: "password" });
    await writeAudit("admin.login", null, { method: "password" }, "owner");
    return jsonOk({ ok: true, actor: "owner", method: "password" });
  } catch (error) {
    console.error("[api/admin/login]", error);
    return jsonError("server_error", "登录失败，请检查服务端环境变量与数据库状态");
  }
}
