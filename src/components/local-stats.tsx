"use client";

import { useLocalProgress } from "@/hooks/use-local-progress";
import { STORAGE_KEYS } from "@/lib/local-store";
import { DIFFICULTY_META } from "@/lib/puzzle";

/**
 * 本机进度（localStorage 统一 key：photoPuzzle.*）。
 * 数据通过 useSyncExternalStore 读取，天然避开「在 effect 里 setState」的级联渲染。
 */
export function LocalStats() {
  const progress = useLocalProgress();

  if (!progress) {
    return <div className="h-24" aria-hidden />;
  }

  const best = Object.values(progress.bestTimes)
    .flatMap((times) => Object.values(times))
    .filter((value): value is number => typeof value === "number");
  const bestMs = best.length > 0 ? Math.min(...best) : null;

  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <Stat label="已解锁" value={`${progress.unlocked.length} 张`} />
      <Stat label="累计开局" value={`${progress.total} 次`} />
      <Stat
        label="最快纪录"
        value={bestMs === null ? "—" : `${(bestMs / 1000).toFixed(1)}s`}
      />
      <p className="text-muted-foreground col-span-3 text-[11px]">
        本机记录 key：{STORAGE_KEYS.unlocked} · 上次难度{" "}
        {DIFFICULTY_META[progress.lastDifficulty].label}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-3">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
