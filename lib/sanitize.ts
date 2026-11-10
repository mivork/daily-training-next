import {
  DEFAULT_PREFS,
  DEFAULT_SETTINGS,
  PROFILE_BIO_MAX,
  PROFILE_IMAGE_MAX_LENGTH,
  SCHEMA_VERSION,
  TIME_SLOT_LABELS,
} from './constants';
import { mondayFromWeekValue } from './dates';
import type { Exercise, Prefs, Profile, RivalCard, Settings } from './types';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toInt(value: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof value === 'number' ? Math.trunc(value) : parseInt(String(value), 10);
  if (Number.isNaN(n)) n = fallback;
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}

export function uid(): string {
  return 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeExercise(raw: unknown, fallbackId?: string): Exercise | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : (fallbackId ?? uid()),
    name: raw.name.trim(),
    amount: toInt(raw.amount, 20, 1, 999),
    unit: raw.unit === '秒' ? '秒' : '回',
    sets: toInt(raw.sets, 2, 1, 10),
    note: typeof raw.note === 'string' ? raw.note : '',
  };
}

/* 曜日番号（0=日〜6=土）の配列を、重複なし・範囲内に整える。 */
export function sanitizeWeekdays(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return clone(fallback);
  const days: number[] = [];
  raw.forEach((d) => {
    const n = toInt(d, -1, 0, 6);
    if (n >= 0 && !days.includes(n)) days.push(n);
  });
  days.sort((a, b) => a - b);
  return days;
}

export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...clone(DEFAULT_SETTINGS) };
  if (isPlainObject(raw)) {
    s.shortGoalSets = toInt(raw.shortGoalSets, 1, 1, 10);
    s.shortWeekdays = sanitizeWeekdays(raw.shortWeekdays, DEFAULT_SETTINGS.shortWeekdays);
    s.trainingWeekdays = sanitizeWeekdays(raw.trainingWeekdays, DEFAULT_SETTINGS.trainingWeekdays);
    if (
      typeof raw.timeSlot === 'string' &&
      Object.prototype.hasOwnProperty.call(TIME_SLOT_LABELS, raw.timeSlot)
    ) {
      s.timeSlot = raw.timeSlot as Settings['timeSlot'];
    }
    if (typeof raw.timeValue === 'string' && /^\d{2}:\d{2}$/.test(raw.timeValue)) {
      s.timeValue = raw.timeValue;
    }
    s.weeklyGoal = toInt(raw.weeklyGoal, 0, 0, 7);
    if (raw.theme === 'light' || raw.theme === 'dark') {
      s.theme = raw.theme;
    }
    if (typeof raw.nickname === 'string') {
      s.nickname = raw.nickname.trim().slice(0, 20);
    }
    if (typeof raw.cardId === 'string' && raw.cardId !== '') {
      s.cardId = raw.cardId.slice(0, 64);
    }
  }
  return s;
}

/* prefs（案内の表示状態・マイページの期間選択・最終書き出し日）を整える。 */
export function sanitizePrefs(raw: unknown): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS };
  if (isPlainObject(raw)) {
    p.schemaVersion = SCHEMA_VERSION;
    p.guideDismissed = raw.guideDismissed === true;
    p.startPresetDone = raw.startPresetDone === true;
    if (typeof raw.exportLastAt === 'string') p.exportLastAt = raw.exportLastAt.slice(0, 40);
    if (typeof raw.mpYear === 'number' && Number.isFinite(raw.mpYear)) {
      p.mpYear = Math.min(9999, Math.max(1, Math.floor(raw.mpYear)));
    }
    if (typeof raw.mpMonth === 'number' && Number.isFinite(raw.mpMonth)) {
      p.mpMonth = Math.min(11, Math.max(0, Math.floor(raw.mpMonth)));
    }
    if (typeof raw.mpWeek === 'string' && mondayFromWeekValue(raw.mpWeek) !== null) {
      p.mpWeek = raw.mpWeek;
    }
  }
  return p;
}

/* プロフィール（画像・紹介文）を検証して整える。
   画像は data URL の画像だけを受け付け、容量上限を超えるものは捨てる。 */
export function sanitizeProfile(raw: unknown): Profile {
  const profile: Profile = { image: '', bio: '' };
  if (isPlainObject(raw)) {
    if (
      typeof raw.image === 'string' &&
      raw.image.startsWith('data:image/') &&
      raw.image.length <= PROFILE_IMAGE_MAX_LENGTH
    ) {
      profile.image = raw.image;
    }
    if (typeof raw.bio === 'string') {
      profile.bio = raw.bio.slice(0, PROFILE_BIO_MAX);
    }
  }
  return profile;
}

/* 取り込んだ対戦カードを検証して整える。形式が違う場合は null。 */
export function sanitizeCard(raw: unknown): RivalCard | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type !== 'daily-training-card' || raw.version !== 1) return null;
  return {
    type: 'daily-training-card',
    version: 1,
    /* カード固有ID。無い旧形式カードでは '' になり、照合はニックネームで行う */
    cardId: typeof raw.cardId === 'string' ? raw.cardId.slice(0, 64) : '',
    nickname:
      typeof raw.nickname === 'string' && raw.nickname.trim() !== ''
        ? raw.nickname.trim().slice(0, 20)
        : '友達',
    /* 紹介文と画像は任意項目。無い旧形式カードも取り込めるようにする */
    bio: typeof raw.bio === 'string' ? raw.bio.slice(0, PROFILE_BIO_MAX) : '',
    image:
      typeof raw.image === 'string' &&
      raw.image.startsWith('data:image/') &&
      raw.image.length <= PROFILE_IMAGE_MAX_LENGTH
        ? raw.image
        : null,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 10) : '',
    streak: toInt(raw.streak, 0, 0, 100000000),
    bestStreak: toInt(raw.bestStreak, 0, 0, 100000000),
    weekDone: toInt(raw.weekDone, 0, 0, 100000000),
    totalDays: toInt(raw.totalDays, 0, 0, 100000000),
    totalSets: toInt(raw.totalSets, 0, 0, 100000000),
    totalReps: toInt(raw.totalReps, 0, 0, 100000000),
  };
}
