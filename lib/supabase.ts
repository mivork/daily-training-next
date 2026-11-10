import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* Supabase 連携。環境変数が無い場合は「未設定モード」になり、クライアントは生成されない。
   未設定モードではログインできないためアプリ本体には入れず、ゲート画面で案内を出す。
   データ自体は localStorage にも保存される（ログイン時の同期先が Supabase）。 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return url !== '' && anonKey !== '';
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(url, anonKey);
  }
  return client;
}
