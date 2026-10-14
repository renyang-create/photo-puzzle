import "server-only";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { serverEnv } from "./env.server";
import { publicEnv } from "./env.public";
import type { ApiError } from "./types";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      // signed URL / 解锁文案都属于「即时数据」，不允许被任何中间层缓存
      "Cache-Control": "no-store, max-age=0",
      ...(init?.headers ?? {}),
    },
  });
}

const STATUS_BY_CODE: Record<ApiError["code"], number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  server_error: 500,
};

export function jsonError(code: ApiError["code"], error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error, code, ...(extra ?? {}) } satisfies ApiError,
    { status: STATUS_BY_CODE[code], headers: { "Cache-Control": "no-store" } },
  );
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/* ------------------------------------------------------------------ */
/* 限流：进程内滑动窗口                                                */
/* 单实例足够；多实例部署（Vercel 多 region/多实例）请换成 Upstash。      */
/* ------------------------------------------------------------------ */
type Bucket = { hits: number[]; };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  scope: string,
  key: string,
  options?: { windowMs?: number; max?: number },
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const windowMs = options?.windowMs ?? serverEnv.rateLimitWindowMs;
  const max = options?.max ?? serverEnv.rateLimitMax;
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  const bucket = buckets.get(bucketKey) ?? { hits: [] };

  bucket.hits = bucket.hits.filter((ts) => now - ts < windowMs);
  if (bucket.hits.length >= max) {
    buckets.set(bucketKey, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(bucketKey, bucket);

  if (buckets.size > 5_000) buckets.clear(); // 防止内存无限增长
  return { ok: true };
}

/**
 * CSRF 防护：所有写操作必须是同源请求。
 * 浏览器用 Origin 头，curl / 服务端调用没有 Origin 时放行（它们本来也带不了受害者的 cookie）。
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return true;

  const host = request.headers.get("host");
  try {
    const originUrl = new URL(origin);
    if (host && originUrl.host === host) return true;
    if (publicEnv.siteUrl && originUrl.origin === publicEnv.siteUrl) return true;
    if (process.env.NODE_ENV !== "production" && /^localhost|^127\.0\.0\.1|^\[::1\]/.test(originUrl.hostname)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: jsonError("bad_request", "Content-Type 必须是 application/json"),
    };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("bad_request", "请求体不是合法 JSON") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(
        "bad_request",
        parsed.error.issues[0]?.message ?? "参数校验失败",
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** 统一的「先限流 + 同源校验」守卫 */
export function guardRequest(
  request: Request,
  scope: string,
  options?: { windowMs?: number; max?: number },
): NextResponse | null {
  if (!isSameOrigin(request)) {
    return jsonError("forbidden", "跨站请求已被拒绝（CSRF 防护）");
  }
  const limited = rateLimit(scope, getClientIp(request), options);
  if (!limited.ok) {
    return jsonError("rate_limited", "请求过于频繁，请稍后再试", {
      retryAfter: limited.retryAfterSeconds,
    });
  }
  return null;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}
