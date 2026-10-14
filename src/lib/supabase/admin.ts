import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { serverEnv } from "../env.server";

/**
 * service_role 客户端：绕过 RLS，只在服务端 runtime 使用。
 * 用途：签发 signed URL、写 unlocks、sharp 处理图片、管理端建/删照片记录。
 * ⚠️ 这个模块被 `server-only` 标记，被客户端引用会在构建期报错。
 */
export function createAdminClient() {
  return createClient<Database>(
    serverEnv.supabaseUrl,
    serverEnv.serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { "X-Client-Info": "photo-puzzle/admin" },
      },
    },
  );
}

let cached: ReturnType<typeof createAdminClient> | null = null;

/** 复用连接，避免每个请求都新建客户端 */
export function getAdminClient() {
  if (!cached) cached = createAdminClient();
  return cached;
}
