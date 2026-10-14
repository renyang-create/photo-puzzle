"use client";

import { Volume2, VolumeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSoundEnabled } from "@/hooks/use-sound-enabled";
import { cn } from "@/lib/utils";

/**
 * 右上角喇叭开关：
 *   开启 → Volume2（喇叭 + 声波）
 *   关闭 → VolumeOff（喇叭 + 一斜杠）
 * 切换结果会写进 localStorage（photoPuzzle.soundEnabled），刷新后保持一致。
 *
 * 注意：浏览器的自动播放策略要求「先有用户交互」才能出声。
 * 所以即便开关是开着的，音乐也要等你点一下屏幕（或点开始挑战进入本页）才会真正响起。
 */
export function SoundToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useSoundEnabled();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "text-muted-foreground hover:text-foreground shrink-0 rounded-full border border-white/10 bg-white/[0.03]",
        className,
      )}
      onClick={toggle}
      aria-label={enabled ? "关闭声音（背景音乐与音效）" : "打开声音（背景音乐与音效）"}
      aria-pressed={!enabled}
      title={enabled ? "声音：开（点击关闭）" : "声音：关（点击打开）"}
      data-testid="sound-toggle"
      data-sound-enabled={enabled ? "true" : "false"}
    >
      {enabled ? (
        <Volume2 className="size-4" />
      ) : (
        <VolumeOff className="size-4" />
      )}
    </Button>
  );
}
