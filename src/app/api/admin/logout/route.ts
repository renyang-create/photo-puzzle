import { logoutAdmin } from "@/lib/admin-auth";
import { guardRequest, jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/logout：清掉自建 session cookie 与 Supabase session */
export async function POST(request: Request) {
  const blocked = guardRequest(request, "admin-logout", { max: 20 });
  if (blocked) return blocked;

  try {
    await logoutAdmin();
    return jsonOk({ ok: true });
  } catch (error) {
    console.error("[api/admin/logout]", error);
    return jsonError("server_error", "退出失败");
  }
}
