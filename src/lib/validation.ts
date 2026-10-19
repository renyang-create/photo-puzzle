import { z } from "zod";

import { DIFFICULTIES } from "./puzzle";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_RE, "非法的 id 格式");

export const difficultySchema = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const unlockPayloadSchema = z.object({
  photoId: uuidSchema,
  difficulty: difficultySchema,
  // 上限 24 小时，防止刷数据
  timeMs: z.number().int().positive().max(86_400_000),
});

export const loginSchema = z.object({
  password: z.string().min(8).max(200),
  /** 首次部署初始化时使用，与 ADMIN_SETUP_TOKEN 比对 */
  setupToken: z.string().max(200).optional(),
  email: z.string().email().optional(),
});

/**
 * 上传对象路径白名单：必须是 `<uuid>/raw.<ext>` 形态。
 * 直接拒绝 ../、绝对路径、其他前缀，避免被当成「任意对象读取」的原语。
 */
export const uploadObjectPathSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/raw\.(jpg|jpeg|png|webp|avif|heic)$/i,
    "非法的对象路径",
  );

export const createPhotoSchema = z.object({
  storagePath: uploadObjectPathSchema,
  title: z.string().trim().min(1).max(40),
  unlockText: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().min(-9999).max(9999).default(0),
});

export const updatePhotoSchema = z.object({
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-9999).max(9999).optional(),
  title: z.string().trim().min(1).max(40).optional(),
  unlockText: z.string().trim().min(1).max(60).optional(),
});

export const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .trim()
    .regex(
      /^image\/(jpeg|jpg|png|webp|avif|heic)$/i,
      "只允许上传 jpeg/png/webp/avif/heic",
    ),
  /**
   * 允许 <= 50MB（Supabase 免费计划全局单文件上限），
   * 但 > 10MB 时前端必须先做 canvas 压缩，服务端在这里兜底校验。
   */
  size: z.number().int().positive().max(52_428_800),
});

export const galleryQuerySchema = z.object({
  difficulty: z.string().optional(),
});

/**
 * 访问打点：只接受两种类型，不接收任何自由文本
 * （来源域名与客户端分类都在服务端从请求头推导，前端无从伪造）。
 */
export const visitPayloadSchema = z.object({
  kind: z.union([z.literal("view"), z.literal("play")]),
});

export const ogQuerySchema = z.object({
  // OG 路由只接受一个参数：photoId。固定模板，不接受任何自由文本。
  photoId: uuidSchema.optional(),
});

export const DIFFICULTY_VALUES = DIFFICULTIES;

/**
 * OG 模板的纵深防御：即使 Next.js >= 16.3.6 / satori >= 0.33.5 已经修复了
 * CVE-2026-94545（SVG 属性未转义导致的未授权 RCE），
 * 我们仍然对所有「来自数据库的文本」做一次显式转义与截断，
 * 保证进入 Satori 的字符串里不可能出现可闭合标签的字符。
 */
export function sanitizeOgText(input: string, maxLength = 24): string {
  return input
    .replace(/[<>&"'`\\]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maxLength)
    .trim();
}
