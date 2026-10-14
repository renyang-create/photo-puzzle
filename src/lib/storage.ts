import "server-only";

import { serverEnv } from "./env.server";
import { getAdminClient } from "./supabase/admin";

/**
 * 私有 bucket 的对象访问层。
 *
 * 两条链路：
 *   1. 读取：服务端 createSignedUrl（默认 5 分钟）。签名密钥由 Storage 服务独立管理，
 *      与 Auth JWT 的签名密钥不是同一个，因此 Auth key 轮换不会让已有链接异常失效。
 *   2. 写入：服务端 createSignedUploadUrl 签发上传令牌（Supabase 侧固定 2 小时有效），
 *      浏览器拿 token 直接 PUT 到 Storage，大图不经过 Next.js 函数内存。
 */

export const SIGNED_URL_TTL_SECONDS = 300; // 5 分钟
export const SIGNED_UPLOAD_TTL_SECONDS = 60 * 60 * 2; // Supabase 端固定 2 小时

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
};

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? "bin";
}

/** 随机 UUID 路径：`<uuid>/raw.<ext>`，杜绝可枚举/可覆盖的固定名 */
export function buildUploadPath(mime: string, id: string): string {
  return `${id}/raw.${extensionForMime(mime)}`;
}

export function derivedPaths(id: string) {
  return {
    full: `${id}/full.jpg`,
    thumb: `${id}/thumb.jpg`,
  };
}

export async function createSignedReadUrl(
  path: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
) {
  const supabase = getAdminClient();
  const { data, error } = await supabase.storage
    .from(serverEnv.bucket)
    .createSignedUrl(path, ttlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`生成 signed URL 失败：${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/** 批量签名（相册墙一次签完，避免 N 次往返） */
export async function createSignedReadUrls(
  paths: string[],
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = getAdminClient();
  const { data, error } = await supabase.storage
    .from(serverEnv.bucket)
    .createSignedUrls(paths, ttlSeconds);

  if (error || !data) {
    throw new Error(`批量生成 signed URL 失败：${error?.message ?? "unknown"}`);
  }

  const map: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl;
  }
  return map;
}

export interface UploadTicket {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresInSeconds: number;
}

/**
 * 签发一次性上传令牌。
 * 不锁死具体 API 名称：storage-js 的 createSignedUploadUrl 返回 { signedUrl, path, token }，
 * 客户端既可以用 uploadToSignedUrl(path, token, file)，也可以直接 PUT signedUrl。
 */
export async function createUploadTicket(params: {
  objectId: string;
  mime: string;
}): Promise<UploadTicket> {
  const supabase = getAdminClient();
  const path = buildUploadPath(params.mime, params.objectId);

  const { data, error } = await supabase.storage
    .from(serverEnv.bucket)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(`签发上传令牌失败：${error?.message ?? "unknown"}`);
  }

  return {
    bucket: serverEnv.bucket,
    path: data.path ?? path,
    token: data.token,
    signedUrl: data.signedUrl,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
  };
}

export async function downloadObject(path: string): Promise<Buffer> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.storage
    .from(serverEnv.bucket)
    .download(path);

  if (error || !data) {
    throw new Error(`下载对象失败：${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadObject(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.storage
    .from(serverEnv.bucket)
    .upload(path, body, { contentType, upsert: true, cacheControl: "0" });

  if (error) throw new Error(`上传对象失败：${error.message}`);
}

export async function removeObjects(paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean);
  if (valid.length === 0) return;
  const supabase = getAdminClient();
  const { error } = await supabase.storage.from(serverEnv.bucket).remove(valid);
  if (error) {
    // 删除失败不应该阻断主流程（数据库记录才是真相），但要留痕
    console.error("[storage] remove failed:", error.message, valid);
  }
}
