import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { publicEnv } from "@/lib/env.public";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteTitle = `解锁${publicEnv.nickname}的照片`;
const siteDescription = "点开链接就能玩，拼好照片才看得到它。无需下载、无需注册。";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: siteTitle,
    template: `%s · ${publicEnv.siteName}`,
  },
  description: siteDescription,
  applicationName: publicEnv.siteName,
  openGraph: {
    type: "website",
    siteName: publicEnv.siteName,
    title: siteTitle,
    description: siteDescription,
    // 动态分享卡片：Node.js runtime + 固定模板，只接受 photoId
    images: [{ url: "/api/og", width: 1200, height: 630, alt: alt() }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/api/og"],
  },
  robots: {
    // 个人照片不希望被搜索引擎收录
    index: false,
    follow: false,
  },
};

function alt() {
  return `${publicEnv.nickname}的照片拼图`;
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070a18",
  // 允许用户缩放（可访问性），只对拼图区域单独禁用滚动手势
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full flex flex-col overscroll-none">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
