import os from "node:os";

import type { NextConfig } from "next";

function supabaseOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
}

const storageOrigin = supabaseOrigin();

/**
 * 基础安全响应头。
 * CSP 里必须放行 Supabase Storage 域名，否则 5 分钟 signed URL 的 <img> 会被拦掉。
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Next.js 需要 inline 引导脚本；评估期还需要 eval
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${storageOrigin}`.trim(),
  `connect-src 'self' ${storageOrigin} ${storageOrigin.replace("https://", "wss://")}`.trim(),
  "font-src 'self' data:",
  "worker-src 'self' blob:",
].join("; ");

/**
 * 开发模式允许的额外来源。
 *
 * Next.js 从 15.3 起会在 dev 下拦截「非 localhost 来源」对前端资源（/_next/*）的请求，
 * 表现是：手机用 http://192.168.x.x:3000 打开页面能拿到 HTML，但所有 JS 都是 403，
 * 页面卡在服务端渲染出来的加载文案上（例如「正在校验管理员身份…」）。
 *
 * 这里自动把本机所有非回环 IPv4 地址加进白名单（局域网 IP、手机热点网段都会被覆盖），
 * 因此换网络/换热点后不用回来改配置。需要额外域名时用 DEV_ALLOWED_ORIGINS 环境变量补充
 * （逗号分隔，支持 *.example.dev 这种子域通配）。
 *
 * 只影响开发模式，生产环境（Vercel）与本站安全策略无关。
 */
function localDevOrigins(): string[] {
  const fromEnv = (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const fromInterfaces = Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (item): item is NonNullable<typeof item> =>
        Boolean(item) && item!.family === "IPv4" && !item!.internal,
    )
    .map((item) => item.address);

  return Array.from(new Set(["localhost", "127.0.0.1", ...fromInterfaces, ...fromEnv]));
}

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins(),
  // 本站数据全部是「即时/按会话」的（5 分钟 signed URL、按匿名会话裁剪的相册），
  // 因此关闭组件级缓存，避免把带签名的图片地址缓存复用。
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        /**
         * ⚠️ /api/og 必须显式禁止 CDN 缓存，否则动态分享卡片会全部变成同一张图。
         *
         * 原因：Netlify 的 Next.js 适配器会给该路由的响应加上
         *   Netlify-Vary: query=__nextDataReq|_rsc
         * 也就是**只**把这两个内部查询参数算进缓存键，业务参数 photoId 被直接忽略。
         * 于是 ?photoId=A 与 ?photoId=B 命中同一条缓存条目。
         * 实测依据：带随机 cache-buster 的请求仍返回 Cache-Status: "Netlify Durable"; hit
         * 且 Age 为正值（说明是旧条目而非新渲染）。
         *
         * 卡片内容本来就只由 photoId 决定，理论上适合长缓存；但缓存键不可控，
         * 与其每次请求被错误复用，不如直接不缓存：中文字体已在模块作用域缓存，
         * 热请求的渲染成本很低，而社交平台抓取卡片是低频动作。
         */
        source: "/api/og",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
