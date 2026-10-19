/**
 * 访问统计的核心算法。
 *
 * 这里**只放纯函数**（不 import `server-only`、不碰 next/headers），
 * 因此路由、单测都能直接调用 —— 统计口径有测试兜底，报告里的数字才敢往外写。
 */
import { createHmac } from "node:crypto";

/** 受众在国内，统一按北京时间归档，避免「今天」跨时区错位 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type VisitKind = "view" | "play";
export type ClientClass = "wechat" | "mobile" | "desktop" | "bot" | "other";

export interface VisitInput {
  day: string;
  deviceHash: string;
  kind: VisitKind;
  client: ClientClass | null;
  referrerHost: string | null;
}

export interface SolveInput {
  day: string;
  deviceHash: string;
  difficulty: number;
  bestTimeMs: number;
}

export interface DailyPoint {
  day: string;
  pv: number;
  uv: number;
  playPv: number;
  playUv: number;
  solves: number;
}

export interface BreakdownItem {
  key: string;
  pv: number;
  uv: number;
}

export interface StatsSummary {
  /** 观察窗口的天数（含今天） */
  days: number;
  daily: DailyPoint[];
  total: {
    /** 首页 PV / UV */
    pv: number;
    uv: number;
    /** 拼图页 PV / UV */
    playPv: number;
    playUv: number;
    /** 完成次数（unlocks 行数）与完成设备数 */
    solveCount: number;
    solveDevices: number;
    /** 出现在 >= 2 个不同日期上的设备数（回访） */
    returnDevices: number;
  };
  today: DailyPoint;
  /**
   * 转化率（基于设备数，比 PV 更稳）：
   *   enterPlay = 拼图页 UV / 首页 UV
   *   complete  = 完成设备 / 拼图页 UV
   */
  conversion: { enterPlay: number; complete: number };
  timing: { avgMs: number | null; fastestMs: number | null };
  difficulties: { difficulty: number; count: number; avgMs: number }[];
  clients: BreakdownItem[];
  referrers: BreakdownItem[];
}

/** ISO 时间 → 北京时间日期（YYYY-MM-DD） */
export function shanghaiDay(input: string | Date): string {
  const time = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (Number.isNaN(time)) return "";
  return new Date(time + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 生成 [endDay - count + 1, endDay] 的日期数组（升序，含首尾） */
export function dayRange(endDay: string, count: number): string[] {
  const end = Date.parse(`${endDay}T00:00:00Z`);
  if (Number.isNaN(end) || count <= 0) return [];
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(new Date(end - i * DAY_MS).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * 设备指纹：HMAC-SHA256(匿名 session id, SESSION_PASSWORD) 取前 24 位。
 * 无法反推 session、无法跨站关联；同一个匿名会话始终得到同一个值。
 */
export function hashDevice(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("hex").slice(0, 24);
}

/** 把 UA 粗分成 5 类（够写报告，且不做指纹识别） */
export function classifyClient(
  userAgent: string | null | undefined,
): ClientClass {
  if (!userAgent) return "other";
  const ua = userAgent.toLowerCase();
  if (/bot|spider|crawler|slurp|preview|headless|curl|wget|python-requests/.test(ua)) {
    return "bot";
  }
  if (ua.includes("micromessenger")) return "wechat";
  if (/android|iphone|ipad|ipod|mobile|harmonyos/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * 来源只取**域名**（不存完整 URL，避免把别人地址里的 query 一起存下来）。
 * 站内跳转返回 null，报告里显示为「直接访问」。
 */
export function referrerHost(
  referer: string | null | undefined,
  selfHost?: string | null,
): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const host = url.hostname.replace(/^www\./, "");
    const self = (selfHost ?? "").split(":")[0]?.replace(/^www\./, "") ?? "";
    if (self && (host === self || host.endsWith(`.${self}`))) return null;
    return host || null;
  } catch {
    return null;
  }
}

/** 只在内部用于换算转化率（展示用的格式化在 stats-format.ts，可被客户端引用） */
function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * 汇总统计。
 * `days` 决定窗口（升序日期数组），窗口外的数据会被丢弃 —— 多取几天也不会污染口径。
 * 机器人流量（client === "bot"）一律排除，否则报告里的 UV 会明显虚高。
 */
export function aggregate(input: {
  visits: VisitInput[];
  solves: SolveInput[];
  days: string[];
  today: string;
}): StatsSummary {
  const daySet = new Set(input.days);

  const buckets = new Map<string, DailyPoint>();
  const dayViewDevices = new Map<string, Set<string>>();
  const dayPlayDevices = new Map<string, Set<string>>();

  for (const day of input.days) {
    buckets.set(day, { day, pv: 0, uv: 0, playPv: 0, playUv: 0, solves: 0 });
    dayViewDevices.set(day, new Set());
    dayPlayDevices.set(day, new Set());
  }

  const allViewDevices = new Set<string>();
  const allPlayDevices = new Set<string>();
  const deviceDays = new Map<string, Set<string>>();
  const clientPv = new Map<string, number>();
  const clientDevices = new Map<string, Set<string>>();
  const referrerPv = new Map<string, number>();
  const referrerDevices = new Map<string, Set<string>>();

  for (const visit of input.visits) {
    if (!daySet.has(visit.day)) continue;
    if (visit.client === "bot") continue;

    const bucket = buckets.get(visit.day);
    if (!bucket) continue;

    if (visit.kind === "play") {
      bucket.playPv += 1;
      allPlayDevices.add(visit.deviceHash);
      dayPlayDevices.get(visit.day)?.add(visit.deviceHash);
    } else {
      bucket.pv += 1;
      allViewDevices.add(visit.deviceHash);
      dayViewDevices.get(visit.day)?.add(visit.deviceHash);
    }

    const days = deviceDays.get(visit.deviceHash) ?? new Set<string>();
    days.add(visit.day);
    deviceDays.set(visit.deviceHash, days);

    const clientKey = visit.client ?? "other";
    clientPv.set(clientKey, (clientPv.get(clientKey) ?? 0) + 1);
    const clientSet = clientDevices.get(clientKey) ?? new Set<string>();
    clientSet.add(visit.deviceHash);
    clientDevices.set(clientKey, clientSet);

    const referrerKey = visit.referrerHost ?? "直接访问";
    referrerPv.set(referrerKey, (referrerPv.get(referrerKey) ?? 0) + 1);
    const referrerSet = referrerDevices.get(referrerKey) ?? new Set<string>();
    referrerSet.add(visit.deviceHash);
    referrerDevices.set(referrerKey, referrerSet);
  }

  const solveDevices = new Set<string>();
  const difficultyStats = new Map<number, { count: number; totalMs: number }>();
  let solveCount = 0;
  let solveTotalMs = 0;
  let fastestMs: number | null = null;

  for (const solve of input.solves) {
    if (!daySet.has(solve.day)) continue;

    const bucket = buckets.get(solve.day);
    if (bucket) bucket.solves += 1;

    solveCount += 1;
    solveDevices.add(solve.deviceHash);
    solveTotalMs += solve.bestTimeMs;
    fastestMs =
      fastestMs === null ? solve.bestTimeMs : Math.min(fastestMs, solve.bestTimeMs);

    const entry = difficultyStats.get(solve.difficulty) ?? { count: 0, totalMs: 0 };
    entry.count += 1;
    entry.totalMs += solve.bestTimeMs;
    difficultyStats.set(solve.difficulty, entry);
  }

  for (const [day, bucket] of buckets) {
    bucket.uv = dayViewDevices.get(day)?.size ?? 0;
    bucket.playUv = dayPlayDevices.get(day)?.size ?? 0;
  }

  let returnDevices = 0;
  for (const days of deviceDays.values()) if (days.size >= 2) returnDevices += 1;

  const daily = input.days.map((day) => buckets.get(day)!);
  const today =
    buckets.get(input.today) ?? {
      day: input.today,
      pv: 0,
      uv: 0,
      playPv: 0,
      playUv: 0,
      solves: 0,
    };

  const clients: BreakdownItem[] = [...clientPv.entries()]
    .map(([key, pv]) => ({ key, pv, uv: clientDevices.get(key)?.size ?? 0 }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 5);

  const referrers: BreakdownItem[] = [...referrerPv.entries()]
    .map(([key, pv]) => ({ key, pv, uv: referrerDevices.get(key)?.size ?? 0 }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 5);

  const difficulties = [...difficultyStats.entries()]
    .map(([difficulty, entry]) => ({
      difficulty,
      count: entry.count,
      avgMs: Math.round(entry.totalMs / entry.count),
    }))
    .sort((a, b) => a.difficulty - b.difficulty);

  return {
    days: input.days.length,
    daily,
    total: {
      pv: daily.reduce((sum, point) => sum + point.pv, 0),
      uv: allViewDevices.size,
      playPv: daily.reduce((sum, point) => sum + point.playPv, 0),
      playUv: allPlayDevices.size,
      solveCount,
      solveDevices: solveDevices.size,
      returnDevices,
    },
    today,
    conversion: {
      enterPlay: ratio(allPlayDevices.size, allViewDevices.size),
      complete: ratio(solveDevices.size, allPlayDevices.size),
    },
    timing: {
      avgMs: solveCount > 0 ? Math.round(solveTotalMs / solveCount) : null,
      fastestMs,
    },
    difficulties,
    clients,
    referrers,
  };
}

// 展示与报告文案见 ./stats-format（客户端组件也要用，所以那边不带 node:crypto）。
// ⚠️ 这里**故意不做** re-export：scripts/report.mjs 会用
//    `node --experimental-strip-types` 直接加载本文件，
//    而 stats-format 的内部 import 是 TS 风格（不带扩展名），Node ESM 解析不了。
//    保持本文件只依赖 node:crypto，脚本与后台面板就能共用同一套聚合口径。
