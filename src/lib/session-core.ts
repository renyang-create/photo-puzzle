/**
 * 会话核心：只依赖 jose，同时可在 Edge（middleware）与 Node runtime 使用。
 * 不要在这里 import `server-only` 或 next/headers。
 */
import { SignJWT, jwtVerify } from "jose";

export const ANON_COOKIE = "pp_anon";
export const ADMIN_COOKIE = "pp_admin";

export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 年
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 12; // 12 小时

const ANON_TTL = "365d";
const ADMIN_TTL = "12h";

function sessionKey(): Uint8Array {
  const value = process.env.SESSION_PASSWORD?.trim();
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境 SESSION_PASSWORD 必须 >= 32 字符，请用 `openssl rand -base64 32` 生成",
      );
    }
    return new TextEncoder().encode(
      value || "dev-only-insecure-session-password-please-change-me",
    );
  }
  return new TextEncoder().encode(value);
}

export interface CookieFlags {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * HttpOnly + Secure + SameSite=Lax
 * 上线前在 DevTools → Application → Cookies 里确认三个 flag 都在。
 * 本地 http://localhost 下 Secure 必须为 false，否则浏览器直接不写入。
 */
export function cookieFlags(maxAge: number): CookieFlags {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export async function signAnonToken(sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId, kind: "anon" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(ANON_TTL)
    .sign(sessionKey());
}

export async function verifyAnonToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.kind !== "anon" || typeof payload.sid !== "string") return null;
    return payload.sid;
  } catch {
    return null;
  }
}

export interface AdminTokenPayload {
  actor: string;
  method: "password" | "supabase";
}

export async function signAdminToken(
  payload: AdminTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload, kind: "admin" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(ADMIN_TTL)
    .sign(sessionKey());
}

export async function verifyAdminToken(
  token: string,
): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.kind !== "admin" || typeof payload.actor !== "string") {
      return null;
    }
    return {
      actor: payload.actor,
      method: payload.method === "supabase" ? "supabase" : "password",
    };
  } catch {
    return null;
  }
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
