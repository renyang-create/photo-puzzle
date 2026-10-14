import type { PhotoRow } from "./types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UnlockRow = {
  id: string;
  photo_id: string;
  anon_session_id: string;
  best_time_ms: number;
  difficulty: number;
  created_at: string;
  updated_at: string;
};

/**
 * 手写的 Database 类型（等价于 `supabase gen types typescript` 的输出结构）。
 * 保留它可以让 supabase-js 的查询结果自带类型，不需要再引入 Drizzle/Prisma。
 */
export interface Database {
  public: {
    Tables: {
      photos: {
        Row: PhotoRow;
        Insert: {
          id?: string;
          storage_path: string;
          thumb_path?: string | null;
          raw_path?: string | null;
          title?: string;
          unlock_text?: string;
          is_active?: boolean;
          sort_order?: number;
          width?: number | null;
          height?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PhotoRow, "id" | "created_at">>;
        Relationships: [];
      };
      unlocks: {
        Row: UnlockRow;
        Insert: {
          id?: string;
          photo_id: string;
          anon_session_id: string;
          best_time_ms: number;
          difficulty: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UnlockRow, "id" | "created_at">>;
        Relationships: [];
      };
      admin_credentials: {
        Row: { id: number; password_hash: string; updated_at: string };
        Insert: { id?: number; password_hash: string; updated_at?: string };
        Update: { id?: number; password_hash?: string; updated_at?: string };
        Relationships: [];
      };
      admin_users: {
        Row: { email: string; note: string | null; created_at: string };
        Insert: { email: string; note?: string | null; created_at?: string };
        Update: { email?: string; note?: string | null };
        Relationships: [];
      };
      admin_audit_log: {
        Row: {
          id: number;
          action: string;
          target_id: string | null;
          detail: Json;
          actor: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          action: string;
          target_id?: string | null;
          detail?: Json;
          actor?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
