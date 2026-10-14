import { guardRequest, jsonError, jsonOk } from "@/lib/http";
import { getPhotoById, listUnlocksForSession } from "@/lib/photos.service";
import { readAnonSessionId } from "@/lib/session";
import { SIGNED_URL_TTL_SECONDS, createSignedReadUrl } from "@/lib/storage";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/photos/[id]/url?size=thumb|full
 *
 * 这是「原图不可公开访问」策略的唯一出口：
 *   - 私有 bucket，anon 连 list 都不允许，只能拿到这里签发的 5 分钟链接；
 *   - size=thumb：用于拼图/预览，允许（否则没法玩）；
 *   - size=full：只有当前匿名会话确实解锁过这张才会签发，杜绝「扒接口直接看原图」。
 *
 * createSignedUrl 的签名密钥由 Storage 服务独立管理，与 Auth JWT 的签名密钥不同，
 * 所以 Supabase Auth key 轮换不会让已签发的链接表现异常。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardRequest(request, "photo-url", { max: 120 });
  if (blocked) return blocked;

  try {
    const { id } = await params;
    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) {
      return jsonError("bad_request", "非法的照片 id");
    }

    const size = new URL(request.url).searchParams.get("size") ?? "thumb";
    if (size !== "thumb" && size !== "full") {
      return jsonError("bad_request", "size 只能是 thumb 或 full");
    }

    const photo = await getPhotoById(parsedId.data);
    if (!photo || !photo.is_active) {
      return jsonError("not_found", "照片不存在或已下架");
    }

    const sessionId = await readAnonSessionId();

    if (size === "full") {
      if (!sessionId) {
        return jsonError("forbidden", "还没有解锁这张照片哦");
      }
      const unlocks = await listUnlocksForSession(sessionId);
      if (!unlocks.some((row) => row.photo_id === photo.id)) {
        return jsonError("forbidden", "这张还没解锁，先拼出来吧");
      }
    }

    const path =
      size === "thumb" ? (photo.thumb_path ?? photo.storage_path) : photo.storage_path;
    const signedUrl = await createSignedReadUrl(path, SIGNED_URL_TTL_SECONDS);

    return jsonOk({
      ok: true,
      url: signedUrl,
      size,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("[api/photos/[id]/url]", error);
    return jsonError("server_error", "生成图片链接失败");
  }
}
