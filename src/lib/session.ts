import { cookies } from "next/headers";

import {
  ADMIN_COOKIE,
  ANON_COOKIE,
  ANON_COOKIE_MAX_AGE,
  cookieFlags,
  newSessionId,
  signAnonToken,
  verifyAdminToken,
  verifyAnonToken,
  type AdminTokenPayload,
} from "./session-core";

export {
  ADMIN_COOKIE,
  ANON_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
} from "./session-core";

/** 读取匿名 session id（不可伪造：JWT 由服务端用 SESSION_PASSWORD 签名） */
export async function readAnonSessionId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(ANON_COOKIE)?.value;
  if (!token) return null;
  return verifyAnonToken(token);
}

/**
 * 拿到（必要时签发）匿名 session id。
 * 注意：它只用于「解锁统计维度」，不承担任何认证职责。
 */
export async function ensureAnonSession(): Promise<string> {
  const store = await cookies();
  const existing = store.get(ANON_COOKIE)?.value;
  if (existing) {
    const verified = await verifyAnonToken(existing);
    if (verified) return verified;
  }

  const sessionId = newSessionId();
  const token = await signAnonToken(sessionId);
  store.set(ANON_COOKIE, token, cookieFlags(ANON_COOKIE_MAX_AGE));
  return sessionId;
}

/** 在 Route Handler / Server Action 中设置管理员 session cookie */
export async function setAdminSessionCookie(token: string, maxAge: number) {
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, cookieFlags(maxAge));
}

export async function clearAdminSessionCookie() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "", { ...cookieFlags(0), maxAge: 0 });
}

export async function readAdminSession(): Promise<AdminTokenPayload | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}
