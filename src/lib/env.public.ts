/**
 * 只包含 NEXT_PUBLIC_* 变量：这些值会进入浏览器 bundle，属于公开信息。
 * 任何 secret（service role key / SESSION_PASSWORD / 密码哈希）都必须留在 env.server.ts。
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "照片拼图",
  nickname: process.env.NEXT_PUBLIC_HOST_NICKNAME?.trim() || "神秘人",
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000",
} as const;

export function assertPublicSupabaseEnv() {
  const missing: string[] = [];
  if (!publicEnv.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publicEnv.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    throw new Error(`缺少公开环境变量: ${missing.join(", ")}（参考 .env.example）`);
  }
}
