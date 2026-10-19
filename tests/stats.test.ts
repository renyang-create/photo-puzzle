import { describe, expect, it } from "vitest";

import {
  aggregate,
  classifyClient,
  dayRange,
  hashDevice,
  referrerHost,
  shanghaiDay,
  type SolveInput,
  type VisitInput,
} from "@/lib/stats-core";
import { formatDuration, formatReport } from "@/lib/stats-format";

describe("北京时间归档", () => {
  it("UTC 16:30 属于「第二天」", () => {
    expect(shanghaiDay("2026-10-18T16:30:00.000Z")).toBe("2026-10-19");
  });

  it("UTC 15:59 仍属于当天（北京时间 23:59）", () => {
    expect(shanghaiDay("2026-10-18T15:59:00.000Z")).toBe("2026-10-18");
  });

  it("非法输入返回空字符串", () => {
    expect(shanghaiDay("not-a-date")).toBe("");
  });
});

describe("日期窗口", () => {
  it("升序、含首尾、长度为 count", () => {
    expect(dayRange("2026-10-19", 3)).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ]);
  });

  it("count <= 0 返回空数组", () => {
    expect(dayRange("2026-10-19", 0)).toEqual([]);
  });
});

describe("设备哈希", () => {
  it("同一 session + 同一 secret 稳定复现", () => {
    const a = hashDevice("session-1", "secret-a");
    expect(a).toBe(hashDevice("session-1", "secret-a"));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });

  it("换 secret 或换 session 都会变", () => {
    expect(hashDevice("session-1", "secret-a")).not.toBe(
      hashDevice("session-1", "secret-b"),
    );
    expect(hashDevice("session-1", "secret-a")).not.toBe(
      hashDevice("session-2", "secret-a"),
    );
  });
});

describe("客户端粗分类", () => {
  it("微信内置浏览器", () => {
    expect(
      classifyClient(
        "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 MicroMessenger/8.0.49",
      ),
    ).toBe("wechat");
  });

  it("普通手机浏览器", () => {
    expect(
      classifyClient("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36"),
    ).toBe("mobile");
  });

  it("桌面浏览器", () => {
    expect(
      classifyClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36"),
    ).toBe("desktop");
  });

  it("爬虫与命令行", () => {
    expect(classifyClient("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot");
    expect(classifyClient("curl/8.5.0")).toBe("bot");
  });

  it("空 UA 归入 other", () => {
    expect(classifyClient(null)).toBe("other");
  });
});

describe("来源域名", () => {
  it("只保留域名，并去掉 www. 与 query", () => {
    expect(
      referrerHost("https://www.weixin.qq.com/s?__biz=abc&mid=1", "example.com"),
    ).toBe("weixin.qq.com");
  });

  it("站内跳转不算来源", () => {
    expect(
      referrerHost(
        "https://puzzle.example.com/play",
        "puzzle.example.com",
      ),
    ).toBeNull();
  });

  it("无 Referer 与非法值都返回 null", () => {
    expect(referrerHost(null, "example.com")).toBeNull();
    expect(referrerHost("::not a url::", "example.com")).toBeNull();
  });
});

describe("聚合口径", () => {
  const days = dayRange("2026-10-19", 3); // 17 / 18 / 19

  const visits: VisitInput[] = [
    // 10-17：A 浏览 + 进入拼图页，B 浏览（来源 github）
    { day: "2026-10-17", deviceHash: "a", kind: "view", client: "wechat", referrerHost: null },
    { day: "2026-10-17", deviceHash: "a", kind: "play", client: "wechat", referrerHost: null },
    { day: "2026-10-17", deviceHash: "b", kind: "view", client: "mobile", referrerHost: "github.com" },
    // 10-19：A 回访，C 浏览并进入拼图页，另有一条爬虫流量
    { day: "2026-10-19", deviceHash: "a", kind: "view", client: "wechat", referrerHost: null },
    { day: "2026-10-19", deviceHash: "c", kind: "view", client: "desktop", referrerHost: null },
    { day: "2026-10-19", deviceHash: "c", kind: "play", client: "desktop", referrerHost: null },
    { day: "2026-10-19", deviceHash: "z", kind: "view", client: "bot", referrerHost: null },
    // 窗口外，必须被丢弃
    { day: "2026-10-01", deviceHash: "x", kind: "view", client: "mobile", referrerHost: null },
  ];

  const solves: SolveInput[] = [
    { day: "2026-10-17", deviceHash: "a", difficulty: 3, bestTimeMs: 60_000 },
    { day: "2026-10-19", deviceHash: "c", difficulty: 4, bestTimeMs: 90_000 },
  ];

  const summary = aggregate({ visits, solves, days, today: "2026-10-19" });

  it("PV 排除机器人，且窗口外的数据不进统计", () => {
    expect(summary.total.pv).toBe(4); // a17 b17 a19 c19
    expect(summary.total.playPv).toBe(2);
  });

  it("UV 按设备去重", () => {
    expect(summary.total.uv).toBe(3); // a b c
    expect(summary.total.playUv).toBe(2); // a c
  });

  it("完成次数 / 完成设备 / 回访设备", () => {
    expect(summary.total.solveCount).toBe(2);
    expect(summary.total.solveDevices).toBe(2);
    expect(summary.total.returnDevices).toBe(1); // 只有 a 跨两天出现
  });

  it("转化率基于设备数", () => {
    expect(summary.conversion.enterPlay).toBeCloseTo(2 / 3, 5);
    expect(summary.conversion.complete).toBeCloseTo(1, 5);
  });

  it("用时统计", () => {
    expect(summary.timing.avgMs).toBe(75_000);
    expect(summary.timing.fastestMs).toBe(60_000);
  });

  it("难度分布按数值升序", () => {
    expect(summary.difficulties).toEqual([
      { difficulty: 3, count: 1, avgMs: 60_000 },
      { difficulty: 4, count: 1, avgMs: 90_000 },
    ]);
  });

  it("空档日期会被补 0（表格不会缺行）", () => {
    expect(summary.daily.map((point) => point.day)).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ]);
    expect(summary.daily[1]).toEqual({
      day: "2026-10-18",
      pv: 0,
      uv: 0,
      playPv: 0,
      playUv: 0,
      solves: 0,
    });
  });

  it("today 指向窗口最后一天", () => {
    expect(summary.today).toEqual({
      day: "2026-10-19",
      pv: 2,
      uv: 2,
      playPv: 1,
      playUv: 1,
      solves: 1,
    });
  });

  it("客户端与来源都做了聚合", () => {
    const wechat = summary.clients.find((item) => item.key === "wechat");
    expect(wechat?.pv).toBe(3); // a17 两次 + a19 一次
    expect(summary.referrers.some((item) => item.key === "github.com")).toBe(true);
    expect(summary.referrers.some((item) => item.key === "直接访问")).toBe(true);
  });
});

describe("展示格式", () => {
  it("不足一分钟显示秒", () => {
    expect(formatDuration(12_345)).toBe("12.3 秒");
  });

  it("超过一分钟显示分秒", () => {
    expect(formatDuration(84_000)).toBe("1 分 24 秒");
    expect(formatDuration(120_000)).toBe("2 分");
  });
});

describe("报告摘要", () => {
  it("包含关键结论、每日表格与口径说明", () => {
    const days = dayRange("2026-10-19", 2);
    const summary = aggregate({
      visits: [
        { day: "2026-10-19", deviceHash: "a", kind: "view", client: "wechat", referrerHost: null },
        { day: "2026-10-19", deviceHash: "a", kind: "play", client: "wechat", referrerHost: null },
      ],
      solves: [{ day: "2026-10-19", deviceHash: "a", difficulty: 3, bestTimeMs: 45_000 }],
      days,
      today: "2026-10-19",
    });

    const report = formatReport(summary, {
      siteName: "解锁任阳的照片",
      rangeLabel: "近 2 天",
    });

    expect(report).toContain("## 解锁任阳的照片 · 访问数据（近 2 天）");
    // 首页 PV 只统计 kind=view（play 单独计入拼图页）
    expect(report).toContain("首页访问：**1 PV / 1 UV**");
    expect(report).toContain("完成解锁：**1 次 / 1 台设备**");
    expect(report).toContain("| 2026-10-19 |");
    expect(report).toContain("不采集 IP");
  });
});
