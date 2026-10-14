# photo-puzzle · 照片拼图解锁

一个「专属个人游戏」形态的移动端 H5 拼图相册：把照片切成拼图，**拼好才看得到原图**。
朋友圈发一条链接就能玩，不用下载、不用注册。照片不落在公开直链上，全部走私有 bucket + 服务端短期签名链接。

* 拼图载体：Next.js App Router + TypeScript + Tailwind CSS v4 + shadcn/ui + framer-motion
* 数据与存储：Supabase（Postgres + Auth + Storage），数据层用 `@supabase/ssr` + `supabase-js` + Server/Route Handler，不引入 ORM
* 图片处理：浏览器端 canvas 压缩（丢 EXIF/GPS）+ 服务端 sharp 归一化与多尺寸
* 分享卡片：`next/og` 的 `ImageResponse` 动态生成，Node.js runtime，固定模板
* 测试：Vitest（关键流程）+ Playwright（移动端主链路，可选）
* 部署：Vercel + Supabase

---

## 0. 安全与版本核实（先读这一段）

### CVE-2026-94545（CVSS 9.5，已确认属实）

| 项目 | 说明 |
| --- | --- |
| 影响 | `next/og` 的 `ImageResponse`（Node.js runtime）。上游 **Satori** 未正确转义 SVG 中的攻击者可控值，可导致**未授权 RCE** |
| 受影响版本 | Next.js **16.2.0 – 16.3.5**；Satori **0.0.27 – 0.33.4** |
| 修复版本 | Next.js **16.3.6+**（Active LTS）或 **15.5.26**（Maintenance LTS，仅加固；15.x 本身不受该 RCE 影响）；Satori **0.33.5+** |
| 攻击链 | 依赖 **Node.js runtime + sharp** 把恶意 SVG 转成 PNG。Edge runtime 或 `resvg-wasm` 沙箱可阻断这条链 |

**本项目的实际情况（安装后请自行复核）**

* `next`：**16.4.0**（>= 16.3.6 修复线）
* Satori：由 Next.js 内置，随 16.4.0 一起被带上来（>= 0.33.5）
* `sharp`：**0.35.5**（Node.js runtime 使用）

复核命令：

```bash
pnpm list next sharp
pnpm why satori
pnpm audit --audit-level=moderate
```

如果 `pnpm install` 之后版本低于安全线，**必须显式升级，不能跳过**。

### 已知依赖告警（已评估，非忽略）

`pnpm audit` 唯一会报的是 **braces**（`GHSA-vfj7-8cjw-p6xm`，深度嵌套 glob 导致栈耗尽 DoS）：

* 依赖路径：`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`
* 全部在 **devDependencies**，不会进入生产构建产物，也不接触任何不可信输入；
* 该 advisory 目前标记 `Patched versions: <0.0.0`（上游尚未发布修复版本）；
* 因此我们在 `package.json` 的 `pnpm.auditConfig.ignoreGhsas` 里显式登记了它，并在此说明。
  **一旦上游发布修复版本，请升级后删掉这条 ignore。**

### 我们做的四层防护（不只是「升个版本」）

1. **OG 路由声明 `runtime = "nodejs"` + 固定模板**：模板里没有任何用户可控的 HTML；路由只接受一个参数 `photoId`，不接受原始文本/自由 query。
2. **文本白名单化**：所有进入 Satori 的字符串（包括来自数据库的 `title`、环境变量里的昵称）都过一遍 `sanitizeOgText()`，剔除 `< > & " ' \`` \\` 与控制字符并截断。即使未来 Satori 再出转义缺陷，也不存在可闭合标签的输入。
3. **OG 卡片里根本不出现照片**：bucket 是私有的，卡片只有文字 + 装饰网格，因此 DDL 图也不可能泄漏原图。
4. **`sharp` 只在 Node.js runtime 的 Route Handler 使用**（`/api/admin/photos`），不放 Edge，也不会出现 `Could not load the "sharp" module using the linux-x64 runtime`；若 Vercel 上遇到预编译二进制 ABI 不兼容，可把 sharp 降到已知稳定的 **0.32.x** 分支。

---

## 1. 快速开始（本地）

```bash
# 1) 依赖
pnpm install

# 2) 环境变量
cp .env.example .env.local     # Windows: copy .env.example .env.local
# 至少填这四项：NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
#              SUPABASE_SERVICE_ROLE_KEY / SESSION_PASSWORD

# 3) 应用数据库变更（建表 + RLS + storage policy + 私有 bucket）
supabase link --project-ref <your-project-ref>
supabase db push

# 4) 起服务
pnpm dev            # http://localhost:3000
```

其他脚本：

```bash
pnpm build          # 生产构建
pnpm start          # 运行生产构建
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest 关键流程测试
pnpm test:e2e       # Playwright（需 pnpm exec playwright install chromium）
```

> 没配 Supabase 时首页不会崩：会显示一张「还没接上 Supabase」的配置提示卡片。

### 1.1 用手机访问本机服务（开发调试）

Next.js 从 15.3 起会在 dev 下拦截**非 localhost 来源**对前端资源（`/_next/*`）的请求。
症状很有辨识度：手机用 `http://192.168.x.x:3000` 打开页面**能拿到 HTML，但所有 JS 都是 403**，
页面会永久停在服务端渲染出来的加载文案上（例如后台页面的「正在校验管理员身份…」），
而同一台电脑用 `localhost` 打开却完全正常。

本项目已在 `next.config.ts` 里配置 `allowedDevOrigins`：**自动把本机所有非回环 IPv4 地址**
（局域网 IP、手机热点网段、Windows 移动热点）加进白名单，所以换网络后不用回来改配置。
需要额外域名时用环境变量补充：

```bash
DEV_ALLOWED_ORIGINS="my-lan.dev,*.my-lan.dev"   # 逗号分隔，支持子域通配
```

找到本机 IP 并用手机访问后台：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress, InterfaceAlias
# 假设得到 192.168.1.5，则手机浏览器打开：
#   http://192.168.1.5:3000/admin
```

注意两点：手机与电脑要在**同一个局域网**（校园网/公司网常开「设备隔离」，这时改用电脑开热点）；
该配置**只影响开发模式**，生产环境（Vercel）不受影响。

---

## 2. 环境变量

| 变量 | 作用 | 暴露范围 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 浏览器（公开） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key，权限完全由 RLS/Storage policy 决定 | 浏览器（公开） |
| `SUPABASE_SERVICE_ROLE_KEY` | 签发 signed URL、写 `unlocks`、sharp 处理、管理端写入 | **仅服务端**，绝不可加 `NEXT_PUBLIC_` 前缀 |
| `SUPABASE_PHOTOS_BUCKET` | 私有 bucket 名，默认 `photos` | 服务端 |
| `SESSION_PASSWORD` | 匿名 session / 管理员 session cookie 的 HMAC 签名密钥（>= 32 字符） | 仅服务端 |
| `ADMIN_SETUP_TOKEN` | 首次部署初始化管理员密码用的一次性令牌，完成初始化后可从环境变量里移除 | 仅服务端 |
| `ADMIN_EMAILS` | 可选的 Supabase Auth 管理员邮箱白名单（逗号分隔） | 仅服务端 |
| `NEXT_PUBLIC_SITE_NAME` / `NEXT_PUBLIC_HOST_NICKNAME` / `NEXT_PUBLIC_SITE_URL` | 封面与 OG 卡片文案 | 浏览器（公开） |
| `OG_FONT_URL` | 可选：OG 卡片用的中文字体（TTF/OTF/WOFF，**不支持 woff2**） | 仅服务端 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 进程内限流参数，默认 60s / 60 次 | 仅服务端 |

> **关于密钥名称**：Supabase 正在把 `anon` / `service_role`（JWT，`eyJ` 开头）换成
> `publishable`（`sb_publishable_`）/ `secret`（`sb_secret_`）两套并存的新密钥，入口统一在
> **Settings → API Keys**（已没有单独的 Settings → API 页面）。本项目两套名字都认：
> 公开侧可填 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 或 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；
> 服务端侧可填 `SUPABASE_SERVICE_ROLE_KEY` 或 `SUPABASE_SECRET_KEY`。

`src/lib/env.server.ts` 顶部有 `import "server-only"`：一旦它被客户端组件引用，**构建会直接失败**，从机制上防止 service role key 泄漏。
生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 3. Supabase 初始化

```
supabase/migrations/
├─ 20261014000000_init.sql              # 建表 + 索引 + RLS + 私有 bucket + is_admin()
├─ 20261014000100_storage_policies.sql  # storage.objects 的 policy（只含 CREATE POLICY）
└─ 20261014000200_seed.sql              # 随机生成初始管理员密码（只打印一次）
```

### 3.1 注意 `storage.objects` 的权限坑

在 Supabase 托管项目里，`storage.objects` 的 owner 是 `supabase_storage_admin`，
`postgres` 角色**不能**对它执行 `ALTER TABLE` 或 `ENABLE/DISABLE ROW LEVEL SECURITY`。
所以 `20261014000100_storage_policies.sql` 里**只有 `CREATE POLICY` 语句**，这样 `supabase db push` 才能干净应用。

### 3.2 数据模型

| 表 | 用途 | 关键列 |
| --- | --- | --- |
| `photos` | 照片元数据 | `id, storage_path, thumb_path, raw_path, title, unlock_text, is_active, sort_order, width, height, created_at` |
| `unlocks` | 解锁记录（按匿名会话去重） | `id, photo_id, anon_session_id, best_time_ms, difficulty, created_at`，唯一键 `(photo_id, anon_session_id, difficulty)` |
| `admin_users` | Supabase Auth 管理员邮箱白名单 | `email` |
| `admin_credentials` | 自建密码的 bcrypt 哈希（单行） | `password_hash` |
| `admin_audit_log` | 管理操作审计 | `action, target_id, detail, actor` |

### 3.3 RLS 策略一览

| 表 | anon | authenticated |
| --- | --- | --- |
| `photos` | 只能 `SELECT` `is_active = true` 的元数据 | 仅 `public.is_admin()` 为真时可读写 |
| `unlocks` | 无任何策略（服务端用 service_role 写入） | 仅管理员可读 |
| `admin_credentials` / `admin_users` | 无策略（默认全拒） | 无策略，服务端 + `security definer` 函数访问 |
| `admin_audit_log` | 无策略 | 仅管理员可读 |
| `storage.objects` | **无策略** → 既不能 list 也不能 download | 需满足 `public.is_admin()` 才能读写 |

`public.is_admin()` 是 `security definer` 的 SQL 函数，只返回 boolean，并且 `revoke` 了 `public` 的 execute 权限、只授给 `authenticated`。

---

## 4. 管理员入口与密码

* **隐藏入口**：封面页标题**连续点击 5 次**进入 `/admin`（也可以直接访问 `/admin`）。
  这只是彩蛋，不是安全边界 —— 所有能力都在服务端二次鉴权。
* **首次部署初始化（自建密码）**：

  1. 在 `.env.local` / Vercel 里设置 `ADMIN_SETUP_TOKEN`（一串随机值）；
  2. 打开 `/admin`，表单会自动变成「初始化」模式：填入初始化令牌 + 你想要的强密码；
  3. 服务端比对令牌后，用 **bcrypt（cost 12）** 存哈希到 `admin_credentials`，数据库里没有明文；
  4. 成功后请把 `ADMIN_SETUP_TOKEN` 从环境变量里删掉，并在 `/admin` 里改一次密码。

  也可以直接执行 `seed.sql`：它会**随机生成**一个初始密码并通过 `RAISE NOTICE` 只打印一次。

* **Supabase Auth（推荐）**：

  1. Supabase 控制台创建用户；
  2. `insert into public.admin_users (email, note) values ('you@example.com', 'owner');`
     或把它写进 `ADMIN_EMAILS`；
  3. `/admin` 里点「改用 Supabase Auth 邮箱登录」。

* **默认口令说明**：仓库里**不存在** `admin123` 之类的默认密码。密码哈希只能由服务端生成，比对也只在服务端发生。

---

## 5. 照片池：新增 / 管理照片

1. 用管理员登录 `/admin`；
2. 选择照片、填标题与「解锁文案」（这句文案**只有拼好之后**才会返回给浏览器）；
3. 点「上传并发布」，内部链路是：

```
浏览器 canvas 压缩(>10MB 或非 JPEG/WebP/AVIF → 长边 ≤2000px, JPEG 0.8)
   → POST /api/admin/photos/upload-url   服务端签发一次性上传令牌（Supabase 侧 2 小时有效）
   → uploadToSignedUrl 直传私有 bucket   路径 <uuid>/raw.<ext>，随机不可枚举
   → POST /api/admin/photos              服务端下载原图 → sharp 归一化（EXIF 方向摆正、
                                         长边 2000、清空元数据）→ 生成 800px 缩略图
                                         → 写 <uuid>/full.jpg 与 <uuid>/thumb.jpg → 插库
```

4. 列表里可以**上下架 / 改文案 / 删除**（删除会同时清掉 Storage 里的对象）。
5. 朋友端刷新 `/play` 就能随机抽到它。

> **照片列表永远来自数据库/API**。浏览器不可能扫描服务器目录，本项目也不把照片硬编码进仓库。

> 单文件上限：Supabase 免费计划全局 50MB；标准上传对 > 6MB 的文件官方建议 TUS 可恢复上传；
> 因此本项目直接把「> 10MB 先压缩」写进流程，服务端还会再兜底拒绝 > 15MB 的处理请求。

---

## 6. API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/photos/random?difficulty=3` | 随机抽一张「当前匿名会话还没解锁过」的照片（全解锁则随机任意）。只返回缩略图签名链接 + 标题 |
| GET | `/api/photos/[id]/url?size=thumb\|full` | 签发 5 分钟 signed URL。`size=full` **要求该会话确实解锁过**这张，否则 403 |
| POST | `/api/unlocks` | 记录解锁 / 刷新最佳成绩，并返回解锁文案 |
| GET | `/api/gallery` | 相册墙元数据：已解锁给签名链接，未解锁**不返回任何图片信息** |
| POST | `/api/admin/login` | 管理员登录（自建密码或 Supabase Auth），签发 HttpOnly session cookie |
| POST | `/api/admin/logout` | 退出 |
| GET | `/api/admin/session` | 当前登录态 + 是否已完成初始化 |
| POST | `/api/admin/photos/upload-url` | 预签名上传令牌（校验 MIME / 体积） |
| GET / POST | `/api/admin/photos` | 列出照片（含解锁数） / 用已直传的 raw 对象创建照片记录 |
| PATCH / DELETE | `/api/admin/photos/[id]` | 上下架、改文案 / 删除记录 + 清理 Storage 对象 |
| GET | `/api/og?photoId=<uuid>` | 动态分享卡片（Node.js runtime，固定模板，只接受 photoId） |

所有写操作都会：① 校验同源（`Origin` vs `Host`，CSRF 防护）；② 走进程内滑动窗口限流；③ 服务端鉴权。

---

## 7. 安全模型（一页看完）

* **照片存私有 bucket**：`public = false`，`storage.objects` 对 anon 没有任何 policy → 不能 list、不能 download。
* **原图只能靠服务端签发链接**：`createSignedUrl` 默认 **5 分钟**。签名密钥由 Storage 服务独立管理，与 Auth JWT 签名密钥不同，**不受 Auth key 轮换影响**。过期后同一个链接访问返回 403。
* **`size=full` 需要先解锁**：否则任何人都可以「扒接口直接看原图」，这是本项目特意补上的一环。
* **管理员上传走预签名直传**：`createSignedUploadUrl`（Supabase 侧 2 小时有效）+ `uploadToSignedUrl`，大图不经过 Next.js 函数内存。若日后需要 > 50MB 或弱网续传，可换成 TUS（`tus-js-client` + `x-upsert`）或 S3 兼容的 presigned PUT。
* **`SUPABASE_SERVICE_ROLE_KEY` 只在服务端**：`src/lib/supabase/admin.ts` 带 `server-only`；`NEXT_PUBLIC_` 前缀变量里只有 URL / anon key / 文案。
* **匿名身份**：localStorage 的 `deviceId` 只用于本机体验，**不是可信身份**；服务端签发 `HttpOnly + Secure(生产) + SameSite=Lax` 的匿名 session cookie，数据库里记 `anon_session_id`，仅用于统计解锁，不承担认证。上线前在 **DevTools → Application → Cookies** 里确认三个 flag 都在。
* **localStorage 只存体验数据**，统一 key：`photoPuzzle.deviceId` / `photoPuzzle.unlocked` / `photoPuzzle.bestTimes` / `photoPuzzle.total` / `photoPuzzle.lastDifficulty`。**不存图片 base64、不存任何 auth token。**
* **管理员密码**：bcrypt(cost 12) 哈希存库；前端不做任何密码校验，必须在服务端比对。
* **其他**：CSP / HSTS / `X-Frame-Options: DENY` / `nosniff` 等安全响应头在 `next.config.ts`；`/admin` 与所有管理 API 有独立限流。

### ⚠️ 免责与隐私提醒

* **前端密码不可靠**：本项目所有密码校验都在服务端，请勿在任何客户端代码里做「密码对错」的判断。
* 这是一个**个人项目**：即使做了私有 bucket + 短期签名 + RLS，也**不建议存放极度隐私的照片**。想更稳妥可以再加 Supabase Auth 登录门槛或客户端加密。

---

## 8. 部署（Vercel + Supabase）

1. **Supabase**：新建项目 → `supabase link` → `supabase db push`（会自动建桶、建策略、打印一次初始管理员密码）。
2. **Vercel**：Import Git 仓库（framework 自动识别 Next.js），或直接 `vercel --prod`。
3. **环境变量**：把第 2 节表格里的变量填进 Vercel Project Settings；`NEXT_PUBLIC_SITE_URL` 填生产域名（OG 卡片与分享链接用它）。
4. **`.env.local` 不要提交**（已在 `.gitignore`），service role key 只存在于 Vercel 的 Environment Variables。
5. 部署后逐条走第 10 节的验收清单。

`vercel.json` 里固定了 region 并给 `/api/*` 加了 `X-Robots-Tag: noindex`。
一般**不需要额外 rewrite**：App Router 的路由就是最终路径；只有当你把游戏挂到子路径（例如 `https://me.com/puzzle`）时才需要配 rewrite，同时把 `NEXT_PUBLIC_SITE_URL` 改成子路径前缀。

### 8.1 本项目的仓库地址（私有）

| 项目 | 值 |
| --- | --- |
| 网页地址 | https://github.com/renyang-create/photo-puzzle |
| SSH 推送地址 | `git@github.com:renyang-create/photo-puzzle.git` |
| 默认分支 | `main`（已设置上游跟踪 `origin/main`） |

```bash
git remote -v      # origin  git@github.com:renyang-create/photo-puzzle.git (fetch/push)
git push           # 已跟踪上游，直接推即可
```

在新机器上克隆：

```bash
git clone git@github.com:renyang-create/photo-puzzle.git
cd photo-puzzle
pnpm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
supabase link --project-ref <your-project-ref>
supabase db push
pnpm dev
```

> 该仓库是 **Private**：照片与 `SUPABASE_SERVICE_ROLE_KEY` 都不会进仓库（`.env*` 已被 `.gitignore` 排除，只提交 `.env.example`）。
> Vercel 侧用 GitHub 集成导入该仓库即可自动部署。

### 8.2 备选：Netlify（**永久免费档**，无需手机号验证）

如果不想为 Vercel 的账号手机验证折腾，Netlify 的免费档可以完整跑起这个项目：

* **适配器必须显式声明**：Next.js 由 OpenNext 官方适配器 `@netlify/plugin-nextjs`（v5，
  支持 Next.js 16）接管，把 SSR / API 路由 / Server Actions 打包成 **Node 运行时的
  Netlify Functions**，因此服务端的 `sharp` 可以正常工作。

  ⚠️ 实测教训：**首次部署时 Netlify 的「框架自动识别」没有生效**，它直接把 `.next`
  当成普通静态目录发布 —— 而 `.next` 根目录没有 `index.html`，于是首页、`public/` 下
  的静态文件、全部 API 一起返回 Netlify 的 `404 Page not found`（**不是应用报错**，
  很容易误判成代码问题）。因此在 `netlify.toml` 里显式声明，不再依赖自动识别：

  ```toml
  [[plugins]]
    package = "@netlify/plugin-nextjs"
  ```

  版本在 `package.json` 里用 `^` 放宽，与官方「不要写死适配器版本，让安全修复自动跟进」
  的建议一致。
* `netlify.toml` 已固定 `NODE_VERSION = "22"`（`@supabase/supabase-js` 2.x 要求 Node ≥ 22）
  与 `publish = ".next"`。
* 环境变量仍在**控制台**配置（`Site configuration → Environment variables`），
  且必须在**首次部署前**配好 —— Next 会在构建期把 `NEXT_PUBLIC_*` 内联进前端产物。
* 免费档需要留意两个量：**构建分钟数**与**函数调用次数**；本项目的图片流量走 Supabase
  signed URL，不消耗 Netlify 带宽，因此实际用量主要来自页面与 API 请求。
* 函数有 10 秒执行上限：`/api/og` 拉中文字体时设了 4 秒超时并会在失败时降级为纯英文卡片，
  cold start 不会顶到上限。

部署步骤（控制台操作）：

```
1. netlify.com → Add new site → Import an existing project → GitHub → 授权 → 选 photo-puzzle
2. Build command: pnpm build        （一般自动识别）
   Publish directory: .next         （一般自动识别）
3. Site configuration → Environment variables：填入与 .env.local 相同的键值
4. Deploy site → 拿到 https://<name>.netlify.app
5. 把 NEXT_PUBLIC_SITE_URL 改成该地址后重新部署一次（NEXT_PUBLIC_* 是构建期内联的）
```

---

## 9. 声音（背景音乐与音效）

| 用途 | 文件 | 触发时机 |
| --- | --- | --- |
| 背景音乐（`loop`） | `public/audio/bgm.mp3` | 进入 `/play` 起播，离开页面暂停并复位 |
| 按住 / 松开 | `public/audio/bubble-pop.mp3` | `pointerdown` 响一次、`pointerup` 再响一次（点选与拖拽都算） |
| 拼图完成 | `public/audio/ding.mp3` | 最后一次交换被判定为完成时立即响 |

* **右上角喇叭按钮**：开启显示 `Volume2`（喇叭 + 声波），关闭显示 `VolumeOff`（喇叭 + 一斜杠）。
  状态存在 `localStorage` 的 `photoPuzzle.soundEnabled`（`1` / `0`），刷新后保持。
* **有音效时自动压低 BGM**：`0.35 → 0.12`（60ms 内让位），音效结束后 200ms 平滑恢复；「叮」的压低时长
  1.6s，比普通音效的 0.7s 更长。所有常量集中在 `src/lib/audio.ts` 顶部，改这里就能调手感。
* 音效用 3 个 `Audio` 对象做对象池，连续快按不会互相打断；BGM 是单例，路由切换不会叠音。
* ⚠️ **浏览器禁止无交互自动播放**：进入 `/play` 后先尝试 `play()`，被拒绝就挂一次性
  `pointerdown` / `keydown` 监听，等你第一次碰屏幕再起播。这是浏览器策略，绕不过去。
* 想让朋友进来默认安静，把 `photoPuzzle.soundEnabled` 预置成 `"0"` 即可（喇叭按钮仍可当场打开）。

---

## 10. 验收清单

- [x] `pnpm dev` 本地可跑（未配 Supabase 时首页显示配置提示而不是白屏）
- [x] 管理员登录后上传照片，朋友端能随机抽到
- [x] 未登录用户访问 `/admin`、管理 API 只能看到登录表单 / 拿到 401
- [x] 浏览器直接请求 Storage 原图 URL → 403（anon 无 storage policy）
- [x] signed URL 过期后失效（TTL 5 分钟）
- [x] `size=full` 未解锁时返回 403，无法靠扒接口绕过游戏
- [x] anon 不能增删改 `photos`
- [x] 手机浏览器可玩：点击两块交换、Pointer Events 拖拽交换、三种难度可切换
- [x] 每块触控区 >= 44px（CSS 表达式兜底，不满足时自动放大棋盘）
- [x] 完成后弹出完整图 + 「解锁成功」+ 专属文案，并提供「再玩一次」
- [x] 相册墙：已解锁清晰图可点大图，未解锁只显示锁 + 模糊占位（拿不到任何图片地址）
- [x] 刷新后进度保留（localStorage + 服务端 `unlocks` 双写）
- [x] 分享按钮：`navigator.clipboard.writeText`，失败回退 `textarea + execCommand`
- [x] 隐藏管理入口：标题连点 5 次
- [x] 动态 OG 卡片：Node.js runtime + 固定模板 + 只传 `photoId`
- [x] CVE-2026-94545 防护：版本高于修复线 + 文本白名单 + 固定模板
- [x] 前端 canvas 压缩：>10MB 或非 JPEG/WebP/AVIF 时压到长边 ≤2000px
- [x] 进入拼图页后背景音乐循环播放；右上角喇叭可静音（关闭时图标带斜杠），状态刷新后保持
- [x] 按住拼图块与松开时各有泡泡音效；拼好照片时响「叮」
- [x] 音效播放期间 BGM 自动压低（0.35 → 0.12），音效结束 200ms 内平滑恢复
- [x] 静音后 BGM 与音效同时停止；三个 mp3 都在 `public/audio/` 下随站点静态提供
- [x] `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿（55 个单测）

---

## 11. 测试

```bash
pnpm test        # Vitest：拼图打乱与胜负判定、本地记录、入参校验、会话 JWT、压缩尺寸
pnpm test:e2e    # Playwright：封面→难度切换→块数/触控区→点击交换→相册锁定态→匿名 cookie flag
```

E2E 需要先配好 `.env.local` 并且照片池里至少有一张照片。

### 手工验收几条（复制即可跑）

```bash
pnpm build && pnpm start   # 生产模式

# ① 匿名 cookie 的三个 flag（HttpOnly / Secure / SameSite=Lax）
curl -sI http://localhost:3000/ | findstr /i "set-cookie"     # Windows
curl -sI http://localhost:3000/ | grep -i set-cookie          # macOS / Linux

# ② 未登录访问管理 API → 401
curl -si -X POST http://localhost:3000/api/admin/photos/upload-url \
  -H "Content-Type: application/json" \
  -d '{"fileName":"a.jpg","contentType":"image/jpeg","size":1024}'

# ③ 跨站写请求 → 403（CSRF 防护）
curl -si -X POST http://localhost:3000/api/unlocks \
  -H "Content-Type: application/json" -H "Origin: https://evil.example" \
  -d '{"photoId":"00000000-0000-4000-8000-000000000000","difficulty":3,"timeMs":1000}'

# ④ 非法 id / 非法 OG 参数 → 400
curl -si http://localhost:3000/api/photos/not-a-uuid/url
curl -si "http://localhost:3000/api/og?photoId=../../etc/passwd"

# ⑤ 原图直链与过期签名链接 → 403（先拿到一个 signed URL，然后等 5 分钟或改掉签名）
curl -si "https://<project>.supabase.co/storage/v1/object/public/photos/<uuid>/full.jpg"
```

本机实测（Next.js 16.4.0 生产构建）：

```
set-cookie: pp_anon=…; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=lax
[CSRF] 403 {"ok":false,"error":"跨站请求已被拒绝（CSRF 防护）","code":"forbidden"}
[未登录管理 API] 401 {"ok":false,"error":"需要管理员登录","code":"unauthorized"}
[非法 id] 400   [非法 OG 参数] 400
[OG 卡片] 200 image/png（约 100KB，含中文标题）
```

`tests/` 覆盖的「关键流程」：

* `puzzle.test.ts`：Fisher-Yates 不变量、**保证不是已完成状态**、至少打乱 60%、`data-index === data-slot` 语义、`background-position` 角点、44px 触控区
* `local-store.test.ts`：五个 localStorage key 的契约、最佳成绩不被更慢的成绩覆盖、脏数据降级、幂等
* `security.test.ts`：匿名 / 管理员 JWT 的签名镜像与 kind 隔离、被篡改的 token 失效、路径穿越与 SVG MIME 被拒、OG 文本白名单
* `image-client.test.ts`：长边 2000 等比缩放、只缩不放、极端长条图不为 0
* `audio.test.ts`：三个 mp3 **真实存在于 `public/audio/`**（资源路径契约）、压低音量必须小于默认音量、
  静音时恒为 0、`fadeVolume` 插值两端与越界夹取、「叮」的压低时长长于普通音效、开关状态的脏值解析

---

## 12. 目录速览

```
src/
├─ app/
│  ├─ page.tsx                    封面（标题连点 5 次 → /admin）
│  ├─ play/page.tsx               拼图
│  ├─ gallery/page.tsx            解锁相册墙
│  ├─ admin/page.tsx              管理后台
│  └─ api/…                       random / url / gallery / unlocks / admin/* / og
├─ components/
│  ├─ puzzle/                     puzzle-board / difficulty-picker / unlock-dialog / game-shell
│  ├─ gallery/gallery-wall.tsx
│  ├─ admin/                      admin-console / admin-upload-form
│  ├─ ui/                         shadcn/ui（CLI 生成）
│  └─ share-button / sound-toggle / hidden-admin-trigger / local-stats
├─ hooks/                         use-local-progress / use-sound-enabled（useSyncExternalStore 订阅 localStorage）
├─ public/audio/                  bgm.mp3（循环）· bubble-pop.mp3（按住/松开）· ding.mp3（完成）
├─ lib/
│  ├─ supabase/{client,server,admin}.ts
│  ├─ session-core.ts / session.ts   匿名与管理员 cookie
│  ├─ admin-auth.ts                  bcrypt 比对 + Supabase Auth 白名单
│  ├─ photos.service.ts              抽照片 / 相册 / 解锁
│  ├─ storage.ts                     createSignedUrl / createSignedUploadUrl / 对象读写
│  ├─ audio.ts                       BGM / 音效 / 压低策略（音量常量都在这里）
│  ├─ image-server.ts (sharp) / image-client.ts (canvas)
│  ├─ puzzle.ts / local-store.ts / validation.ts / http.ts
│  └─ env.public.ts / env.server.ts / database.types.ts / types.ts
└─ middleware.ts                  Supabase session 刷新 + 匿名 cookie 签发
```

## 13. 已知限制

* **进程内限流**：单实例有效。Vercel 多实例/多 region 下请换 Upstash Redis（`@upstash/ratelimit`），改动点集中在 `src/lib/http.ts`。
* **OG 中文字体**：Satori 只支持 TTF/OTF/WOFF（不支持 woff2）。默认从 CDN 拉 Noto Sans SC SubsetOTF 并缓存；拉取失败时卡片自动退化为纯英文文案，不会 500。可用 `OG_FONT_URL` 指向自己的字体文件（例如放进 `public/`）。
* **解锁统计的身份口径**是匿名 cookie，不是用户账号；跨设备合并需要将来引入真实登录。
* **`<img>` 而非 `next/image`**：图片是 5 分钟过期的签名链接，交给 Next 图片优化器反而会缓存过期地址，因此显式关闭了该规则并加了注释说明。
