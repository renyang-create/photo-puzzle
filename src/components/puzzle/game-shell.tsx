"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Shuffle } from "lucide-react";
import { toast } from "sonner";

import { DifficultyPicker } from "@/components/puzzle/difficulty-picker";
import { PuzzleBoard } from "@/components/puzzle/puzzle-board";
import { SoundToggle } from "@/components/sound-toggle";
import {
  UnlockDialog,
  type UnlockSummary,
} from "@/components/puzzle/unlock-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useLocalProgress } from "@/hooks/use-local-progress";
import { audio } from "@/lib/audio";
import { apiGet, apiPost } from "@/lib/client-api";
import {
  applyUnlock,
  readProgress,
  readSoundEnabled,
  writeProgress,
} from "@/lib/local-store";
import { DEFAULT_DIFFICULTY, formatMilliseconds, type Difficulty } from "@/lib/puzzle";
import { cn } from "@/lib/utils";
import type { PlayablePhoto, UnlockResult } from "@/lib/types";

/**
 * 一局的完整编排：
 *   抽照片（GET /api/photos/random）→ 选难度 → 拼图 → 完成后
 *   ① 写 localStorage ② POST /api/unlocks ③ 再凭「已解锁」拿一次大图 signed URL
 *
 * 步骤 ③ 的顺序很关键：/api/photos/[id]/url?size=full 只对「确实解锁过」的会话签发，
 * 所以必须先落库 —— 不发解锁请求就永远拿不到原图链接。
 *
 * 难度取自本机进度（photoPuzzle.lastDifficulty），用 useSyncExternalStore 订阅，
 * 不在 effect 里同步 setState。
 */
export function GameShell() {
  const progress = useLocalProgress();
  const [difficultyOverride, setDifficultyOverride] = useState<Difficulty | null>(
    null,
  );
  const difficulty =
    difficultyOverride ?? progress?.lastDifficulty ?? DEFAULT_DIFFICULTY;

  const [photo, setPhoto] = useState<PlayablePhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<UnlockSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestSeq = useRef(0);

  const fetchPhoto = useCallback(async () => {
    const data = await apiGet<{ photo: PlayablePhoto }>("/api/photos/random");
    return data.photo;
  }, []);

  /** 事件处理里调用：同步 setLoading 是允许的 */
  const loadPhoto = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setBusy(true);
    setLoading(true);
    setError(null);
    setDialogOpen(false);
    try {
      const next = await fetchPhoto();
      if (requestSeq.current !== seq) return;
      setPhoto(next);
      setElapsed(0);
      setRound((value) => value + 1);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setPhoto(null);
      setError(err instanceof Error ? err.message : "抽照片失败");
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [fetchPhoto]);

  /** 首次进入：所有 setState 都发生在 await 之后，避免级联渲染 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await fetchPhoto();
        if (!alive) return;
        setPhoto(next);
        setRound((value) => value + 1);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "抽照片失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchPhoto]);

  /**
   * 音频生命周期：
   *   进入拼图页 → 把 localStorage 里的开关同步给音频管理器，并尝试起播 BGM
   *   （被浏览器自动播放策略拦截时，音频管理器会挂一次性 pointerdown/keydown，等你碰屏幕再起播）
   *   离开页面 → 暂停并复位，避免路由切换后残留播放
   */
  useEffect(() => {
    audio.setEnabled(readSoundEnabled());
    audio.enterGame();
    return () => audio.exitGame();
  }, []);

  const handleDifficulty = useCallback((next: Difficulty) => {
    setDifficultyOverride(next);
    setDialogOpen(false);
    setRound((value) => value + 1); // 只重新打乱，不换照片
    setElapsed(0);
    writeProgress({ ...readProgress(), lastDifficulty: next });
  }, []);

  const handleReplay = useCallback(() => {
    setDialogOpen(false);
    setRound((value) => value + 1); // 同一张图重来一局
    setElapsed(0);
  }, []);

  const handleSolved = useCallback(
    async (elapsedMs: number) => {
      if (!photo) return;
      const timeMs = Math.max(1, Math.round(elapsedMs));

      // ① 本地记录（仅本机体验；deviceId 不是可信身份）
      const outcome = applyUnlock(readProgress(), {
        photoId: photo.id,
        timeMs,
        difficulty,
      });
      writeProgress({ ...outcome.next, lastDifficulty: difficulty });

      // ② 服务端记录（统计口径 + 未来跨设备合并）
      let bestTimeMs = timeMs;
      let unlockText = "拼好啦，这张归你了";
      let isNewRecord = outcome.isNewRecord;
      try {
        const result = await apiPost<UnlockResult>("/api/unlocks", {
          photoId: photo.id,
          difficulty,
          timeMs,
        });
        bestTimeMs = result.bestTimeMs;
        unlockText = result.unlockText;
        isNewRecord = result.isNewRecord;
      } catch {
        toast.error("解锁记录没能同步到服务器，本机进度已保存");
      }

      // ③ 落库之后，服务端才愿意签发大图链接
      let fullImageUrl: string | null = null;
      try {
        const result = await apiGet<{ url: string }>(
          `/api/photos/${photo.id}/url?size=full`,
        );
        fullImageUrl = result.url;
      } catch {
        /* 拿不到就只显示文案，不影响解锁流程 */
      }

      setSummary({
        photoId: photo.id,
        title: photo.title,
        difficulty,
        timeMs,
        bestTimeMs,
        isNewRecord,
        unlockText,
        fullImageUrl,
      });
      setDialogOpen(true);
    },
    [difficulty, photo],
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6 pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            photo puzzle
          </p>
          <h1 className="truncate text-lg font-semibold">
            {photo ? photo.title : "准备中…"}
          </h1>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right">
            <p
              className="font-mono text-2xl font-semibold tabular-nums"
              data-testid="timer"
            >
              {formatMilliseconds(elapsed)}
            </p>
            <p className="text-muted-foreground text-[11px]">
              已解锁 {progress?.unlocked.length ?? 0} 张 · 累计{" "}
              {progress?.total ?? 0} 次
            </p>
          </div>
          {/* 右上角喇叭：开着是喇叭，关掉是喇叭加一斜杠 */}
          <SoundToggle />
        </div>
      </header>

      <DifficultyPicker
        value={difficulty}
        onChange={handleDifficulty}
        disabled={loading}
      />

      {loading && (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="size-6 animate-spin" />
          正在挑一张照片…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-sm">{error}</p>
          <p className="text-muted-foreground mt-2 text-xs">
            照片池为空时，请先用管理员身份上传几张照片。
          </p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => void loadPhoto()}
          >
            再试一次
          </Button>
        </div>
      )}

      {!loading && photo && (
        <PuzzleBoard
          // key 变化 → 重挂载 → 内部状态天然重置（不需要在 effect 里 setState）
          key={`${photo.id}-${difficulty}-${round}`}
          imageUrl={photo.imageUrl}
          difficulty={difficulty}
          onTick={setElapsed}
          onSolved={(ms) => void handleSolved(ms)}
          paused={dialogOpen}
        />
      )}

      <div className="flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void loadPhoto()}
        >
          <RefreshCw className="size-4" />
          换一张
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !photo}
          onClick={handleReplay}
        >
          <Shuffle className="size-4" />
          重新打乱
        </Button>
        <Link
          href="/gallery"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          我的相册
        </Link>
      </div>

      <UnlockDialog
        open={dialogOpen}
        summary={summary}
        onOpenChange={setDialogOpen}
        onReplay={handleReplay}
      />
    </div>
  );
}
