# 开源引用清单

本项目采取「**集成 + 改造 + 部署**」的策略：拼图核心、上传链路、后台组件、OG 卡片都优先复用宽松协议的开源实现或官方示例，只做必要的改写与二次设计。
下面逐条列出引用的项目、作者、协议、用途与**具体修改点**。所有引用项目均保留原 LICENSE（依赖随 `pnpm-lock.yaml` 锁定，源码级参考在文件头注释中标注）。

---

## A. 源码级参考 / 抽取代码

### 1. usecodelee/Vue-auto-Puzzle
* 作者：usecodelee
* 协议：MIT
* 地址：https://github.com/usecodelee/Vue-auto-Puzzle
* 用途：拼图的**打乱算法（Fisher-Yates）**思路。
* 修改点：
  * 从 Vue 组件内的方法改写为**纯函数** `shuffle(input, random)`（`src/lib/puzzle.ts`），可注入随机源；
  * 新增「结果必须不是已完成状态、且至少打乱 60%」的不变量约束 `createShuffledOrder()`；
  * 数据结构由二维数组改为**一维 `order` 数组**（`order[slot] = pieceId`），使 React 侧可以直接用 transform 动画复用同一份状态；
  * 增加确定性随机源 `mulberry32()`，让测试与 OG 装饰网格可复现。

### 2. TranHuuDat2004/games_tools
* 作者：TranHuuDat2004
* 协议：MIT
* 地址：https://github.com/TranHuuDat2004/games_tools
* 用途：图片**网格切片 / 拼图块定位**的实现思路（square crop、grid splitter）。
* 修改点：
  * 由「切图生成新图片」改为**纯 CSS 方案**：容器正方形 + `background-size: (n*100)%` + `background-position`，等价 `object-fit: cover` 的正方形裁剪，不产生额外图片、不变形；
  * 交互由鼠标事件改为 **Pointer Events**（`setPointerCapture` + `touch-action: none`），点击两块交换为主、拖拽为辅；
  * 增加 44px 最小触控区约束与 CSS 表达式兜底。

### 3. vercel/next.js · examples/with-supabase
* 作者：Vercel, Inc.
* 协议：MIT
* 地址：https://github.com/vercel/next.js/tree/canary/examples/with-supabase
* 用途：`@supabase/ssr` 在 App Router 下的 **Server / Browser / Middleware 三端客户端**模式。
* 修改点：
  * `createServerClient` 的 `getAll/setAll` cookie 适配保留，但只用于「管理员 Supabase Auth 登录 + session 刷新」；
  * 在 middleware 中**额外签发 HttpOnly 匿名 session cookie**（`pp_anon`，jose HS256，用 `SESSION_PASSWORD` 签名），它不是认证凭证，只做解锁统计维度；
  * 增加 `server-only` 保护的服务端客户端与 service_role 客户端分离（`src/lib/supabase/{server,admin}.ts`）。

### 4. supabase/supabase · examples/storage/resumable-upload-signed-uppy
* 作者：Supabase, Inc.
* 协议：Apache-2.0
* 地址：https://github.com/supabase/supabase/tree/master/examples/storage/resumable-upload-signed-uppy
* 用途：**预签名上传**（先申请令牌、再让浏览器直传）的链路设计。
* 修改点：
  * 不引入 Uppy/TUS：改用 `createSignedUploadUrl()` + `uploadToSignedUrl()`（Supabase 侧令牌 2 小时有效），并刻意**不锁死**具体方法名，README 中写明 TUS / S3 presigned PUT 的替代路径；
  * 上传路径改为随机 `uuid/raw.<ext>`，服务端用正则白名单校验（拒绝 `../`、绝对路径、非 `raw.*` 的路径），避免「任意对象读取/覆盖」；
  * 上传后由服务端用 sharp 归一化并产出多尺寸，而不是直接使用原图。

### 5. vercel/og-image 与 next/og 官方文档
* 作者：Vercel, Inc.
* 协议：MIT
* 地址：https://github.com/vercel/og-image · https://nextjs.org/docs/app/api-reference/functions/image-response
* 用途：`ImageResponse` 动态分享卡片。
* 修改点：
  * 模板**完全固定**，路由只接受一个 `photoId`，不接受任何用户可控文本；
  * 声明 `runtime = "nodejs"` 并加固 CVE-2026-94545 相关防护：所有字符串过 `sanitizeOgText()` 白名单化 + 长度截断；
  * 卡片内**不出现照片**（bucket 私有），只渲染文字与由 `photoId` 派生的装饰网格；
  * 增加可选中文字体（TTF/OTF/WOFF）加载与失败退化逻辑。

### 6. shadcn-ui/ui
* 作者：shadcn 及贡献者
* 协议：MIT
* 地址：https://github.com/shadcn-ui/ui
* 用途：UI 组件（button / card / dialog / input / label / badge / sonner / progress / alert / separator / skeleton）。
* 修改点：通过官方 CLI 生成到 `src/components/ui/`，**未改动组件源码**（便于日后 `shadcn add --overwrite` 升级）；业务层的改动都在 `src/components/puzzle|gallery|admin` 中完成，并统一换成「暗色 + 紫青渐变」的个人风格。

---

## A2. 音频素材（非软件依赖，但同样需要标注来源）

| 用途 | 文件 | 原标题（来源） | 说明 |
| --- | --- | --- | --- |
| 背景音乐（循环） | `public/audio/bgm.mp3` | `alex-morgan-no-copyright-music-1015` | 作者标注为 Alex Morgan，文件名自带 "no copyright music" |
| 按住 / 松开音效 | `public/audio/bubble-pop.mp3` | `linhmitto-bubblepop-254773` | 作者标注为 linhmitto（泡泡音） |
| 拼图完成音效 | `public/audio/ding.mp3` | `freesound_community-ding-36029` | 来自 freesound 社区素材（叮声） |

* 这三段音频由使用者（本项目作者）自行选择并提供，均取自标注为「无版权 / 免费素材」的渠道。
* **请自行再核对一次授权条款**：免费素材通常仍要求署名或限制商用，本项目默认仅个人使用；
  若你要公开分发或商用，请到原始素材页确认许可，并把署名要求补到本文件。
* 本项目对音频仅做**使用**（播放），未修改原始音轨；播放策略（循环、压低、静音开关）全部在
  `src/lib/audio.ts` 中实现。

---

## B. 直接依赖（运行时）

| 依赖 | 作者/组织 | 协议 | 用途 |
| --- | --- | --- | --- |
| next | Vercel, Inc. | MIT | 全栈框架（App Router、Route Handler、middleware） |
| react / react-dom | Meta | MIT | UI 运行时 |
| @supabase/supabase-js | Supabase, Inc. | MIT | Postgres / Auth / Storage 客户端 |
| @supabase/ssr | Supabase, Inc. | MIT | SSR cookie 适配 |
| sharp | Lovell Fuller 及贡献者 | Apache-2.0 | 服务端图片归一化、EXIF 清理、多尺寸缩略图 |
| framer-motion | Matt Perry (Motion) | MIT | 拼图块交换 / 打乱下落 / 完成发光动画 |
| jose | Filip Skokan | MIT | 匿名与管理员 session cookie 的 HS256 签名 |
| bcryptjs | Daniel Wirtz 及贡献者 | MIT | 自建管理员密码哈希与比对（cost 12） |
| zod | Colin McDonnell | MIT | 请求体 / 路径 / MIME 校验 |
| tailwindcss | Tailwind Labs | MIT | 样式 |
| lucide-react | Lucide 贡献者 | ISC | 图标 |
| sonner | Emil Kowalski | MIT | Toast |
| class-variance-authority / clsx / tailwind-merge | 各自作者 | MIT | 类名组合 |

## C. 直接依赖（开发期）

| 依赖 | 作者/组织 | 协议 | 用途 |
| --- | --- | --- | --- |
| vitest | Anthony Fu 及贡献者 | MIT | 单元测试 |
| @playwright/test | Microsoft Corporation | Apache-2.0 | 移动端端到端测试 |
| typescript / eslint / eslint-config-next | Microsoft / OpenJS / Vercel | Apache-2.0 / MIT | 类型与静态检查 |

---

## D. 明确「没有复用」的东西

* **没有**从任何项目照搬完整成品：拼图界面、封面、相册墙、后台、文案全部为本项目重写。
* **没有**引入 Drizzle / Prisma：数据层按需求使用 `@supabase/ssr` + `supabase-js` + Route Handler。
* **没有**使用 GPL / AGPL 项目（例如 star 数较高的 `yuri-becker/react-jigsaw-puzzle` 是 GPL-3.0，已排除；同类 MIT/Apache 项目才进入候选）。

许可证文本随 npm 依赖一起分发（`node_modules/<pkg>/LICENSE`）。若你二次分发本项目，请保留本文件与各依赖的许可证。
