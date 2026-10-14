import type { Difficulty } from "./puzzle";

/**
 * public.photos 行结构（storage_path 等只应存在于服务端）
 * 注意：必须写成 type 而不是 interface —— postgrest-js 的 GenericTable 约束是
 * `Row: Record<string, unknown>`，interface 没有隐式索引签名会不满足约束，
 * 整个 Database 泛型会退化成 never。
 */
export type PhotoRow = {
  id: string;
  storage_path: string;
  thumb_path: string | null;
  raw_path: string | null;
  title: string;
  unlock_text: string;
  is_active: boolean;
  sort_order: number;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
};

/** 对普通访客可见的照片信息：不含任何存储路径 */
export interface PlayablePhoto {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** 服务端签发的短期 signed URL（默认 5 分钟） */
  imageUrl: string;
  expiresAt: string;
  width: number | null;
  height: number | null;
}

/** 相册墙条目：锁定项不会返回任何图片地址 */
export type GalleryItem =
  | {
      id: string;
      title: string;
      unlocked: true;
      thumbUrl: string;
      fullUrl: string;
      bestTimeMs: number;
      difficulty: Difficulty;
      unlockedAt: string;
    }
  | {
      id: string;
      title: string;
      unlocked: false;
      hint: string;
    };

export interface UnlockPayload {
  photoId: string;
  difficulty: Difficulty;
  timeMs: number;
}

export interface UnlockResult {
  ok: true;
  unlockText: string;
  bestTimeMs: number;
  isNewRecord: boolean;
  totalUnlocked: number;
}

export interface ApiError {
  ok: false;
  error: string;
  code:
    | "bad_request"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "server_error";
}
