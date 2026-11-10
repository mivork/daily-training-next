import { RIVAL_MAX, SCHEMA_VERSION, STORAGE_KEYS } from './constants';
import { clone, sanitizeCard, sanitizeExercise, sanitizePrefs, sanitizeProfile, sanitizeSettings } from './sanitize';
import { SEED_EXERCISES } from './constants';
import type { AppData } from './types';

export function loadJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function saveKey(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* localStorage から初期状態を読み込む（バニラ版 initState と同じ規則）。
   初回はシード種目を入れ、対戦カードIDが無ければ生成する。 */
export function loadInitialData(): AppData {
  const savedExercises = loadJSON(STORAGE_KEYS.exercises);
  let exercises;
  if (Array.isArray(savedExercises)) {
    exercises = savedExercises
      .map((raw) => sanitizeExercise(raw))
      .filter((ex): ex is NonNullable<typeof ex> => ex !== null);
  } else {
    exercises = clone(SEED_EXERCISES);
  }

  const savedRecords = loadJSON(STORAGE_KEYS.records);
  const records =
    savedRecords && typeof savedRecords === 'object' && !Array.isArray(savedRecords)
      ? (savedRecords as AppData['records'])
      : {};

  const settings = sanitizeSettings(loadJSON(STORAGE_KEYS.settings));

  const savedRivals = loadJSON(STORAGE_KEYS.rivals);
  const rivals: AppData['rivals'] = [];
  if (Array.isArray(savedRivals)) {
    savedRivals.forEach((raw) => {
      const card = sanitizeCard(raw);
      if (card && rivals.length < RIVAL_MAX) rivals.push(card);
    });
  }

  const profile = sanitizeProfile(loadJSON(STORAGE_KEYS.profile));
  const prefs = sanitizePrefs(loadJSON(STORAGE_KEYS.prefs));

  /* 対戦カードの固有ID。無ければ生成する。 */
  if (settings.cardId === '') {
    settings.cardId =
      'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  return { exercises, records, settings, profile, rivals, prefs };
}

/* データの各スライスを対応するキーへ保存する。失敗したキーがあれば false を返す。 */
export function persistSlices(data: AppData, slices: (keyof AppData)[]): boolean {
  let ok = true;
  for (const slice of slices) {
    const key = STORAGE_KEYS[slice as keyof typeof STORAGE_KEYS];
    if (!saveKey(key, data[slice])) ok = false;
  }
  return ok;
}

export function persistAll(data: AppData): boolean {
  return persistSlices(data, ['exercises', 'records', 'settings', 'profile', 'rivals', 'prefs']);
}

/* インポート前に退避したデータがあるか */
export function hasBackup(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.backup) !== null;
  } catch {
    return false;
  }
}

/* 現在のデータを、インポート前の退避用キーに保存する */
export function stashBackup(data: AppData): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEYS.backup,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        exercises: data.exercises,
        records: data.records,
        settings: data.settings,
        profile: data.profile,
        rivals: data.rivals,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function readBackup(): unknown {
  return loadJSON(STORAGE_KEYS.backup);
}

/* 全データ削除: 全キーを消す */
export function clearAllKeys(): void {
  try {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  } catch {
    /* そのまま初期化する */
  }
}
