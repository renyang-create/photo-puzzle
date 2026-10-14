"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * 隐藏管理员入口：连续点击标题 5 次进入 /admin。
 * 只是「入口隐藏」，不是安全边界 —— /admin 与所有管理 API 都有服务端鉴权。
 */
export function HiddenAdminTrigger({
  children,
  className,
  clicks = 5,
  windowMs = 2500,
}: {
  children: ReactNode;
  className?: string;
  clicks?: number;
  windowMs?: number;
}) {
  const router = useRouter();
  const timestamps = useRef<number[]>([]);

  const handleClick = useCallback(() => {
    const now = Date.now();
    timestamps.current = [...timestamps.current, now].filter(
      (ts) => now - ts <= windowMs,
    );

    if (timestamps.current.length >= clicks) {
      timestamps.current = [];
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(30);
      }
      router.push("/admin");
    }
  }, [clicks, router, windowMs]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      // 纯装饰性入口，避免被读屏软件念出来
      aria-hidden="false"
      data-testid="hidden-admin-trigger"
    >
      {children}
    </button>
  );
}
