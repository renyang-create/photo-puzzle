import "server-only";

import bcrypt from "bcryptjs";

import { serverEnv } from "./env.server";
import {
  ADMIN_COOKIE_MAX_AGE,
  clearAdminSessionCookie,
  readAdminSession,
  setAdminSessionCookie,
} from "./session";
import { signAdminToken } from "./session-core";
import { getAdminClient } from "./supabase/admin";
import { createServerSupabaseClient } from "./supabase/server";

/**
 * 管理员鉴权。
 *
 * 方案优先级（两者可以并存）：
 *   1. Supabase Auth：用户邮箱命中 public.admin_users 或 ADMIN_EMAILS → 管理员。
 *      推荐方式，密码、找回、MFA 都由 Supabase 负责。
 *   2. 自建密码：bcrypt 哈希存在 public.admin_credentials（RLS 全拒，仅 service_role 可读），
 *      校验只发生在服务端 Route Handler / Server Action 里。
 *
 * 无论哪种方式，前端都不做任何密码校验 —— 浏览器里的判断只能防手滑，防不了人。
 */

export interface AdminIdentity {
  actor: string;
  method: "password" | "supabase";
}

export type AdminCheck =
  | { isAdmin: true; identity: AdminIdentity }
  | { isAdmin: false };

export async function hasAdminCredential(): Promise<boolean> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("admin_credentials")
    .select("id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`读取管理员凭据失败：${error.message}`);
  return Boolean(data);
}

async function readPasswordHash(): Promise<string | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("admin_credentials")
    .select("password_hash")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`读取管理员凭据失败：${error.message}`);
  return data?.password_hash ?? null;
}

async function savePasswordHash(password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 12);
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("admin_credentials")
    .upsert({ id: 1, password_hash: hash, updated_at: new Date().toISOString() });
  if (error) throw new Error(`保存管理员密码失败：${error.message}`);
}

/** 首次部署初始化：用 ADMIN_SETUP_TOKEN 换一次设置密码的机会 */
export async function bootstrapAdminPassword(setupToken: string, password: string) {
  if (!serverEnv.setupToken) {
    return { ok: false as const, error: "服务端未配置 ADMIN_SETUP_TOKEN，无法完成初始化" };
  }
  if (setupToken !== serverEnv.setupToken) {
    return { ok: false as const, error: "初始化令牌不正确" };
  }
  if (await hasAdminCredential()) {
    return { ok: false as const, error: "管理员密码已初始化过，请直接登录" };
  }
  await savePasswordHash(password);
  await writeAudit("admin.bootstrap", null, { method: "password" }, "setup-token");
  return { ok: true as const };
}

export async function verifyPassword(password: string) {
  const hash = await readPasswordHash();
  if (!hash) {
    return { ok: false as const, needsSetup: true, error: "尚未初始化管理员密码" };
  }
  const matched = await bcrypt.compare(password, hash);
  if (!matched) return { ok: false as const, needsSetup: false, error: "密码不正确" };
  return { ok: true as const, needsSetup: false };
}

export async function changeAdminPassword(
  currentPassword: string,
  nextPassword: string,
) {
  const verified = await verifyPassword(currentPassword);
  if (!verified.ok) return { ok: false as const, error: verified.error };
  await savePasswordHash(nextPassword);
  return { ok: true as const };
}

export async function issueAdminCookie(identity: AdminIdentity) {
  const token = await signAdminToken(identity);
  await setAdminSessionCookie(token, ADMIN_COOKIE_MAX_AGE);
}

export async function logoutAdmin() {
  await clearAdminSessionCookie();
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    /* 没有 Supabase session 时忽略 */
  }
}

async function resolveSupabaseAdmin(): Promise<AdminIdentity | null> {
  let email: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
  if (!email) return null;

  if (serverEnv.adminEmails.includes(email)) {
    return { actor: email, method: "supabase" };
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (error) return null;
  return data ? { actor: email, method: "supabase" } : null;
}

/**
 * 服务端唯一的「是不是管理员」判定入口。
 * 先看 Supabase Auth 白名单，再看自建密码签发的 httpOnly cookie。
 */
export async function checkAdmin(): Promise<AdminCheck> {
  const viaSupabase = await resolveSupabaseAdmin();
  if (viaSupabase) return { isAdmin: true, identity: viaSupabase };

  const session = await readAdminSession();
  if (session) {
    return {
      isAdmin: true,
      identity: { actor: session.actor, method: session.method },
    };
  }
  return { isAdmin: false };
}

export async function writeAudit(
  action: string,
  targetId: string | null,
  detail: Record<string, unknown>,
  actor: string,
) {
  try {
    const supabase = getAdminClient();
    await supabase.from("admin_audit_log").insert({
      action,
      target_id: targetId,
      detail: detail as never,
      actor,
    });
  } catch (error) {
    console.error("[audit] write failed:", (error as Error).message);
  }
}
