"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "../database.types";
import { publicEnv } from "../env.public";

/**
 * 浏览器端客户端。只用 anon key：权限完全由 RLS + Storage policy 决定。
 * 本项目里它只负责两件事：
 *   1. 用服务端签发的签名令牌上传（uploadToSignedUrl），不经过我们的函数内存
 *   2. 万一将来要做 Realtime，占位
 * 绝不在浏览器端读取照片原图（anon 对 photos bucket 没有 SELECT 权限）。
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  );
}

let cached: ReturnType<typeof createClient> | null = null;

export function getBrowserClient() {
  if (!cached) cached = createClient();
  return cached;
}
