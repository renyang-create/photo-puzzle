import { checkAdmin, writeAudit } from "@/lib/admin-auth";
import type { Database } from "@/lib/database.types";
import { guardRequest, jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { getPhotoById } from "@/lib/photos.service";
import { removeObjects } from "@/lib/storage";
import { getAdminClient } from "@/lib/supabase/admin";
import { updatePhotoSchema, uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveId(params: Promise<{ id: string }>) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

/** PATCH /api/admin/photos/[id]：上下架 / 排序 / 改文案 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardRequest(request, "admin-photo-patch", { max: 40 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  const id = await resolveId(params);
  if (!id) return jsonError("bad_request", "非法的照片 id");

  const parsed = await parseJsonBody(request, updatePhotoSchema);
  if (!parsed.ok) return parsed.response;

  const patch: Database["public"]["Tables"]["photos"]["Update"] = {};
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.unlockText !== undefined) patch.unlock_text = parsed.data.unlockText;

  if (Object.keys(patch).length === 0) {
    return jsonError("bad_request", "没有需要更新的字段");
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("photos")
      .update(patch)
      .eq("id", id)
      .select("id, is_active, sort_order, title")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return jsonError("not_found", "照片不存在");

    await writeAudit("photo.update", id, patch, check.identity.actor);
    return jsonOk({ ok: true, photo: data });
  } catch (error) {
    console.error("[api/admin/photos PATCH]", error);
    return jsonError("server_error", "更新失败");
  }
}

/** DELETE /api/admin/photos/[id]：删记录 + 清 Storage 对象（raw/full/thumb） */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardRequest(request, "admin-photo-delete", { max: 20 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  const id = await resolveId(params);
  if (!id) return jsonError("bad_request", "非法的照片 id");

  try {
    const photo = await getPhotoById(id);
    if (!photo) return jsonError("not_found", "照片不存在");

    const admin = getAdminClient();
    const { error } = await admin.from("photos").delete().eq("id", id);
    if (error) throw new Error(error.message);

    // 先删数据库记录再清对象：孤儿文件比有记录没文件更好处理
    await removeObjects(
      [photo.storage_path, photo.thumb_path, photo.raw_path].filter(
        (path): path is string => Boolean(path),
      ),
    );

    await writeAudit("photo.delete", id, { title: photo.title }, check.identity.actor);
    return jsonOk({ ok: true });
  } catch (error) {
    console.error("[api/admin/photos DELETE]", error);
    return jsonError("server_error", "删除失败");
  }
}
