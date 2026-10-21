import Link from "next/link";
import { ImageIcon, Puzzle, ShieldCheck } from "lucide-react";

import { BirthdayCountdown } from "@/components/birthday-countdown";
import { HiddenAdminTrigger } from "@/components/hidden-admin-trigger";
import { LocalStats } from "@/components/local-stats";
import { ShareButton } from "@/components/share-button";
import { VisitBeacon } from "@/components/visit-beacon";
import { buttonVariants } from "@/components/ui/button";
import { publicEnv } from "@/lib/env.public";
import { cn } from "@/lib/utils";

/**
 * 封面页。
 * 标题连点 5 次 → /admin（隐藏入口；真正的权限判定在服务端）。
 */
export default function CoverPage() {
  const configured = Boolean(
    publicEnv.supabaseUrl && publicEnv.supabaseAnonKey,
  );

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-5 py-10">
      <VisitBeacon kind="view" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 40% at 20% 10%, rgba(167,139,250,0.28), transparent), radial-gradient(50% 40% at 85% 30%, rgba(56,189,248,0.22), transparent)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex items-center gap-2 text-violet-200/80">
          <Puzzle className="size-4" />
          <span className="text-xs tracking-[0.3em] uppercase">
            {publicEnv.siteName}
          </span>
        </div>

        <HiddenAdminTrigger className="block w-full text-left">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">
            解锁
            <span className="bg-gradient-to-r from-violet-300 to-sky-300 bg-clip-text text-transparent">
              {publicEnv.nickname}
            </span>
            的照片
          </h1>
        </HiddenAdminTrigger>

        <p className="text-muted-foreground mt-3 text-sm">
          每一张都被切成了拼图。拼好，才看得到它。
          <br />
          点开就能玩，不用下载，也不用注册。
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/play" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            开始挑战
          </Link>
          <div className="flex gap-3">
            <Link
              href="/gallery"
              className={cn(buttonVariants({ variant: "secondary" }), "flex-1")}
            >
              我的相册
            </Link>
            <ShareButton className="flex-1" label="分享给朋友" />
          </div>
        </div>

        <div className="mt-6">
          <BirthdayCountdown />
        </div>

        <div className="mt-8">
          <LocalStats />
        </div>

        {!configured && (
          <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-xs leading-relaxed text-amber-100">
            <p className="mb-2 flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4" /> 还没接上 Supabase
            </p>
            <p>
              把 <code>.env.example</code> 复制成 <code>.env.local</code>，填上
              <code> NEXT_PUBLIC_SUPABASE_URL</code>、
              <code> NEXT_PUBLIC_SUPABASE_ANON_KEY</code>、
              <code> SUPABASE_SERVICE_ROLE_KEY</code> 与
              <code> SESSION_PASSWORD</code>，
              然后执行 <code>supabase db push</code> 应用 migration。
            </p>
          </div>
        )}

        <div className="text-muted-foreground mt-10 flex items-start gap-2 text-[11px] leading-relaxed">
          <ImageIcon className="mt-0.5 size-3.5 shrink-0" />
          <p>
            照片保存在私有 bucket，只有服务端签发的 5 分钟链接能访问；
            拼图用的是缩略图，原图要解锁之后才会签发。
          </p>
        </div>
      </div>
    </main>
  );
}
