"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client-api";
import { formatDuration, rate } from "@/lib/stats-format";
import type { StatsSummary } from "@/lib/stats-core";

interface StatsResponse {
  ok: boolean;
  rangeLabel: string;
  today: string;
  /** 服务端生成的 Markdown 报告摘要（客户端只负责复制） */
  report: string;
  summary: StatsSummary;
}

const CLIENT_LABEL: Record<string, string> = {
  wechat: "微信内",
  mobile: "移动浏览器",
  desktop: "桌面浏览器",
  bot: "机器人",
  other: "其他",
};

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-[11px]">{hint}</p>
    </div>
  );
}

/**
 * 后台「数据概览」：自建统计的可视化。
 * 数据来自 /api/admin/stats（服务端聚合），这里只做展示与复制。
 */
export function StatsPanel() {
  const [days, setDays] = useState<Range>(14);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * 只发请求。loading / error 的切换放在事件处理器与 await 之后，
   * 避免在 effect 体内同步 setState（react-hooks/set-state-in-effect）。
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await apiGet<StatsResponse>(
          `/api/admin/stats?days=${days}`,
        );
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setData(null);
        setError(err instanceof Error ? err.message : "加载统计失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [days, tick]);

  function changeRange(range: Range) {
    setLoading(true);
    if (range === days) {
      setTick((value) => value + 1);
      return;
    }
    setDays(range);
  }

  function refresh() {
    setLoading(true);
    setTick((value) => value + 1);
  }

  const summary = data?.summary;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-sky-300" />
          数据概览
          {data && <Badge variant="secondary">{data.rangeLabel}</Badge>}
        </h2>
        <div className="flex items-center gap-1">
          {RANGES.map((range) => (
            <Button
              key={range}
              variant={days === range ? "secondary" : "ghost"}
              size="sm"
              onClick={() => changeRange(range)}
            >
              {range} 天
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            title="刷新"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="复制 Markdown 报告摘要"
            disabled={!data}
            onClick={async () => {
              if (!data) return;
              try {
                await navigator.clipboard.writeText(data.report);
                toast.success("报告摘要已复制（Markdown）");
              } catch {
                toast.error("复制失败：浏览器拒绝了剪贴板权限");
              }
            }}
          >
            <ClipboardCopy className="size-4" />
            复制报告
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-xs leading-relaxed text-rose-100">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-xs">
          <Loader2 className="size-4 animate-spin" />
          正在统计…
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card
              label="首页访问"
              value={String(summary.total.uv)}
              hint={`UV · ${summary.total.pv} PV`}
            />
            <Card
              label="进入拼图页"
              value={String(summary.total.playUv)}
              hint={`UV · 进入率 ${rate(summary.conversion.enterPlay, summary.total.uv)}`}
            />
            <Card
              label="完成解锁"
              value={String(summary.total.solveDevices)}
              hint={`台设备 · ${summary.total.solveCount} 次`}
            />
            <Card
              label="完成率"
              value={rate(summary.conversion.complete, summary.total.playUv)}
              hint="完成设备 / 进入拼图页设备"
            />
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
            <TrendingUp className="size-3.5 text-emerald-300" />
            <span>
              今日：首页 {summary.today.uv} UV / {summary.today.pv} PV · 完成{" "}
              {summary.today.solves} 次
            </span>
            <span className="opacity-60">·</span>
            <span>回访设备 {summary.total.returnDevices} 台</span>
            {summary.timing.avgMs !== null && (
              <>
                <span className="opacity-60">·</span>
                <span>
                  平均用时 {formatDuration(summary.timing.avgMs)}
                  {summary.timing.fastestMs !== null &&
                    ` · 最快 ${formatDuration(summary.timing.fastestMs)}`}
                </span>
              </>
            )}
          </div>

          <div className="max-h-64 overflow-auto rounded-lg border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground sticky top-0 bg-white/[0.04]">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">日期</th>
                  <th className="px-2 py-1.5 text-right font-medium">首页 PV</th>
                  <th className="px-2 py-1.5 text-right font-medium">首页 UV</th>
                  <th className="px-2 py-1.5 text-right font-medium">拼图页 PV</th>
                  <th className="px-2 py-1.5 text-right font-medium">完成</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.daily].reverse().map((point) => (
                  <tr key={point.day} className="border-t border-white/5">
                    <td className="px-2 py-1.5 tabular-nums">{point.day}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {point.pv}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {point.uv}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {point.playPv}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {point.solves}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 text-[11px] sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground mb-1">难度分布</p>
              {summary.difficulties.length === 0 ? (
                <p className="text-muted-foreground/70">暂无完成记录</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {summary.difficulties.map((item) => (
                    <li key={item.difficulty} className="tabular-nums">
                      {item.difficulty}×{item.difficulty}：{item.count} 次 · 平均{" "}
                      {formatDuration(item.avgMs)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-muted-foreground mb-1">客户端</p>
              {summary.clients.length === 0 ? (
                <p className="text-muted-foreground/70">—</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {summary.clients.map((item) => (
                    <li key={item.key} className="tabular-nums">
                      {CLIENT_LABEL[item.key] ?? item.key}：{item.pv} PV · {item.uv} UV
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-muted-foreground mb-1">来源域名</p>
              {summary.referrers.length === 0 ? (
                <p className="text-muted-foreground/70">—</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {summary.referrers.map((item) => (
                    <li key={item.key} className="tabular-nums">
                      {item.key}：{item.pv} PV
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-muted-foreground/70 text-[10px] leading-relaxed">
            口径：自建计数，服务端写入 Supabase。只记录日期、设备哈希（HMAC）、页面类型、粗分类客户端与来源域名；不采集 IP、不采集 UA 原文、不使用第三方统计脚本。机器人流量已排除。
          </p>
        </>
      )}
    </section>
  );
}
