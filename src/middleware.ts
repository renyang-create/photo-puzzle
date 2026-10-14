import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env.public";
import {
  ANON_COOKIE,
  ANON_COOKIE_MAX_AGE,
  cookieFlags,
  newSessionId,
  signAnonToken,
  verifyAnonToken,
} from "@/lib/session-core";

/**
 * 1) 刷新 Supabase Auth session（管理员用邮箱登录时用得到）
 * 2) 给每个访客签发 HttpOnly 匿名 session cookie（只用于解锁统计，不是认证）
 *
 * 匿名 cookie 的 flag：HttpOnly + Secure(生产) + SameSite=Lax。
 * 本地 http://localhost 下 Secure 必须关闭，否则浏览器不会写入。
 * 上线后可在 DevTools → Application → Cookies 里核对三项 flag。
 */
let warnedAboutSessionSecret = false;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // ---- Supabase Auth session 刷新 ----
  if (publicEnv.supabaseUrl && publicEnv.supabaseAnonKey) {
    try {
      const supabase = createServerClient(
        publicEnv.supabaseUrl,
        publicEnv.supabaseAnonKey,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value }) =>
                request.cookies.set(name, value),
              );
              response = NextResponse.next({ request });
              cookiesToSet.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options),
              );
            },
          },
        },
      );
      await supabase.auth.getUser();
    } catch {
      /* 网络异常不应阻断页面 */
    }
  }

  // ---- 匿名 session cookie ----
  // 注意：中间件跑在 Edge runtime，覆盖所有页面。
  // 缺 SESSION_PASSWORD 时，API 路由应当「快速失败」（它们真的需要这个密钥），
  // 但页面不应该因此 500 —— 否则运维漏配一个环境变量就整站不可用，
  // 用户连「还没配置好」的提示都看不到。
  try {
    const existing = request.cookies.get(ANON_COOKIE)?.value;
    const verified = existing ? await verifyAnonToken(existing) : null;

    if (!verified) {
      const token = await signAnonToken(newSessionId());
      response.cookies.set(ANON_COOKIE, token, cookieFlags(ANON_COOKIE_MAX_AGE));
    }
  } catch (error) {
    if (!warnedAboutSessionSecret) {
      warnedAboutSessionSecret = true;
      console.error(
        "[middleware] 无法签发匿名 session cookie，请检查 SESSION_PASSWORD（生产环境需 >= 32 字符）：",
        (error as Error).message,
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 跳过静态资源、图片优化器与 OG 图路由（OG 是给爬虫看的，没必要带 cookie）
     */
    "/((?!api/og|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
