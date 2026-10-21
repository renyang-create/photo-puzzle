"use client";

import { Cake } from "lucide-react";
import { useSyncExternalStore } from "react";

import { publicEnv } from "@/lib/env.public";

/**
 * 首页生日倒计时（纯展示组件）。
 *
 * 约定：
 *   - 生日**写死**为 1 月 14 日，不读任何环境变量 —— 换电脑、换部署平台、
 *     环境变量被清空都不会变，想改只能改下面这一行源码；
 *   - 按 Asia/Shanghai（UTC+8，无夏令时）判定，避免访客设备时区不同导致「今天」错位；
 *   - 时间通过 useSyncExternalStore 订阅，服务端快照固定为 null（首帧渲染占位格子），
 *     避免 Date.now() 在 SSR / CSR 之间不一致造成 hydration mismatch；
 *   - 不发起请求、不读写 localStorage、不拦截点击，也不使用 fixed/全屏层，
 *     因此不会影响首页「开始挑战」进入拼图的主流程。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

type Birthday = { month: number; day: number };

/** 1 月 14 日（写死，不可配置）。 */
const BIRTHDAY: Birthday = { month: 1, day: 14 };

type Remaining =
  | { kind: "today" }
  | {
      kind: "counting";
      days: number;
      hours: number;
      minutes: number;
      seconds: number;
    };

/** 生日当天（上海时间 00:00–24:00）返回 today，否则给出到下一个生日的剩余时长。 */
function resolveRemaining(nowMs: number, birthday: Birthday): Remaining {
  const shanghaiYear = new Date(nowMs + TZ_OFFSET_MS).getUTCFullYear();
  const startOf = (year: number) =>
    Date.UTC(year, birthday.month - 1, birthday.day) - TZ_OFFSET_MS;

  let target = startOf(shanghaiYear);
  // 今年的生日已经过完（含当天 24:00 之后），就顺延到明年
  if (nowMs >= target + DAY_MS) target = startOf(shanghaiYear + 1);
  if (nowMs >= target) return { kind: "today" };

  const left = target - nowMs;
  return {
    kind: "counting",
    days: Math.floor(left / DAY_MS),
    hours: Math.floor((left % DAY_MS) / 3_600_000),
    minutes: Math.floor((left % 3_600_000) / 60_000),
    seconds: Math.floor((left % 60_000) / 1000),
  };
}

function subscribeTick(onChange: () => void) {
  let timer: number | undefined;

  const stop = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  const start = () => {
    if (timer === undefined) timer = window.setInterval(onChange, 1000);
  };

  // 标签页隐藏时停表（省电），回到前台立刻补算一次
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    start();
    onChange();
  };

  start();
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

const getSnapshot = (): number | null => Math.floor(Date.now() / 1000);
const getServerSnapshot = (): number | null => null;

const pad = (value: number) => String(value).padStart(2, "0");

export function BirthdayCountdown() {
  return <Countdown birthday={BIRTHDAY} />;
}

function Countdown({ birthday }: { birthday: Birthday }) {
  const epochSeconds = useSyncExternalStore<number | null>(
    subscribeTick,
    getSnapshot,
    getServerSnapshot,
  );
  const remaining =
    epochSeconds === null ? null : resolveRemaining(epochSeconds * 1000, birthday);

  const isToday = remaining?.kind === "today";

  return (
    <section
      aria-label="生日倒计时"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="text-muted-foreground flex items-center gap-2 text-[11px]">
        <Cake className="size-3.5 shrink-0" />
        {isToday
          ? `今天是 ${publicEnv.nickname} 的生日`
          : `距离 ${publicEnv.nickname} 的生日还有`}
      </p>

      {isToday ? (
        <p className="mt-2 bg-gradient-to-r from-violet-300 to-sky-300 bg-clip-text text-lg font-semibold text-transparent">
          生日快乐 🎂
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          <Unit label="天" value={remaining ? String(remaining.days) : "—"} />
          <Unit label="时" value={remaining ? pad(remaining.hours) : "--"} />
          <Unit label="分" value={remaining ? pad(remaining.minutes) : "--"} />
          <Unit label="秒" value={remaining ? pad(remaining.seconds) : "--"} />
        </div>
      )}
    </section>
  );
}

function Unit({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-1 py-2">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-[11px]">{label}</p>
    </div>
  );
}
