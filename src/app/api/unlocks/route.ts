import { guardRequest, jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { PhotoNotFoundError, recordUnlock } from "@/lib/photos.service";
import { ensureAnonSession } from "@/lib/session";
import { unlockPayloadSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/unlocks
 * 记录一次解锁 + 刷新最佳成绩，并「顺便」把解锁文案还给客户端 ——
 * 也就是说 unlock_text 在拼好之前永远不会写到浏览器里。
 *
 * 身份口径：anon_session_id 来自服务端签发、HttpOnly 的匿名 cookie，
 * 不是 localStorage 里的 deviceId（那个只用于本机体验，可被随意伪造）。
 */
export async function POST(request: Request) {
  const blocked = guardRequest(request, "unlocks", { max: 40 });
  if (blocked) return blocked;

  const parsed = await parseJsonBody(request, unlockPayloadSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const sessionId = await ensureAnonSession();
    const result = await recordUnlock({
      photoId: parsed.data.photoId,
      sessionId,
      difficulty: parsed.data.difficulty,
      timeMs: parsed.data.timeMs,
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof PhotoNotFoundError) {
      return jsonError("not_found", error.message);
    }
    console.error("[api/unlocks]", error);
    return jsonError("server_error", "记录解锁失败");
  }
}
