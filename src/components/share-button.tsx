"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { publicEnv } from "@/lib/env.public";

/**
 * 分享按钮：
 *   1. 优先 navigator.clipboard.writeText（需要安全上下文 HTTPS）；
 *   2. 失败时退回 textarea + document.execCommand("copy") 的老办法；
 *   3. 再失败就把文案显示出来让用户手动复制。
 * 朋友圈发链接即可玩，所以这里只复制文本 + 链接。
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 继续走兜底 */
    }
  }

  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ShareButton({
  className,
  label = "分享给朋友",
  variant = "outline",
  template,
}: {
  className?: string;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  template?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleShare() {
    const url =
      typeof window !== "undefined" ? window.location.origin : publicEnv.siteUrl;
    const text =
      template ??
      `我拼好了${publicEnv.nickname}的照片，你来试试：${url}`;
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2400);
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={handleShare}
      data-testid="share-button"
    >
      {state === "copied" ? (
        <Check className="size-4" />
      ) : (
        <Share2 className="size-4" />
      )}
      {state === "copied" ? "已复制，去粘贴吧" : state === "failed" ? "复制失败，请手动复制" : label}
    </Button>
  );
}
