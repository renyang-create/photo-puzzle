import { checkAdmin, writeAudit } from "@/lib/admin-auth";
import { guardRequest, jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ImageProcessError, normalizeImage } from "@/lib/image-server";
import { listAllPhotos } from "@/lib/photos.service";
import { derivedPaths, downloadObject, removeObjects, uploadObject } from "@/lib/storage";
import { getAdminClient } from "@/lib/supabase/admin";
import { createPhotoSchema, uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 超过这个体积不再由服务端处理，直接要求前端压缩（Next 图片优化器 7s 超时 / 504 的常见诱因） */
const MAX_PROCESS_BYTES = 15 * 1024 * 1024;

/**
 * GET /api/admin/photos —— 后台列表（含上下架状态与解锁数）
 */
export async function GET(request: Request) {
  const blocked = guardRequest(request, "admin-photos-list", { max: 60 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  try {
    const photos = await listAllPhotos();
    const admin = getAdminClient();
    const { data: unlockRows } = await admin.from("unlocks").select("photo_id");

    const counts = new Map<string, number>();
    for (const row of unlockRows ?? []) {
      counts.set(row.photo_id, (counts.get(row.photo_id) ?? 0) + 1);
    }

    return jsonOk({
      ok: true,
      photos: photos.map((photo) => ({
        ...photo,
        unlockCount: counts.get(photo.id) ?? 0,
      })),
    });
  } catch (error) {
    console.error("[api/admin/photos GET]", error);
    return jsonError("server_error", "读取照片列表失败");
  }
}

/**
 * POST /api/admin/photos —— 用「已直传完成的 raw 对象」创建照片记录
 *
 * 流程（全部在服务端完成，sharp 跑在 Node.js runtime）：
 *   1. 校验调用者是管理员 + 对象路径白名单（必须是 <uuid>/raw.<ext>）
 *   2. 把 raw 拉进内存（>15MB 直接拒绝，提示前端先压缩）
 *   3. sharp：EXIF 方向摆正 → 长边 ≤2000 归一化 JPEG（顺带清掉 EXIF/GPS）→ 再出一张 800px 缩略图
 *   4. 写回 <uuid>/full.jpg 与 <uuid>/thumb.jpg，最后插入 photos 记录
 *
 * 注意：照片列表来自数据库/API，前端永远不去「扫描目录」（浏览器做不到，也不该做）。
 */
export async function POST(request: Request) {
  const blocked = guardRequest(request, "admin-photos-create", { max: 20 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  const parsed = await parseJsonBody(request, createPhotoSchema);
  if (!parsed.ok) return parsed.response;

  const { storagePath, title, unlockText, sortOrder } = parsed.data;
  const objectId = storagePath.split("/")[0] ?? "";
  const idCheck = uuidSchema.safeParse(objectId);
  if (!idCheck.success) return jsonError("bad_request", "非法的对象 id");

  try {
    const raw = await downloadObject(storagePath);
    if (raw.byteLength > MAX_PROCESS_BYTES) {
      await removeObjects([storagePath]);
      return jsonError(
        "bad_request",
        `原图 ${(raw.byteLength / 1024 / 1024).toFixed(1)}MB 过大：请先在浏览器端压缩到长边 ≤ 2000px`,
      );
    }

    const normalized = await normalizeImage(raw);
    const paths = derivedPaths(objectId);

    await uploadObject(paths.full, normalized.full, "image/jpeg");
    await uploadObject(paths.thumb, normalized.thumb, "image/jpeg");

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("photos")
      .insert({
        id: objectId,
        storage_path: paths.full,
        thumb_path: paths.thumb,
        raw_path: storagePath,
        title,
        unlock_text: unlockText,
        sort_order: sortOrder,
        is_active: true,
        width: normalized.width,
        height: normalized.height,
      })
      .select("id, title, is_active, sort_order, width, height")
      .single();

    if (error) {
      // 数据库写入失败时把刚生成的对象清掉，避免产生孤儿文件
      await removeObjects([paths.full, paths.thumb]);
      throw new Error(error.message);
    }

    await writeAudit("photo.create", objectId, { title, sourceBytes: raw.byteLength }, check.identity.actor);
    return jsonOk({ ok: true, photo: data });
  } catch (error) {
    if (error instanceof ImageProcessError) {
      return jsonError("bad_request", error.message);
    }
    console.error("[api/admin/photos POST]", error);
    return jsonError("server_error", "处理照片失败，请确认文件是有效图片");
  }
}
