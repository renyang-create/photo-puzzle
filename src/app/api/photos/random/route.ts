import { guardRequest, jsonError, jsonOk } from "@/lib/http";
import { pickRandomPhoto } from "@/lib/photos.service";
import { toDifficulty } from "@/lib/puzzle";
import { ensureAnonSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/photos/random?difficulty=3
 * 随机抽一张「当前匿名会话还没解锁过」的照片；全解锁后就随机任意一张。
 * 只返回缩略图的短期 signed URL + 标题，unlock_text 要等拼好之后才给（见 /api/unlocks）。
 */
export async function GET(request: Request) {
  const blocked = guardRequest(request, "photos-random", { max: 60 });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const difficulty = toDifficulty(url.searchParams.get("difficulty"));
    const sessionId = await ensureAnonSession();

    const photo = await pickRandomPhoto(sessionId, difficulty);
    if (!photo) {
      return jsonError("not_found", "照片池还是空的，等主人上传吧");
    }

    return jsonOk({ ok: true, photo });
  } catch (error) {
    console.error("[api/photos/random]", error);
    return jsonError("server_error", "抽照片失败，请稍后重试");
  }
}
