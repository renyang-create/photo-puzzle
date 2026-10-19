#!/usr/bin/env node
/**
 * 一键生成访问报告（控制台摘要 + 可直接粘贴的 Markdown）
 *
 *   pnpm report          # 近 30 天
 *   pnpm report 7        # 近 7 天（7 ~ 90）
 *
 * 特点：
 *   * **直读你自己的 Supabase**（service_role），不依赖线上是否已部署，也不用登录后台。
 *   * 统计口径与后台「数据概览」**完全一致** —— 直接复用 src/lib/stats-core.ts 的聚合函数，
 *     不存在第二套算法，因此报告里的数字与面板永远对得上。
 *   * 只读取，不写入任何数据；也不会打印密钥。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  aggregate,
  dayRange,
  hashDevice,
  shanghaiDay,
} from "../src/lib/stats-core.ts";
import {
  formatDuration,
  formatReport,
  percent,
  rate,
} from "../src/lib/stats-format.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 优先用已有环境变量，其次读 .env.local（值不会被打印） */
function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const matched = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (matched && !env[matched[1]]) env[matched[1]] = matched[2].trim();
    }
  } catch {
    /* 没有 .env.local 时用现有环境变量（例如 CI 里注入） */
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const secret = env.SESSION_PASSWORD?.trim() || "dev-only-insecure-device-hash";

if (!url || !serviceKey) {
  console.error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（写在 .env.local 或环境变量里）",
  );
  process.exit(1);
}

const requested = Number(process.argv[2]);
const days = Number.isFinite(requested) && requested > 0
  ? Math.min(90, Math.max(7, Math.trunc(requested)))
  : 30;

const today = shanghaiDay(new Date());
const window = dayRange(today, days);
const since = window[0];

const db = createClient(url, serviceKey, {
  auth: { persistSession: false },
  global: { headers: { "X-Client-Info": "photo-puzzle/report-script" } },
});

const [visitsResult, solvesResult] = await Promise.all([
  db
    .from("visits")
    .select("day,device_hash,kind,client,referrer_host")
    .gte("day", since)
    .limit(50_000),
  db
    .from("unlocks")
    .select("anon_session_id,difficulty,best_time_ms,created_at")
    .gte("created_at", `${since}T00:00:00+08:00`)
    .limit(50_000),
]);

if (visitsResult.error) {
  console.error("读取 visits 失败：" + visitsResult.error.message);
  console.error(
    "→ 若提示表不存在，请先执行 supabase/migrations/20261019000000_visits.sql",
  );
  process.exit(1);
}
if (solvesResult.error) {
  console.error("读取 unlocks 失败：" + solvesResult.error.message);
  process.exit(1);
}

const visits = (visitsResult.data ?? []).map((row) => ({
  day: String(row.day).slice(0, 10),
  deviceHash: row.device_hash,
  kind: row.kind === "play" ? "play" : "view",
  client: row.client ?? null,
  referrerHost: row.referrer_host ?? null,
}));

const solves = (solvesResult.data ?? []).map((row) => ({
  day: shanghaiDay(row.created_at),
  deviceHash: hashDevice(row.anon_session_id, secret),
  difficulty: row.difficulty,
  bestTimeMs: row.best_time_ms,
}));

const summary = aggregate({ visits, solves, days: window, today });
const { total, conversion, timing } = summary;

// ---------------- 控制台摘要 ----------------
const pad = (value, width) => String(value).padStart(width);

console.log("");
console.log(`═══ 照片拼图解锁 · 访问报告（${today} · 近 ${days} 天）═══`);
console.log("");
console.log(`  首页访问     ${pad(total.uv, 4)} UV  /  ${pad(total.pv, 4)} PV`);
console.log(
  `  进入拼图页   ${pad(total.playUv, 4)} UV  /  ${pad(total.playPv, 4)} PV   进入率 ${rate(conversion.enterPlay, total.uv)}`,
);
console.log(
  `  完成解锁     ${pad(total.solveDevices, 4)} 台设备 / ${pad(total.solveCount, 4)} 次   完成率 ${rate(conversion.complete, total.playUv)}`,
);
console.log(`  回访设备     ${pad(total.returnDevices, 4)} 台（窗口内出现 ≥ 2 天）`);
if (timing.avgMs !== null) {
  console.log(
    `  用时         平均 ${formatDuration(timing.avgMs)}，最快 ${formatDuration(timing.fastestMs ?? 0)}`,
  );
}

if (total.pv === 0) {
  console.log("");
  console.log("  ⚠️ 访问数据为空：站点打点还没上线（线上仍是旧版本）。");
  console.log("     下面的「完成」数字来自 unlocks 表的历史记录，可直接用。");
}

console.log("");
console.log("  每日明细（最近 7 天）");
for (const point of summary.daily.slice(-7)) {
  console.log(
    `    ${point.day}   PV ${pad(point.pv, 3)}   UV ${pad(point.uv, 3)}   拼图PV ${pad(point.playPv, 3)}   完成 ${pad(point.solves, 2)}`,
  );
}

console.log("");
console.log("  难度分布");
if (summary.difficulties.length === 0) {
  console.log("    暂无完成记录");
} else {
  for (const item of summary.difficulties) {
    console.log(
      `    ${item.difficulty}×${item.difficulty}   ${item.count} 次，平均 ${formatDuration(item.avgMs)}`,
    );
  }
}

const totalPv = Math.max(1, total.pv + total.playPv);
console.log("");
console.log("  来源");
console.log(
  "    客户端：" +
    (summary.clients
      .map((item) => `${item.key} ${percent(item.pv / totalPv)}`)
      .join("、") || "—"),
);
console.log(
  "    域名  ：" +
    (summary.referrers.map((item) => `${item.key} ${item.pv} PV`).join("、") ||
      "—"),
);

// ---------------- Markdown ----------------
console.log("");
console.log("════════ 以下 Markdown 可直接复制进报告 ════════");
console.log("");
console.log(
  formatReport(summary, {
    siteName: env.NEXT_PUBLIC_SITE_NAME || "照片拼图解锁",
    rangeLabel: `近 ${days} 天，截至 ${today}`,
  }),
);
console.log("");
