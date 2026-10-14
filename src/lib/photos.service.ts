import "server-only";

import type { Difficulty } from "./puzzle";
import { mulberry32 } from "./puzzle";
import { SIGNED_URL_TTL_SECONDS, createSignedReadUrl, createSignedReadUrls } from "./storage";
import { getAdminClient } from "./supabase/admin";
import type { GalleryItem, PhotoRow, PlayablePhoto, UnlockResult } from "./types";

/**
 * 照片领域服务：全部在服务端运行，统一使用 service_role 客户端。
 *
 * 为什么要用 service_role 而不是 anon：
 *   - 私有 bucket 对 anon 没有任何 storage policy，anon 签不出 signed URL；
 *   - unlocks 表对 anon 不开放读写，写入口只允许在服务端。
 *   对外暴露的永远是「服务端裁剪过的数据」，客户端拿不到 storage_path。
 */

export class PhotoNotFoundError extends Error {
  constructor(message = "照片不存在或已下架") {
    super(message);
    this.name = "PhotoNotFoundError";
  }
}

// `as const` 让 select 的列名字符串保持字面量类型，postgrest 的类型解析器才能推导出行类型
const PHOTO_COLUMNS = `id, storage_path, thumb_path, raw_path, title, unlock_text, is_active, sort_order, width, height, created_at, updated_at` as const;

export async function listActivePhotos(): Promise<PhotoRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`读取照片列表失败：${error.message}`);
  return (data ?? []) as PhotoRow[];
}

export async function listAllPhotos(): Promise<PhotoRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`读取照片列表失败：${error.message}`);
  return (data ?? []) as PhotoRow[];
}

export async function getPhotoById(id: string): Promise<PhotoRow | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`读取照片失败：${error.message}`);
  return (data as PhotoRow | null) ?? null;
}

export interface UnlockRowLite {
  photo_id: string;
  best_time_ms: number;
  difficulty: number;
  created_at: string;
}

export async function listUnlocksForSession(
  sessionId: string,
): Promise<UnlockRowLite[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("unlocks")
    .select("photo_id, best_time_ms, difficulty, created_at")
    .eq("anon_session_id", sessionId);

  if (error) throw new Error(`读取解锁记录失败：${error.message}`);
  return (data ?? []) as UnlockRowLite[];
}

/**
 * 随机抽一张照片：优先未解锁的，全解锁后随便给一张。
 * 排序用 Fisher-Yates（mulberry32 由时间戳播种），避免 `order by random()` 的额外开销。
 */
export async function pickRandomPhoto(
  sessionId: string,
  difficulty: Difficulty,
): Promise<PlayablePhoto | null> {
  const photos = await listActivePhotos();
  if (photos.length === 0) return null;

  const unlocks = await listUnlocksForSession(sessionId);
  const unlockedIds = new Set(unlocks.map((row) => row.photo_id));

  const fresh = photos.filter((photo) => !unlockedIds.has(photo.id));
  const pool = fresh.length > 0 ? fresh : photos;

  const random = mulberry32(Date.now() ^ pool.length);
  const chosen = pool[Math.floor(random() * pool.length)] ?? pool[0]!;

  const path = chosen.thumb_path ?? chosen.storage_path;
  const imageUrl = await createSignedReadUrl(path, SIGNED_URL_TTL_SECONDS);

  return {
    id: chosen.id,
    title: chosen.title,
    difficulty,
    imageUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    width: chosen.width,
    height: chosen.height,
  };
}

/**
 * 相册墙：已解锁的返回短期 signed URL（缩略 + 大图），未解锁的不返回任何图片信息，
 * 只给一句提示。这样即使用户扒接口也拿不到锁着的那张图。
 */
export async function buildGallery(sessionId: string): Promise<GalleryItem[]> {
  const photos = await listActivePhotos();
  if (photos.length === 0) return [];

  const unlocks = await listUnlocksForSession(sessionId);
  const bestByPhoto = new Map<string, UnlockRowLite>();
  for (const row of unlocks) {
    const current = bestByPhoto.get(row.photo_id);
    if (!current || row.best_time_ms < current.best_time_ms) {
      bestByPhoto.set(row.photo_id, row);
    }
  }

  const paths: string[] = [];
  for (const photo of photos) {
    if (!bestByPhoto.has(photo.id)) continue;
    paths.push(photo.thumb_path ?? photo.storage_path);
    paths.push(photo.storage_path);
  }

  const signed = await createSignedReadUrls(paths, SIGNED_URL_TTL_SECONDS);

  const items: GalleryItem[] = [];
  for (const photo of photos) {
    const best = bestByPhoto.get(photo.id);
    const thumbKey = photo.thumb_path ?? photo.storage_path;
    if (best && signed[thumbKey] && signed[photo.storage_path]) {
      items.push({
        id: photo.id,
        title: photo.title,
        unlocked: true,
        thumbUrl: signed[thumbKey],
        fullUrl: signed[photo.storage_path],
        bestTimeMs: best.best_time_ms,
        difficulty: (best.difficulty as Difficulty) ?? 3,
        unlockedAt: best.created_at,
      });
    } else {
      items.push({
        id: photo.id,
        title: photo.title,
        unlocked: false,
        hint: "拼好它就能看到啦",
      });
    }
  }
  return items;
}

export async function recordUnlock(params: {
  photoId: string;
  sessionId: string;
  difficulty: Difficulty;
  timeMs: number;
}): Promise<UnlockResult> {
  const { photoId, sessionId, difficulty, timeMs } = params;
  const supabase = getAdminClient();

  const photo = await getPhotoById(photoId);
  if (!photo || !photo.is_active) throw new PhotoNotFoundError();

  const { data: existing, error: readError } = await supabase
    .from("unlocks")
    .select("id, best_time_ms")
    .eq("photo_id", photoId)
    .eq("anon_session_id", sessionId)
    .eq("difficulty", difficulty)
    .maybeSingle();

  if (readError) throw new Error(`读取解锁记录失败：${readError.message}`);

  let bestTimeMs = timeMs;
  let isNewRecord = true;

  if (existing) {
    const previous = Number(existing.best_time_ms);
    if (timeMs < previous) {
      const { error } = await supabase
        .from("unlocks")
        .update({ best_time_ms: timeMs })
        .eq("id", existing.id);
      if (error) throw new Error(`更新最佳成绩失败：${error.message}`);
      bestTimeMs = timeMs;
    } else {
      bestTimeMs = previous;
      isNewRecord = false;
    }
  } else {
    const { error } = await supabase.from("unlocks").insert({
      photo_id: photoId,
      anon_session_id: sessionId,
      best_time_ms: timeMs,
      difficulty,
    });
    // 并发重复插入时唯一约束会报 23505，此时回读一次即可（幂等）
    if (error && !error.message.includes("duplicate key")) {
      throw new Error(`写入解锁记录失败：${error.message}`);
    }
  }

  const all = await listUnlocksForSession(sessionId);
  const totalUnlocked = new Set(all.map((row) => row.photo_id)).size;

  return {
    ok: true,
    unlockText: photo.unlock_text,
    bestTimeMs,
    isNewRecord,
    totalUnlocked,
  };
}
