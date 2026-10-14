"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGet } from "@/lib/client-api";
import { formatMilliseconds } from "@/lib/puzzle";
import type { GalleryItem } from "@/lib/types";

/**
 * 相册墙。
 *   已解锁 → 服务端给 5 分钟 signed URL 的清晰缩略图，点开可看大图；
 *   未解锁 → 服务端不返回任何图片信息，只能渲染一个模糊占位块 + 锁图标。
 *   （这就是「扒接口也拿不到锁着的照片」的实现方式。）
 */
export function GalleryWall() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{
    open: boolean;
    title: string;
    url: string;
  }>({ open: false, title: "", url: "" });

  const fetchItems = useCallback(async () => {
    const data = await apiGet<{ items: GalleryItem[] }>("/api/gallery");
    return data.items;
  }, []);

  /** 事件处理里调用（同步 setLoading 在事件处理中是允许的） */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchItems());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取相册失败");
    } finally {
      setLoading(false);
    }
  }, [fetchItems]);

  /** 挂载后拉取：setState 都在 await 之后，避免 effect 内同步 setState 的级联渲染 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await fetchItems();
        if (alive) setItems(next);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "读取相册失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchItems]);

  /** 大图要重新签一次：缩略图链接可能已经过期（TTL 5 分钟） */
  const openFull = useCallback(async (item: GalleryItem) => {
    if (!item.unlocked) return;
    try {
      const fresh = await apiGet<{ url: string }>(
        `/api/photos/${item.id}/url?size=full`,
      );
      setViewer({ open: true, title: item.title, url: fresh.url });
    } catch {
      setViewer({ open: true, title: item.title, url: item.fullUrl });
    }
  }, []);

  const unlockedCount = items.filter((item) => item.unlocked).length;

  if (loading) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-3 py-24">
        <Loader2 className="size-5 animate-spin" />
        正在打开相册…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm">{error}</p>
        <Button variant="secondary" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center text-sm">
        <Sparkles className="size-6" />
        相册还是空的：等主人上传照片，或者你先去玩两局。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        已解锁 {unlockedCount} / {items.length} 张
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void openFull(item)}
            disabled={!item.unlocked}
            data-testid={item.unlocked ? `gallery-unlocked-${item.id}` : `gallery-locked-${item.id}`}
            className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
          >
            {item.unlocked ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- 5 分钟签名的私有资源，next/image 优化器会缓存过期链接 */}
                <img
                  src={item.thumbUrl}
                  alt={item.title}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left text-[11px] text-white/90">
                  {item.title} · {formatMilliseconds(item.bestTimeMs)}
                </span>
              </>
            ) : (
              <>
                <span className="absolute inset-0 bg-[conic-gradient(at_30%_20%,rgba(167,139,250,0.35),rgba(56,189,248,0.25),rgba(167,139,250,0.35))] blur-md" />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/75">
                  <Lock className="size-5" />
                  <span className="text-[11px]">未解锁</span>
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      <Dialog
        open={viewer.open}
        onOpenChange={(open) => setViewer((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-[94vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewer.title}</DialogTitle>
            <DialogDescription>链接有效期 5 分钟，过期后重新打开即可</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- 同上：短期签名链接不适合走图片优化器 */}
          <img
            src={viewer.url}
            alt={viewer.title}
            className="max-h-[70vh] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
