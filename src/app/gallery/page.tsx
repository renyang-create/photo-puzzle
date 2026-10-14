import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { GalleryWall } from "@/components/gallery/gallery-wall";

export const metadata: Metadata = {
  title: "我的相册",
};

export default function GalleryPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground rounded-full p-2"
          aria-label="返回封面"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">我的相册</h1>
          <p className="text-muted-foreground text-xs">
            解锁过的照片会留在这里，刷新也不会丢
          </p>
        </div>
      </header>

      <GalleryWall />
    </main>
  );
}
