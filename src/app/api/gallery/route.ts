import { guardRequest, jsonError, jsonOk } from "@/lib/http";
import { buildGallery } from "@/lib/photos.service";
import { ensureAnonSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gallery
 * 相册墙元数据：已解锁的给清晰图（5 分钟 signed URL），未解锁的不返回任何图片信息。
 * 图片列表来自数据库/API，前端不需要（也不可能）扫描服务器目录。
 */
export async function GET(request: Request) {
  const blocked = guardRequest(request, "gallery", { max: 60 });
  if (blocked) return blocked;

  try {
    const sessionId = await ensureAnonSession();
    const items = await buildGallery(sessionId);
    const unlockedCount = items.filter((item) => item.unlocked).length;

    return jsonOk({
      ok: true,
      items,
      stats: {
        total: items.length,
        unlocked: unlockedCount,
        locked: items.length - unlockedCount,
      },
    });
  } catch (error) {
    console.error("[api/gallery]", error);
    return jsonError("server_error", "读取相册失败");
  }
}
