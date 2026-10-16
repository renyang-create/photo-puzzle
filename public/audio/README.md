# public/audio · 音频占位目录

本仓库**不包含任何音频文件**：原先的演示素材（背景音乐 + 两个音效）来源授权无法确证，
已在开源前移除，来源记录保留在根目录 [`ATTRIBUTIONS.md`](../../ATTRIBUTIONS.md)。

代码里引用的是下面三个相对路径 —— 把你的音频按同名放进来，声音就回来了：

| 期望文件名 | 用途 | 代码位置 |
| --- | --- | --- |
| `bgm.mp3` | 背景音乐（循环） | `src/lib/audio.ts` → `AUDIO_SOURCES.bgm` |
| `bubble-pop.mp3` | 按下 / 松开拼图块的泡泡音 | `AUDIO_SOURCES.press` |
| `ding.mp3` | 拼图完成时的「叮」 | `AUDIO_SOURCES.complete` |

* **缺文件不会报错**：`src/lib/audio.ts` 对 `play()` 的失败做了 catch，
  游戏照常可玩，只是没有声音；`bubble-pop.mp3` 与 `ding.mp3` 缺失时也不会影响计时与判定。
* 想换文件名也可以，改 `AUDIO_SOURCES` 里的路径即可（音量常量都在同一个文件里）。
* `public/audio/*.mp3` 等已在 `.gitignore` 中 —— 你自己的音频不会被误提交；
  如果你希望把它一起分发，删掉 `.gitignore` 里那几行即可。
