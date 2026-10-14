import "server-only";

import sharp, { type Metadata } from "sharp";

/**
 * sharp 只能在 Node.js runtime 的 Route Handler / Server Action 里跑。
 * 放到 Edge Function 会直接报：
 *   Could not load the "sharp" module using the linux-x64 runtime
 * 因此 /api/admin/photos 这类处理图片的路由都显式声明 `export const runtime = "nodejs"`。
 *
 * 版本建议：sharp 0.35.x（本项目锁定 0.35.5）。Vercel 上若遇到预编译二进制与运行时 ABI
 * 不兼容，可回退到 0.32.x 这一已知稳定的分支。
 */
sharp.cache(false); // Serverless 环境不做跨请求缓存，避免内存常驻
sharp.concurrency(1);

export const FULL_MAX_EDGE = 2000;
export const THUMB_MAX_EDGE = 800;

export const ALLOWED_INPUT_FORMATS = [
  "jpeg",
  "jpg",
  "png",
  "webp",
  "avif",
  "heif",
] as const;

export interface NormalizedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  format: string;
  sourceBytes: number;
}

export class ImageProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessError";
  }
}

/**
 * 归一化上传的图片：
 *   1. `.rotate()` 按 EXIF 方向自动摆正（必须在其他操作之前）
 *   2. 长边限制到 2000px（>= 10MB 的原图前端已用 canvas 压过一轮）
 *   3. 重新编码为 JPEG —— sRGB 归一 + 丢弃元数据 = 顺带清理 EXIF/GPS
 *   4. 额外产出一张 800px 缩略图，给拼图切片与相册墙用（省流量、避免 504）
 */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: "none" }).metadata();
  } catch (error) {
    throw new ImageProcessError(`无法解析图片：${(error as Error).message}`);
  }

  if (!metadata.format || !ALLOWED_INPUT_FORMATS.includes(metadata.format as (typeof ALLOWED_INPUT_FORMATS)[number])) {
    throw new ImageProcessError(`不支持的图片格式：${metadata.format ?? "unknown"}`);
  }
  if ((metadata.width ?? 0) < 200 || (metadata.height ?? 0) < 200) {
    throw new ImageProcessError("图片太小了，请上传至少 200×200 的照片");
  }

  const base = sharp(input, { failOn: "none", limitInputPixels: 45_000_000 }).rotate();

  const fullResult = await base
    .clone()
    .resize({
      width: FULL_MAX_EDGE,
      height: FULL_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  const thumbResult = await base
    .clone()
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    full: fullResult.data,
    thumb: thumbResult.data,
    width: fullResult.info.width,
    height: fullResult.info.height,
    format: "jpeg",
    sourceBytes: input.byteLength,
  };
}

/** 上传前做一次「真的是图片」的嗅探，避免只信 Content-Type */
export async function assertRealImage(buffer: Buffer): Promise<void> {
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    if (!meta.format) throw new Error("no format");
  } catch {
    throw new ImageProcessError("文件内容不是可识别的图片");
  }
}
