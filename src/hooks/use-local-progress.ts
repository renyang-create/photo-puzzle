"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  getProgressSnapshot,
  getServerProgressSnapshot,
  parseProgressSnapshot,
  subscribeProgress,
  type LocalProgress,
} from "@/lib/local-store";

/**
 * 订阅本机进度（localStorage）。
 *   - 服务端快照固定为 null，组件按「还没读到」降级渲染，避免 hydration 不一致；
 *   - 任何一次 writeProgress 都会触发订阅者同步更新。
 */
export function useLocalProgress(): LocalProgress | null {
  const snapshot = useSyncExternalStore(
    subscribeProgress,
    getProgressSnapshot,
    getServerProgressSnapshot,
  );

  return useMemo(() => parseProgressSnapshot(snapshot), [snapshot]);
}
