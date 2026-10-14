import { describe, expect, it } from "vitest";

import {
  CLIENT_COMPRESS_THRESHOLD_BYTES,
  CLIENT_MAX_LONG_EDGE,
  fitWithin,
  formatBytes,
  needsCompression,
} from "@/lib/image-client";

describe("前端 canvas 压缩的尺寸计算", () => {
  it("长边超过 2000px 时等比缩到 2000", () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
    expect(fitWithin({ width: 3000, height: 6000 }, 2000)).toEqual({
      width: 1000,
      height: 2000,
    });
  });

  it("小于上限时不放大（只缩不放）", () => {
    expect(fitWithin({ width: 800, height: 600 }, 2000)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("极端长条图与非法尺寸不会算出 0", () => {
    expect(fitWithin({ width: 20000, height: 10 }, 2000)).toEqual({
      width: 2000,
      height: 1,
    });
    expect(fitWithin({ width: 0, height: 0 }, 2000)).toEqual({
      width: 1,
      height: 1,
    });
  });
});

describe("何时需要前端压缩", () => {
  it("超过 10MB 必须压缩", () => {
    expect(
      needsCompression({
        size: CLIENT_COMPRESS_THRESHOLD_BYTES + 1,
        type: "image/jpeg",
      }),
    ).toBe(true);
  });

  it("PNG / HEIC 即使不大也走压缩（顺带清掉 EXIF/GPS）", () => {
    expect(needsCompression({ size: 500_000, type: "image/png" })).toBe(true);
    expect(needsCompression({ size: 500_000, type: "image/heic" })).toBe(true);
  });

  it("小巧的 JPEG/WebP/AVIF 直接上传", () => {
    expect(needsCompression({ size: 2_000_000, type: "image/jpeg" })).toBe(false);
    expect(needsCompression({ size: 900_000, type: "image/webp" })).toBe(false);
  });

  it("默认长边上限是 2000px（与 README、服务端 sharp 保持一致）", () => {
    expect(CLIENT_MAX_LONG_EDGE).toBe(2000);
  });
});

describe("formatBytes", () => {
  it("按量级切换单位", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.00 MB");
  });
});
