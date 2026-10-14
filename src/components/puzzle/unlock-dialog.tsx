"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, Trophy } from "lucide-react";

import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publicEnv } from "@/lib/env.public";
import { formatMilliseconds, type Difficulty } from "@/lib/puzzle";

export interface UnlockSummary {
  photoId: string;
  title: string;
  difficulty: Difficulty;
  timeMs: number;
  bestTimeMs: number;
  isNewRecord: boolean;
  unlockText: string;
  fullImageUrl: string | null;
}

export function UnlockDialog({
  open,
  summary,
  onOpenChange,
  onReplay,
}: {
  open: boolean;
  summary: UnlockSummary | null;
  onOpenChange: (open: boolean) => void;
  onReplay: () => void;
}) {
  const router = useRouter();

  if (!summary) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] sm:max-w-md" data-testid="unlock-dialog">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">解锁成功</DialogTitle>
          <DialogDescription className="text-center">
            「{summary.title}」已加入你的相册
          </DialogDescription>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="overflow-hidden rounded-xl border border-white/10 bg-black/40"
        >
          {summary.fullImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 5 分钟签名的私有资源，next/image 会缓存过期链接
            <img
              src={summary.fullImageUrl}
              alt={summary.title}
              className="max-h-[46vh] w-full object-contain"
            />
          ) : (
            <div className="text-muted-foreground p-8 text-center text-sm">
              图片链接生成中…
            </div>
          )}
        </motion.div>

        <p className="text-center text-base font-medium text-violet-200">
          {summary.unlockText}
        </p>

        <div className="text-muted-foreground flex items-center justify-center gap-6 text-sm">
          <span className="flex items-center gap-1.5">
            <Clock className="size-4" />
            用时 {formatMilliseconds(summary.timeMs)}
          </span>
          <span className="flex items-center gap-1.5">
            <Trophy className="size-4" />
            最佳 {formatMilliseconds(summary.bestTimeMs)}
            {summary.isNewRecord && " 🎉"}
          </span>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={onReplay} className="w-full" data-testid="replay-button">
            再玩一次
          </Button>
          <div className="flex w-full gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => router.push("/gallery")}
            >
              去相册看看
            </Button>
            <ShareButton
              className="flex-1"
              label="分享"
              template={`我拼好了${publicEnv.nickname}的照片，用时 ${(summary.timeMs / 1000).toFixed(1)} 秒，你来试试：`}
            />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
