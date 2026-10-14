import { existsSync } from "node:fs";
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

describe("音频资源路径（public/audio 必须真实存在）", () => {
  it("三个 mp3 都在 public 目录下", () => {
    const expected: Array<[string, string]> = [
      ["bgm", "/audio/bgm.mp3"],
      ["press", "/audio/bubble-pop.mp3"],
      ["complete", "/audio/ding.mp3"],
    ];

    for (const [key, url] of expected) {
      expect(AUDIO_SOURCES[key as keyof typeof AUDIO_SOURCES]).toBe(url);
      const onDisk = join(process.cwd(), "public", url.replace(/^\//, ""));
      expect(existsSync(onDisk), `缺少音频文件：${onDisk}`).toBe(true);
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
