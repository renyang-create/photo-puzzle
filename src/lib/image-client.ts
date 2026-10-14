"use client";

/**
 * 浏览器端图片压缩。
 *
 * 为什么必须做：
 *   - > 10MB 的图直接上传，Supabase 标准上传不推荐（官方建议 TUS 断点续传），
 *     且 Next.js 图片优化器默认 7s 超时会 504，sharp 处理也容易超时。
 *   - canvas 重新编码会丢掉 EXIF/GPS，相当于免费的一次隐私清理。
 *
 * 做法：用 img.naturalWidth/naturalHeight 取真实尺寸 → 长边等比缩到 <= 2000px
 *      → canvas.toBlob(cb, 'image/jpeg', 0.8)
 * 参考：Next.js / Supabase 社区里广泛使用的 canvas 压缩写法（MIT 示例），此处重写为可测的纯函数 + 薄封装。
 */

export const CLIENT_COMPRESS_THRESHOLD_BYTES = 10 * 1024 * 1024;
export const CLIENT_MAX_LONG_EDGE = 2000;
export const CLIENT_JPEG_QUALITY = 0.8;

export interface Size {
  width: number;
  height: number;
}

/** 纯函数：按长边等比缩放，只缩不放 */
export function fitWithin(size: Size, maxEdge: number): Size {
  const { width, height } = size;
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function needsCompression(file: { size: number; type: string }): boolean {
  if (file.size > CLIENT_COMPRESS_THRESHOLD_BYTES) return true;
  return !/^image\/(jpeg|webp|avif)$/i.test(file.type);
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  skipped: boolean;
  originalBytes: number;
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  size: Size;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        size: { width: bitmap.width, height: bitmap.height },
        release: () => bitmap.close(),
      };
    } catch {
      /* 回退到 HTMLImageElement */
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = url;
  });
  return {
    source: image,
    size: {
      width: image.naturalWidth,
      height: image.naturalHeight,
    },
    release: () => URL.revokeObjectURL(url),
  };
}

export async function compressImageFile(
  file: File,
  options?: { maxEdge?: number; quality?: number; thresholdBytes?: number },
): Promise<CompressResult> {
  const maxEdge = options?.maxEdge ?? CLIENT_MAX_LONG_EDGE;
  const quality = options?.quality ?? CLIENT_JPEG_QUALITY;
  const threshold = options?.thresholdBytes ?? CLIENT_COMPRESS_THRESHOLD_BYTES;

  const { source, size, release } = await loadImage(file);

  try {
    const target = fitWithin(size, maxEdge);
    const mustShrink =
      target.width !== size.width || target.height !== size.height;
    const skip =
      !mustShrink && file.size <= threshold && /^image\/(jpeg|webp|avif)$/i.test(file.type);

    if (skip) {
      return {
        blob: file,
        width: size.width,
        height: size.height,
        skipped: true,
        originalBytes: file.size,
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 canvas 压缩，请换用较新的浏览器");
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/jpeg", quality),
    );
    if (!blob) throw new Error("图片压缩失败");

    return {
      blob,
      width: target.width,
      height: target.height,
      skipped: false,
      originalBytes: file.size,
    };
  } finally {
    release();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
