import "server-only";

import { publicEnv } from "./env.public";

/**
 * 服务端专用环境变量。
 * ⚠️ 这个文件被 `server-only` 保护：一旦被客户端组件 import，构建会直接失败，
 *    从机制上避免 SUPABASE_SERVICE_ROLE_KEY 泄漏到浏览器。
 */
function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`缺少服务端环境变量 ${key}（参考 .env.example）`);
  }
  return value;
}

export const serverEnv = {
  get supabaseUrl() {
    return publicEnv.supabaseUrl || required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get bucket() {
    return process.env.SUPABASE_PHOTOS_BUCKET?.trim() || "photos";
  },
  /**
   * 会话签名密钥。签发匿名 session / 管理员 session 的 HS256 JWT。
   * 生产环境强制 >= 32 字符；开发环境给一个显式警告的兜底值，避免 pnpm dev 直接崩。
   */
  get sessionPassword() {
    const value = process.env.SESSION_PASSWORD?.trim();
    if (value && value.length >= 32) return value;
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境 SESSION_PASSWORD 必须 >= 32 字符，请用 `openssl rand -base64 32` 生成",
      );
    }
    if (value) {
      console.warn("[env] SESSION_PASSWORD 短于 32 字符，仅允许在开发环境使用。");
      return value;
    }
    console.warn(
      "[env] 未配置 SESSION_PASSWORD，开发环境使用临时密钥；请勿在生产环境这样部署。",
    );
    return "dev-only-insecure-session-password-please-change-me";
  },
  get setupToken() {
    return process.env.ADMIN_SETUP_TOKEN?.trim() || "";
  },
  get adminEmails() {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  },
  get rateLimitWindowMs() {
    return Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  },
  get rateLimitMax() {
    return Number(process.env.RATE_LIMIT_MAX ?? 60);
  },
} as const;

export function hasServiceRoleKey() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
