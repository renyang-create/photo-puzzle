"use client";

import { useEffect } from "react";

/**
 * 访问打点（自建，无第三方统计脚本）。
 *
 * * 每个浏览器会话对同一 kind 只发一次（sessionStorage 去重，刷新不会虚增 PV）
 * * 全部静默失败：统计出问题绝不影响玩拼图
 * * 请求体只有 { kind } —— 设备哈希、客户端分类、来源域名都由服务端推导，
 *   前端拿不到、也改不了这些字段
 */
export function VisitBeacon({ kind }: { kind: "view" | "play" }) {
  useEffect(() => {
    const key = `photoPuzzle.visit.${kind}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // 隐私模式下 sessionStorage 可能不可用：那就照发，不做去重
    }

    void fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      /* 静默 */
    });
  }, [kind]);

  return null;
}
