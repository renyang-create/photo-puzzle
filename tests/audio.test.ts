import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUDIO_SOURCES,
  COMPLETE_DUCK_MS,
  DEFAULT_BGM_VOLUME,
  DUCKED_BGM_VOLUME,
  SFX_DUCK_MS,
  bgmVolumeFor,
  fadeVolume,
  volumeAfterDuck,
} from "@/lib/audio";
import {
  parseSoundSnapshot,
  resolveSoundEnabled,
} from "@/lib/local-store";

describe("音频资源路径（仓库不含音频，只锁定路径契约）", () => {
  it("三个音频的引用路径固定为 /audio/*.mp3", () => {
    const expected: Array<[string, string]> = [
      ["bgm", "/audio/bgm.mp3"],
      ["press", "/audio/bubble-pop.mp3"],
      ["complete", "/audio/ding.mp3"],
    ];

    for (const [key, url] of expected) {
      expect(AUDIO_SOURCES[key as keyof typeof AUDIO_SOURCES]).toBe(url);
    }
  });

  /**
   * 音频**不是**仓库内容：原演示素材授权无法确证，已在开源前移除，
   * 使用者按同名放进 public/audio/ 即恢复声音（见 public/audio/README.md）。
   * 因此这里不能断言「文件必须存在」—— 那会让全新克隆的仓库测试直接变红。
   * 只在文件确实存在时校验一下「位置对、不是空文件」，防止误提交占位文件或放错目录。
   */
  it("音频为自备素材：缺席合法；若已放置则必须位于 public/audio/ 且非空", () => {
    for (const url of Object.values(AUDIO_SOURCES)) {
      const onDisk = join(process.cwd(), "public", url.replace(/^\//, ""));

      if (!existsSync(onDisk)) {
        continue;
      }

      expect(statSync(onDisk).size, `音频文件是空的：${onDisk}`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("音量策略（有音效时压低背景音乐）", () => {
  it("默认音量与压低音量都在 0..1 之间，且压低值明显更小", () => {
    expect(DEFAULT_BGM_VOLUME).toBeGreaterThan(0);
    expect(DEFAULT_BGM_VOLUME).toBeLessThanOrEqual(1);
    expect(DUCKED_BGM_VOLUME).toBeGreaterThan(0);
    expect(DUCKED_BGM_VOLUME).toBeLessThan(DEFAULT_BGM_VOLUME);
  });

  it("播音效时 BGM 变轻，音效结束后回到原音量", () => {
    const normal = bgmVolumeFor({ ducked: false, enabled: true });
    const ducked = bgmVolumeFor({ ducked: true, enabled: true });

    expect(normal).toBe(DEFAULT_BGM_VOLUME);
    expect(ducked).toBe(DUCKED_BGM_VOLUME);
    expect(volumeAfterDuck(true)).toBe(DEFAULT_BGM_VOLUME);
  });

  it("关掉声音后任何情况都是 0", () => {
    expect(bgmVolumeFor({ ducked: false, enabled: false })).toBe(0);
    expect(bgmVolumeFor({ ducked: true, enabled: false })).toBe(0);
    expect(volumeAfterDuck(false)).toBe(0);
  });

  it("完成音比普通音效压低得更久（「叮」还没结束不该让音乐冲上来）", () => {
    expect(COMPLETE_DUCK_MS).toBeGreaterThan(SFX_DUCK_MS);
  });
});

describe("fadeVolume 线性插值", () => {
  it("两端与中点都正确", () => {
    expect(fadeVolume(DEFAULT_BGM_VOLUME, DUCKED_BGM_VOLUME, 0)).toBe(
      DEFAULT_BGM_VOLUME,
    );
    expect(fadeVolume(DEFAULT_BGM_VOLUME, DUCKED_BGM_VOLUME, 1)).toBe(
      DUCKED_BGM_VOLUME,
    );
    expect(fadeVolume(0.35, 0.12, 0.5)).toBeCloseTo(0.235, 3);
  });

  it("progress 越界会被夹回 0..1", () => {
    expect(fadeVolume(0.4, 0.1, -3)).toBe(0.4);
    expect(fadeVolume(0.4, 0.1, 9)).toBe(0.1);
  });
});

describe("声音开关的持久化解析", () => {
  it("没有记录时默认开启", () => {
    expect(resolveSoundEnabled(null)).toBe(true);
    expect(resolveSoundEnabled(undefined)).toBe(true);
    expect(resolveSoundEnabled("")).toBe(true);
  });

  it("识别开 / 关两种写法", () => {
    expect(resolveSoundEnabled("1")).toBe(true);
    expect(resolveSoundEnabled("0")).toBe(false);
    expect(resolveSoundEnabled("false")).toBe(false);
  });

  it("快照字符串与布尔值互转（服务端快照 null 视为开）", () => {
    expect(parseSoundSnapshot(null)).toBe(true);
    expect(parseSoundSnapshot("1")).toBe(true);
    expect(parseSoundSnapshot("0")).toBe(false);
  });
});
