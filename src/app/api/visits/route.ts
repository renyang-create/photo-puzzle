import { NextResponse } from "next/server";

import { guardRequest, parseJsonBody } from "@/lib/http";
import { readAnonSessionId } from "@/lib/session";
import {
  classifyClient,
  hashDevice,
  referrerHost,
  shanghaiDay,
} from "@/lib/stats-core";
import { getAdminClient } from "@/lib/supabase/admin";
import { visitPayloadSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 自建访问打点。
 *
 * 前端只发 `{ kind: "view" | "play" }`，其余信息全部由服务端推导：
 *   * device_hash ← 我们自己的匿名 session cookie（HMAC 后存，24 位十六进制）
 *   * client      ← User-Agent 的粗分类（不存原文）
 *   * referrer    ← Referer 的**域名**（不存完整 URL）
 *   * day         ← 北京时间日期
 * 因此前端无从伪造来源、无法注入任意文本，也不会采集 IP。
 *
 * 无论如何都返回 204：统计失败绝不影响用户玩拼图。
 */
const NO_CONTENT = () =>
  new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function deviceSecret(): string {
  return process.env.SESSION_PASSWORD?.trim() || "dev-only-insecure-device-hash";
}

let warnedAboutMissingTable = false;

export async function POST(request: Request) {
  const blocked = guardRequest(request, "visits", { windowMs: 60_000, max: 90 });
  if (blocked) return blocked;

  const parsed = await parseJsonBody(request, visitPayloadSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const sessionId = await readAnonSessionId();
    if (!sessionId) return NO_CONTENT();

    const admin = getAdminClient();
    const { error } = await admin.from("visits").insert({
      day: shanghaiDay(new Date()),
      device_hash: hashDevice(sessionId, deviceSecret()),
      kind: parsed.data.kind,
      client: classifyClient(request.headers.get("user-agent")),
      referrer_host: referrerHost(
        request.headers.get("referer"),
        request.headers.get("host"),
      ),
    });

    if (error && !warnedAboutMissingTable) {
      warnedAboutMissingTable = true;
      console.error(
        "[api/visits] 写入失败（是否忘记执行 supabase/migrations/20261019000000_visits.sql？）：",
        error.message,
      );
    }
  } catch (error) {
    console.error("[api/visits]", error);
  }

  return NO_CONTENT();
}
