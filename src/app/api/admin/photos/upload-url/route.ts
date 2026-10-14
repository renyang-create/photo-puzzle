import { randomUUID } from "node:crypto";

import { checkAdmin } from "@/lib/admin-auth";
import { guardRequest, jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { createUploadTicket } from "@/lib/storage";
import { uploadUrlSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 超过这个大小就要求前端先 canvas 压缩，避免 Storage 上限与 sharp 超时 */
const MAX_DIRECT_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/admin/photos/upload-url
 * 预签名直传：服务端只签发一个「2 小时内有效的一次性令牌」，
 * 浏览器拿令牌直接 PUT 到 Supabase Storage，大图完全不经过 Next.js 函数内存。
 *
 * 路径规则：<uuid>/raw.<ext>，随机且不可枚举，杜绝覆盖他人对象。
 */
export async function POST(request: Request) {
  const blocked = guardRequest(request, "admin-upload-url", { max: 20 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  const parsed = await parseJsonBody(request, uploadUrlSchema);
  if (!parsed.ok) return parsed.response;

  const { contentType, size, fileName } = parsed.data;
  if (size > MAX_DIRECT_UPLOAD_BYTES) {
    return jsonError(
      "bad_request",
      "文件超过 20MB：请先用浏览器端 canvas 压缩到长边 ≤ 2000px / JPEG 0.8 再上传",
    );
  }

  try {
    const objectId = randomUUID();
    const ticket = await createUploadTicket({ objectId, mime: contentType });
    return jsonOk({ ok: true, ...ticket, objectId, originalFileName: fileName });
  } catch (error) {
    console.error("[api/admin/photos/upload-url]", error);
    return jsonError("server_error", "签发上传令牌失败，请检查 Storage bucket 是否已创建");
  }
}
