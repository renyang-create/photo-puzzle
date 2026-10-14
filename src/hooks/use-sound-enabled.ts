"use client";

import { useCallback, useSyncExternalStore } from "react";

import { audio } from "@/lib/audio";
import {
  getServerSoundSnapshot,
  getSoundSnapshot,
  parseSoundSnapshot,
  readSoundEnabled,
  subscribeSound,
  writeSoundEnabled,
} from "@/lib/local-store";

/**
 * 声音开关（右上角喇叭）。
 * 状态存在 localStorage 的 photoPuzzle.soundEnabled，用 useSyncExternalStore 订阅，
 * 与音频管理器保持同步；服务端快照固定为 null（默认开），避免 hydration 不一致。
 */
export function useSoundEnabled() {
  const snapshot = useSyncExternalStore(
    subscribeSound,
    getSoundSnapshot,
    getServerSoundSnapshot,
  );
  const enabled = parseSoundSnapshot(snapshot);

  const setEnabled = useCallback((next: boolean) => {
    writeSoundEnabled(next);
    audio.setEnabled(next);
  }, []);

  const toggle = useCallback(() => {
    // 以「存储里的最新值」为准取反，避免连点时的竞态
    setEnabled(!readSoundEnabled());
  }, [setEnabled]);

  return { enabled, toggle, setEnabled };
}
