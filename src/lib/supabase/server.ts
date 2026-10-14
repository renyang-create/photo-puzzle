import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "../database.types";
import { publicEnv } from "../env.public";

/**
 * 服务端客户端（anon key + 请求里的 cookie）。
 * 走 RLS，用于：
 *   - 判断当前请求是不是白名单里的 Supabase Auth 管理员
 *   - 将来做「用户自己的数据」类查询
 * 注意：需要跳过 RLS 的写入一律用 supabase/admin.ts（service_role）。
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // 在 Server Component 中 cookie 是只读的：这里静默忽略，
            // session 刷新由 middleware 负责。
          }
        },
      },
    },
  );
}
