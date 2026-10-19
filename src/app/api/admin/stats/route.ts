import { checkAdmin } from "@/lib/admin-auth";
import { publicEnv } from "@/lib/env.public";
import { guardRequest, jsonError, jsonOk } from "@/lib/http";
import {
  aggregate,
  dayRange,
  hashDevice,
  shanghaiDay,
  type ClientClass,
  type SolveInput,
  type VisitInput,
  type VisitKind,
} from "@/lib/stats-core";
import { formatReport } from "@/lib/stats-format";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 个人站点量级很小，一次取回在内存里聚合即可；上限只是防御性约束 */
const MAX_ROWS = 20_000;

function deviceSecret(): string {
  return process.env.SESSION_PASSWORD?.trim() || "dev-only-insecure-device-hash";
}

/**
 * GET /api/admin/stats?days=14 —— 后台数据面板
 *
 * 口径：
 *   visits.kind = 'view' → 首页浏览；'play' → 进入拼图页
 *   unlocks            → 完成解锁（每条 = 某设备在某难度拼完一张照片）
 *   机器人流量在聚合时排除（client = 'bot'）
 */
export async function GET(request: Request) {
  const blocked = guardRequest(request, "admin-stats", { max: 30 });
  if (blocked) return blocked;

  const check = await checkAdmin();
  if (!check.isAdmin) return jsonError("unauthorized", "需要管理员登录");

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("days") ?? 14);
  const days = Number.isFinite(requested)
    ? Math.min(90, Math.max(7, Math.trunc(requested)))
    : 14;

  const today = shanghaiDay(new Date());
  const window = dayRange(today, days);
  const since = window[0] ?? today;

  try {
    const admin = getAdminClient();
    const [visitsResult, solvesResult] = await Promise.all([
      admin
        .from("visits")
        .select("day,device_hash,kind,client,referrer_host")
        .gte("day", since)
        .limit(MAX_ROWS),
      admin
        .from("unlocks")
        .select("anon_session_id,difficulty,best_time_ms,created_at")
        .gte("created_at", `${since}T00:00:00+08:00`)
        .limit(MAX_ROWS),
    ]);

    if (visitsResult.error) {
      const missing = /does not exist|Could not find the table|schema cache/i.test(
        visitsResult.error.message,
      );
      return jsonError(
        "server_error",
        missing
          ? "统计表 visits 还不存在：请先执行 supabase/migrations/20261019000000_visits.sql（或用 pnpm db:push 推送迁移）"
          : `读取访问数据失败：${visitsResult.error.message}`,
      );
    }
    if (solvesResult.error) {
      return jsonError(
        "server_error",
        `读取完成记录失败：${solvesResult.error.message}`,
      );
    }

    const secret = deviceSecret();

    const visits: VisitInput[] = (visitsResult.data ?? []).map((row) => ({
      day: typeof row.day === "string" ? row.day.slice(0, 10) : shanghaiDay(row.day),
      deviceHash: row.device_hash,
      kind: (row.kind === "play" ? "play" : "view") as VisitKind,
      client: (row.client as ClientClass | null) ?? null,
      referrerHost: row.referrer_host ?? null,
    }));

    const solves: SolveInput[] = (solvesResult.data ?? []).map((row) => ({
      day: shanghaiDay(row.created_at),
      // 与 visits 用同一个 secret，才能按设备判断「进入后是否完成」
      deviceHash: hashDevice(row.anon_session_id, secret),
      difficulty: row.difficulty,
      bestTimeMs: row.best_time_ms,
    }));

    const summary = aggregate({ visits, solves, days: window, today });
    const rangeLabel = `近 ${days} 天`;

    return jsonOk({
      ok: true,
      rangeLabel,
      today,
      summary,
      // 报告文案在服务端生成，客户端只负责「复制」
      report: formatReport(summary, {
        siteName: publicEnv.siteName,
        rangeLabel,
      }),
    });
  } catch (error) {
    console.error("[api/admin/stats]", error);
    return jsonError("server_error", "统计计算失败");
  }
}
