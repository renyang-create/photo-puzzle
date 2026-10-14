import { ImageResponse } from "next/og";

import { publicEnv } from "@/lib/env.public";
import { getPhotoById } from "@/lib/photos.service";
import { mulberry32 } from "@/lib/puzzle";
import { ogQuerySchema, sanitizeOgText } from "@/lib/validation";

/**
 * 动态分享卡片：GET /api/og?photoId=<uuid>
 *
 * 安全设计（针对 CVE-2026-94545，CVSS 9.5，影响范围 Next.js 16.2.0–16.3.5 / satori 0.0.27–0.33.4）：
 *   1. 运行在 Node.js runtime（next/og 的 ImageResponse 需要它）。
 *      攻击链依赖 Node.js runtime + sharp 把恶意 SVG 转成 PNG；Edge runtime 不存在这条链。
 *      我们选择「Node runtime + 已修复版本」而不是 Edge，是因为部署环境固定，
 *      并且要配合 sharp 做服务端图片归一化。
 *   2. 依赖版本已高于修复线：Next.js 16.4.0（>= 16.3.6）+ 内置 satori（>= 0.33.5）。
 *      安装后请用 `pnpm audit` 与 `pnpm why satori` 复核。
 *   3. 路由只接受一个参数 photoId，固定模板：不接受任何用户可控的 HTML / 文本 / query 参数，
 *      文案全部来自服务端常量 + 数据库（并再次做字符白名单化处理）。
 *   4. 纵深防御：所有进入 Satori 的字符串都过一遍 sanitizeOgText（剔除 < > & " ' ` \ 与控制字符），
 *      即使将来 satori 再次出现转义缺陷，也不存在可闭合标签的输入。
 *
 * 另外：卡片里不会出现照片缩略图 —— bucket 是私有的，OG 图自然也就不可能泄漏原图。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 首次冷启动要拉中文字体，给足超时；字体在模块作用域缓存，后续请求几乎为零成本 */
export const maxDuration = 30;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "照片拼图解锁";

/** 中文字形需要额外字体；未配置时自动退化为纯英文卡片，不影响可用性 */
const FALLBACK_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf";

let fontCache: ArrayBuffer | null = null;
let fontAttempted = false;

async function loadCjkFont(): Promise<ArrayBuffer | null> {
  if (fontAttempted) return fontCache;
  fontAttempted = true;
  const url = process.env.OG_FONT_URL?.trim() || FALLBACK_FONT_URL;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    fontCache = await response.arrayBuffer();
    return fontCache;
  } catch {
    console.warn("[og] 字体加载失败，退化为纯英文卡片：", url);
    return null;
  }
}

function decorativeGrid(seed: string) {
  const hash = Array.from(seed).reduce(
    (acc, char) => (acc * 31 + char.charCodeAt(0)) % 2147483647,
    7,
  );
  const random = mulberry32(hash);
  return Array.from({ length: 36 }, () => ({
    opacity: 0.08 + random() * 0.22,
    rotate: Math.round(random() * 8 - 4),
  }));
}

export async function GET(request: Request) {
  const parsed = ogQuerySchema.safeParse({
    photoId: new URL(request.url).searchParams.get("photoId") ?? undefined,
  });
  if (!parsed.success) {
    return new Response("bad request", { status: 400 });
  }

  const font = await loadCjkFont();
  const hasCjk = Boolean(font);
  const nickname = sanitizeOgText(publicEnv.nickname, 12) || "某人";
  const siteName = sanitizeOgText(publicEnv.siteName, 12) || "照片拼图";

  let photoTitle = "";
  let difficultyHint = "3 × 3 · 4 × 4 · 5 × 5";
  if (parsed.data.photoId) {
    try {
      const photo = await getPhotoById(parsed.data.photoId);
      if (photo?.is_active) photoTitle = sanitizeOgText(photo.title, 16);
    } catch {
      /* OG 图不能因为数据库抖动就 500 */
    }
  }

  if (photoTitle) difficultyHint = `${photoTitle} · 3×3 / 4×4 / 5×5`;

  const heading = hasCjk
    ? `解锁${nickname}的照片`
    : "UNLOCK THE PHOTO";
  const subheading = hasCjk
    ? "拼好它，才能看到这张照片"
    : "Solve the puzzle to reveal it";
  const badge = hasCjk ? siteName : "PHOTO PUZZLE";
  const footer = hasCjk ? "点开链接开始拼图 · 无需下载 · 无需注册" : "Tap the link to play";

  const grid = decorativeGrid(parsed.data.photoId ?? "photo-puzzle");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundImage:
            "linear-gradient(135deg, #070a18 0%, #1a1030 52%, #070a18 100%)",
          color: "#f5f3ff",
          fontFamily: hasCjk ? "Noto Sans SC" : "sans-serif",
          position: "relative",
        }}
      >
        {/* 装饰性拼图网格 */}
        <div
          style={{
            position: "absolute",
            top: 96,
            right: 72,
            display: "flex",
            flexWrap: "wrap",
            width: 288,
            height: 288,
            gap: 8,
          }}
        >
          {grid.map((cell, index) => (
            <div
              key={index}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#a78bfa",
                opacity: cell.opacity,
                transform: `rotate(${cell.rotate}deg)`,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 20px",
              borderRadius: 999,
              border: "1px solid rgba(167,139,250,0.5)",
              background: "rgba(167,139,250,0.14)",
              fontSize: 26,
              letterSpacing: 2,
              color: "#ddd6fe",
            }}
          >
            {badge}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#8b8ba7" }}>
            {difficultyHint}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: hasCjk ? 92 : 80,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: hasCjk ? 2 : 0,
            }}
          >
            {heading}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#b9b6d6" }}>
            {subheading}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: "#7c7a99",
          }}
        >
          <div style={{ display: "flex" }}>{footer}</div>
          <div style={{ display: "flex" }}>photo-puzzle</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Noto Sans SC", data: font, weight: 700, style: "normal" }]
        : undefined,
      headers: {
        // 卡片内容由 photoId 决定，可以被 CDN 缓存，减轻函数压力
        "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      },
    },
  );
}
