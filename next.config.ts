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

const nextConfig: NextConfig = {
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
        // 图片与 OG 图给一个较宽松的缓存策略，静态资源长缓存
        source: "/api/og",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=1800" },
        ],
      },
    ];
  },
};

export default nextConfig;
