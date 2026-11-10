import { WEEKDAYS_JA } from './constants';

/* 日付キー（YYYY-MM-DD、ローカル時刻） */
export function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseKey(key: string): Date {
  const parts = key.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

export function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

export function formatDateJa(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS_JA[date.getDay()]}）`;
}

export function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/* 月曜はじまりの週の開始日 */
export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* 日付から input[type=week] 用の ISO週文字列（例: 2026-W46）を作る */
export function isoWeekValue(date: Date): string {
  const monday = startOfWeekMonday(date);
  const thursday = addDays(monday, 3);
  const isoYear = thursday.getFullYear();
  const week1Monday = startOfWeekMonday(new Date(isoYear, 0, 4));
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/* ISO週文字列からその週の月曜を返す。読めない値なら null（＝今週として扱う）。 */
export function mondayFromWeekValue(value: unknown): Date | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const week1Monday = startOfWeekMonday(new Date(Number(m[1]), 0, 4));
  return addDays(week1Monday, (week - 1) * 7);
}

/* 記録の日付キーとして正しいか（形式と実在する日付か） */
export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const parts = key.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
