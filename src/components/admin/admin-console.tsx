"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminUploadForm } from "@/components/admin/admin-upload-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/client-api";

interface AdminPhoto {
  id: string;
  title: string;
  unlock_text: string;
  is_active: boolean;
  sort_order: number;
  width: number | null;
  height: number | null;
  created_at: string;
  unlockCount: number;
}

interface SessionState {
  authenticated: boolean;
  actor: string | null;
  method: string | null;
  initialized: boolean;
}

/**
 * 后台：
 *   - 未登录 → 登录表单（密码走自建 bcrypt 校验；邮箱走 Supabase Auth 白名单）
 *   - 已登录 → 列表 / 上下架 / 改文案 / 删除 + 上传
 * 前端只负责显示，任何权限判断都在服务端。
 */
export function AdminConsole() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminPhoto | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUnlockText, setEditUnlockText] = useState("");

  const refreshSession = useCallback(async () => {
    const data = await apiGet<SessionState>("/api/admin/session");
    setSession(data);
    return data;
  }, []);

  const loadPhotos = useCallback(async () => {
    const data = await apiGet<{ photos: AdminPhoto[] }>("/api/admin/photos");
    setPhotos(data.photos);
  }, []);

  /** 挂载后校验身份：所有 setState 都发生在 await 之后 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const current = await apiGet<SessionState>("/api/admin/session");
        if (!alive) return;
        setSession(current);
        if (current.authenticated) {
          const data = await apiGet<{ photos: AdminPhoto[] }>("/api/admin/photos");
          if (alive) setPhotos(data.photos);
        }
      } catch (error) {
        if (alive) {
          toast.error(error instanceof Error ? error.message : "加载失败");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-3 py-24">
        <Loader2 className="size-5 animate-spin" />
        正在校验管理员身份…
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <LoginForm
        initialized={session?.initialized ?? true}
        onSuccess={async () => {
          await refreshSession();
          await loadPhotos();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck className="size-4 text-emerald-300" />
          已登录为 <span className="font-medium">{session.actor}</span>
          <Badge variant="secondary">{session.method}</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await apiPost("/api/admin/logout");
            toast.success("已退出");
            await refreshSession();
          }}
        >
          <LogOut className="size-4" />
          退出
        </Button>
      </div>

      <AdminUploadForm onUploaded={() => void loadPhotos()} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">照片池（{photos.length}）</h2>
        {photos.length === 0 && (
          <p className="text-muted-foreground text-xs">
            还没有照片。上传第一张之后，朋友端就能随机抽到它。
          </p>
        )}

        <div className="flex flex-col gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{photo.title}</p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {photo.is_active ? "已上架" : "已下架"} · 解锁 {photo.unlockCount} 次 ·{" "}
                  {photo.width && photo.height
                    ? `${photo.width}×${photo.height}`
                    : "尺寸未知"}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  解锁文案：{photo.unlock_text}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="编辑文案"
                  onClick={() => {
                    setEditing(photo);
                    setEditTitle(photo.title);
                    setEditUnlockText(photo.unlock_text);
                  }}
                >
                  <Eye className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={photo.is_active ? "下架" : "上架"}
                  onClick={async () => {
                    await apiPatch(`/api/admin/photos/${photo.id}`, {
                      isActive: !photo.is_active,
                    });
                    await loadPhotos();
                  }}
                >
                  {photo.is_active ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="删除"
                  onClick={async () => {
                    if (!window.confirm(`删除「${photo.title}」？Storage 里的对象会一起清掉。`)) {
                      return;
                    }
                    await apiDelete(`/api/admin/photos/${photo.id}`);
                    toast.success("已删除");
                    await loadPhotos();
                  }}
                >
                  <Trash2 className="size-4 text-rose-300" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑文案</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">标题</Label>
              <Input
                id="edit-title"
                value={editTitle}
                maxLength={40}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-unlock">解锁文案</Label>
              <Input
                id="edit-unlock"
                value={editUnlockText}
                maxLength={60}
                onChange={(event) => setEditUnlockText(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!editing) return;
                await apiPatch(`/api/admin/photos/${editing.id}`, {
                  title: editTitle,
                  unlockText: editUnlockText,
                });
                setEditing(null);
                toast.success("已更新");
                await loadPhotos();
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoginForm({
  initialized,
  onSuccess,
}: {
  initialized: boolean;
  onSuccess: () => Promise<void>;
}) {
  const mode = initialized ? "password" : "setup";
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [emailMode, setEmailMode] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = emailMode
        ? { email, password }
        : mode === "setup"
          ? { password, setupToken }
          : { password };

      await apiPost("/api/admin/login", payload);
      toast.success("登录成功");
      await onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">管理员入口</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          {mode === "setup"
            ? "首次部署：用 ADMIN_SETUP_TOKEN 设置一个强密码（服务端只保存 bcrypt 哈希）"
            : "密码校验发生在服务端，前端不做任何判断"}
        </p>
      </div>

      {emailMode && (
        <div className="grid gap-2">
          <Label htmlFor="admin-email">邮箱（Supabase Auth）</Label>
          <Input
            id="admin-email"
            type="email"
            value={email}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
      )}

      {!emailMode && mode === "setup" && (
        <div className="grid gap-2">
          <Label htmlFor="admin-setup">初始化令牌（ADMIN_SETUP_TOKEN）</Label>
          <Input
            id="admin-setup"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
            required
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="admin-password">密码</Label>
        <Input
          id="admin-password"
          type="password"
          value={password}
          autoComplete="current-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {mode === "setup" ? "设置密码并进入" : "登录"}
      </Button>

      {initialized && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEmailMode((value) => !value)}
        >
          {emailMode ? "改用自建密码登录" : "改用 Supabase Auth 邮箱登录"}
        </Button>
      )}
    </form>
  );
}
