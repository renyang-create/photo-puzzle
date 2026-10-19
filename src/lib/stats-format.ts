/**
 * 统计结果的展示与报告文案。
 *
 * ⚠️ 单独成文件的原因：客户端组件（后台面板）要用 `formatDuration`，
 * 而 `stats-core.ts` 依赖 `node:crypto`（HMAC 设备哈希），不能被前端 bundle 引用。
 * 这里只 `import type`，编译后不留运行时依赖。
 */
import type { StatsSummary } from "./stats-core";

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** 生成可直接粘进报告的 Markdown 摘要 */
export function formatReport(
  summary: StatsSummary,
  meta: { siteName: string; rangeLabel: string },
): string {
  const { total, conversion, timing } = summary;
  const lines: string[] = [];

  lines.push(`## ${meta.siteName} · 访问数据（${meta.rangeLabel}）`);
  lines.push("");
  lines.push("### 概览");
  lines.push(`- 首页访问：**${total.pv} PV / ${total.uv} UV**`);
  lines.push(
    `- 进入拼图页：**${total.playPv} PV / ${total.playUv} UV**（进入率 ${percent(conversion.enterPlay)}）`,
  );
  lines.push(
    `- 完成解锁：**${total.solveCount} 次 / ${total.solveDevices} 台设备**（完成率 ${percent(conversion.complete)}）`,
  );
  lines.push(
    `- 回访设备：**${total.returnDevices} 台**（统计窗口内出现 ≥ 2 天）`,
  );
  if (timing.avgMs !== null) {
    lines.push(
      `- 平均用时：**${formatDuration(timing.avgMs)}**；最快：**${formatDuration(timing.fastestMs ?? 0)}**`,
    );
  }

  lines.push("");
  lines.push("### 难度分布");
  if (summary.difficulties.length === 0) {
    lines.push("- 暂无完成记录");
  } else {
    for (const item of summary.difficulties) {
      lines.push(
        `- ${item.difficulty}×${item.difficulty}：${item.count} 次，平均 ${formatDuration(item.avgMs)}`,
      );
    }
  }

  lines.push("");
  lines.push("### 访问来源");
  const totalPv = Math.max(1, total.pv + total.playPv);
  lines.push(
    `- 客户端：${
      summary.clients
        .map((item) => `${item.key} ${percent(ratio(item.pv, totalPv))}`)
        .join("、") || "—"
    }`,
  );
  lines.push(
    `- 来源域名：${
      summary.referrers.map((item) => `${item.key} ${item.pv} PV`).join("、") || "—"
    }`,
  );

  lines.push("");
  lines.push("### 每日明细");
  lines.push("| 日期 | 首页 PV | 首页 UV | 拼图页 PV | 完成 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const point of summary.daily) {
    lines.push(
      `| ${point.day} | ${point.pv} | ${point.uv} | ${point.playPv} | ${point.solves} |`,
    );
  }

  lines.push("");
  lines.push(
    "> 口径：自建计数，由服务端写入 Supabase；只记录日期、设备哈希（HMAC-SHA256）、页面类型、粗分类客户端与来源域名，" +
      "**不采集 IP、不采集 UA 原文、不使用任何第三方统计脚本**。机器人流量已排除。",
  );

  return lines.join("\n");
}
