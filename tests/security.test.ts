import { beforeAll, describe, expect, it } from "vitest";

import {
  signAdminToken,
  signAnonToken,
  verifyAdminToken,
  verifyAnonToken,
} from "@/lib/session-core";
import {
  createPhotoSchema,
  sanitizeOgText,
  unlockPayloadSchema,
  uploadObjectPathSchema,
  uploadUrlSchema,
  uuidSchema,
} from "@/lib/validation";

beforeAll(() => {
  process.env.SESSION_PASSWORD = "unit-test-session-password-with-32+chars";
});

describe("匿名会话 cookie（jose HS256）", () => {
  it("签发的 token 可解出同一个 sid", async () => {
    const token = await signAnonToken("sid-123");
    expect(await verifyAnonToken(token)).toBe("sid-123");
  });

  it("被篡改的 token 直接判为无效（不能伪造身份）", async () => {
    const token = await signAnonToken("sid-123");
    const [header, payload, signature] = token.split(".");
    const forged = `${header}.${payload}.${signature.slice(0, -2)}xx`;
    expect(await verifyAnonToken(forged)).toBeNull();
  });

  it("admin token 不能被当成 anon token 使用（kind 隔离）", async () => {
    const admin = await signAdminToken({ actor: "owner", method: "password" });
    expect(await verifyAnonToken(admin)).toBeNull();
    expect(await verifyAdminToken(admin)).toEqual({
      actor: "owner",
      method: "password",
    });
  });

  it("随便一个字符串不会通过校验", async () => {
    expect(await verifyAnonToken("not-a-jwt")).toBeNull();
    expect(await verifyAdminToken("a.b.c")).toBeNull();
  });
});

describe("入参校验", () => {
  it("photoId 必须是 uuid", () => {
    expect(uuidSchema.safeParse("6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33").success).toBe(
      true,
    );
    expect(uuidSchema.safeParse("../../etc/passwd").success).toBe(false);
  });

  it("解锁请求：难度只能是 3/4/5，用时必须有上限", () => {
    expect(
      unlockPayloadSchema.safeParse({
        photoId: "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33",
        difficulty: 4,
        timeMs: 12_000,
      }).success,
    ).toBe(true);

    expect(
      unlockPayloadSchema.safeParse({
        photoId: "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33",
        difficulty: 6,
        timeMs: 12_000,
      }).success,
    ).toBe(false);

    expect(
      unlockPayloadSchema.safeParse({
        photoId: "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33",
        difficulty: 3,
        timeMs: 99_999_999_999,
      }).success,
    ).toBe(false);
  });

  it("上传对象路径只允许 <uuid>/raw.<ext>，阻断路径穿越", () => {
    expect(
      uploadObjectPathSchema.safeParse(
        "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33/raw.jpg",
      ).success,
    ).toBe(true);

    for (const bad of [
      "../secret.png",
      "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33/../../other.jpg",
      "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33/full.jpg",
      "/etc/passwd",
    ]) {
      expect(uploadObjectPathSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("上传 MIME 白名单与体积上限", () => {
    expect(
      uploadUrlSchema.safeParse({
        fileName: "a.jpg",
        contentType: "image/jpeg",
        size: 1024,
      }).success,
    ).toBe(true);

    expect(
      uploadUrlSchema.safeParse({
        fileName: "evil.svg",
        contentType: "image/svg+xml",
        size: 1024,
      }).success,
    ).toBe(false);

    expect(
      uploadUrlSchema.safeParse({
        fileName: "huge.jpg",
        contentType: "image/jpeg",
        size: 999_999_999,
      }).success,
    ).toBe(false);
  });

  it("创建照片记录：storagePath 必须过路径白名单", () => {
    expect(
      createPhotoSchema.safeParse({
        storagePath: "6f1c1f2a-9d1e-4c0e-8a4f-2b6f0f9d1c33/raw.jpg",
        title: "海边",
        unlockText: "你居然真的认识我",
        sortOrder: 0,
      }).success,
    ).toBe(true);

    expect(
      createPhotoSchema.safeParse({
        storagePath: "../../other-bucket/secret.jpg",
        title: "x",
        unlockText: "y",
        sortOrder: 0,
      }).success,
    ).toBe(false);
  });
});

describe("OG 模板纵深防御（CVE-2026-94545 相关）", () => {
  it("剔除所有可能闭合标签的字符", () => {
    expect(sanitizeOgText('<script>alert(1)</script>')).toBe(
      "scriptalert(1)/script",
    );
    expect(sanitizeOgText(`"><image href="x"/>`)).toBe("image href=x/");
    expect(sanitizeOgText("a`b\\c'd\"e")).toBe("abcde");
  });

  it("去掉控制字符并做长度截断", () => {
    expect(sanitizeOgText("a\u0000b\u001fc")).toBe("abc");
    expect(sanitizeOgText("一二三四五六七八九十", 4)).toBe("一二三四");
  });
});
