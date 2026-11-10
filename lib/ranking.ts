import { RANKING_LIMIT, RANKING_METRICS } from './constants';
import { isPlainObject, toInt } from './sanitize';
import { getSupabase } from './supabase';
import type { RankingMetricKey, RankingRow } from './types';

/* オンラインランキング（dt_rankings）の読み取り。
   RLS で SELECT は全員可なので、未ログインでも閲覧できる。
   書き込み（自分の行の upsert / 削除）は lib/store.tsx 側で行う。 */

function sanitizeRankingRow(raw: unknown): RankingRow | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.user_id !== 'string' || raw.user_id === '') return null;
  return {
    userId: raw.user_id,
    nickname:
      typeof raw.nickname === 'string' && raw.nickname.trim() !== ''
        ? raw.nickname.trim().slice(0, 20)
        : 'ゲスト',
    weekDone: toInt(raw.week_done, 0, 0, 100000000),
    streak: toInt(raw.streak, 0, 0, 100000000),
    totalDays: toInt(raw.total_days, 0, 0, 100000000),
    totalSets: toInt(raw.total_sets, 0, 0, 100000000),
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  };
}

const ROW_COLUMNS = 'user_id, nickname, week_done, streak, total_days, total_sets, updated_at';

function columnOf(metric: RankingMetricKey): string {
  return RANKING_METRICS.find((m) => m.key === metric)?.column ?? 'total_days';
}

export type RankingFetchResult =
  | { ok: true; rows: RankingRow[] }
  | { ok: false; error: string };

/* 指標の降順で上位 RANKING_LIMIT 件を取得する */
export async function fetchRankingTop(metric: RankingMetricKey): Promise<RankingFetchResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'クラウド連携が設定されていません。' };
  const { data, error } = await supabase
    .from('dt_rankings')
    .select(ROW_COLUMNS)
    .order(columnOf(metric), { ascending: false })
    .limit(RANKING_LIMIT);
  if (error) {
    return { ok: false, error: 'ランキングを読み込めませんでした。通信環境を確認して、もう一度お試しください。' };
  }
  const rows = (data ?? [])
    .map(sanitizeRankingRow)
    .filter((r): r is RankingRow => r !== null);
  return { ok: true, rows };
}

export interface MyStanding {
  rank: number;
  row: RankingRow;
}

/* 自分の順位を出す。上位に自分の行が無い場合のために、自分の行と
   「自分より値が大きい行の数」を数えて順位（同点は同じ順位）を計算する。
   ランキングに参加していない（行が無い）場合は null。 */
export async function fetchMyStanding(
  userId: string,
  metric: RankingMetricKey,
): Promise<MyStanding | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data: myData, error: myError } = await supabase
    .from('dt_rankings')
    .select(ROW_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (myError || !myData) return null;
  const row = sanitizeRankingRow(myData);
  if (!row) return null;
  const column = columnOf(metric);
  const myValue =
    metric === 'week' ? row.weekDone : metric === 'streak' ? row.streak : row.totalDays;
  const { count, error: countError } = await supabase
    .from('dt_rankings')
    .select('user_id', { count: 'exact', head: true })
    .gt(column, myValue);
  if (countError) return null;
  return { rank: (count ?? 0) + 1, row };
}
