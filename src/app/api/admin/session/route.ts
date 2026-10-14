import { checkAdmin, hasAdminCredential } from "@/lib/admin-auth";
import { jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/session：给管理界面判断「登录了没 / 是否还处于初始化阶段」 */
export async function GET() {
  try {
    const [check, initialized] = await Promise.all([
      checkAdmin(),
      hasAdminCredential(),
    ]);
    return jsonOk({
      ok: true,
      authenticated: check.isAdmin,
      actor: check.isAdmin ? check.identity.actor : null,
      method: check.isAdmin ? check.identity.method : null,
      initialized,
    });
  } catch (error) {
    console.error("[api/admin/session]", error);
    return jsonOk({
      ok: true,
      authenticated: false,
      actor: null,
      method: null,
      initialized: true,
    });
  }
}
