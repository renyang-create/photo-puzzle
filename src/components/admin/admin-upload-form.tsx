"use client";

import { useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/client-api";
import {
  compressImageFile,
  formatBytes,
  needsCompression,
} from "@/lib/image-client";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * 上传流程（预签名直传，大文件不经过 Next.js 函数内存）：
 *
 *   1. 浏览器端：>10MB 或非 jpeg/webp/avif 时，先用 canvas 压到长边 ≤2000px / JPEG 0.8
 *      （顺带丢掉 EXIF/GPS）
 *   2. POST /api/admin/photos/upload-url → 服务端签发一次性令牌（Supabase 侧 2 小时有效）
 *   3. 浏览器直接 uploadToSignedUrl 到私有 bucket，路径是随机 UUID
 *   4. POST /api/admin/photos → 服务端用 sharp 归一化（EXIF 方向摆正 / 长边 2000 / 清元数据）
 *      并产出 800px 缩略图，最后写数据库记录
 *
 * 全程前端拿不到 service_role key，也没有任何密码校验逻辑。
 */

interface UploadTicket {
  bucket: string;
  path: string;
  token: string;
}

type Step = "idle" | "compress" | "ticket" | "upload" | "process" | "done";

const STEP_TEXT: Record<Step, string> = {
  idle: "",
  compress: "正在压缩图片…",
  ticket: "正在申请上传令牌…",
  upload: "正在直传 Storage…",
  process: "服务端正在生成多尺寸…",
  done: "完成",
};

export function AdminUploadForm({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [unlockText, setUnlockText] = useState("你居然真的认识我");
  const [sortOrder, setSortOrder] = useState(0);
  const [step, setStep] = useState<Step>("idle");
  const [busy, setBusy] = useState(false);

  const compressing = file ? needsCompression(file) : false;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      toast.error("先选一张照片");
      return;
    }

    setBusy(true);
    try {
      // 步骤 1：前端 canvas 压缩
      setStep("compress");
      const prepared = compressing
        ? await compressImageFile(file)
        : { blob: file as Blob, skipped: true, originalBytes: file.size };
      const blob = prepared.blob;

      // 步骤 2：申请预签名上传令牌
      setStep("ticket");
      const ticket = await apiPost<UploadTicket>("/api/admin/photos/upload-url", {
        fileName: file.name,
        contentType: blob.type || "image/jpeg",
        size: blob.size,
      });

      // 步骤 3：浏览器直传（不经服务器内存）
      setStep("upload");
      const supabase = getBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, blob, {
          contentType: blob.type || "image/jpeg",
          cacheControl: "0",
        });
      if (uploadError) {
        throw new Error(`直传失败：${uploadError.message}`);
      }

      // 步骤 4：让服务端用 sharp 处理并落库
      setStep("process");
      await apiPost("/api/admin/photos", {
        storagePath: ticket.path,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        unlockText: unlockText.trim() || "你居然真的认识我",
        sortOrder,
      });

      setStep("done");
      toast.success("上传成功，朋友端已经能随机抽到它了");
      setFile(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      onUploaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
      setStep("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="flex items-center gap-2">
        <UploadCloud className="size-4 text-violet-300" />
        <h2 className="text-sm font-semibold">添加新照片</h2>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="photo-file">照片文件</Label>
        <Input
          id="photo-file"
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={busy}
        />
        {file && (
          <p className="text-muted-foreground text-[11px]">
            {file.name} · {formatBytes(file.size)}
            {compressing
              ? " · 超过 10MB 或非 JPEG，上传前会先用 canvas 压到长边 ≤2000px"
              : " · 体积合适，直接上传"}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="photo-title">标题</Label>
        <Input
          id="photo-title"
          value={title}
          maxLength={40}
          placeholder="例如：海边的傍晚"
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="photo-unlock-text">解锁文案（拼好后才会显示）</Label>
        <Input
          id="photo-unlock-text"
          value={unlockText}
          maxLength={60}
          onChange={(event) => setUnlockText(event.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="photo-sort">排序权重（越大越靠前）</Label>
        <Input
          id="photo-sort"
          type="number"
          value={sortOrder}
          onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
          disabled={busy}
        />
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? STEP_TEXT[step] : "上传并发布"}
      </Button>
    </form>
  );
}
