/* 毎日トレーニング（Next.js版）: データの型定義
   データ形式はバニラ版と互換（localStorage のキーと書き出しJSONの形式を共有）。 */

export type Unit = '回' | '秒';

export interface Exercise {
  id: string;
  name: string;
  amount: number;
  unit: Unit;
  sets: number;
  note: string;
}

export type DayType = 'training' | 'rest';

/* 1日の記録。targets/names/amounts/units はその日のスナップショット。 */
export interface DayRecord {
  done: Record<string, number>;
  skipped?: Record<string, boolean>;
  short?: boolean;
  dayType?: DayType;
  targets?: Record<string, number>;
  names?: Record<string, string>;
  amounts?: Record<string, number>;
  units?: Record<string, string>;
}

export type RecordsMap = Record<string, DayRecord>;

export type TimeSlot = 'morning' | 'noon' | 'night' | 'undecided';

export interface Settings {
  shortGoalSets: number;
  shortWeekdays: number[];
  trainingWeekdays: number[];
  timeSlot: TimeSlot;
  timeValue: string;
  weeklyGoal: number;
  theme: '' | 'light' | 'dark';
  nickname: string;
  cardId: string;
}

export interface Profile {
  image: string;
  bio: string;
}

export interface Prefs {
  schemaVersion: number;
  guideDismissed: boolean;
  exportLastAt: string;
  mpYear: number | null;
  mpMonth: number | null;
  mpWeek: string;
  startPresetDone: boolean;
}

/* 対戦カード（自分のカードも友達のカードも同じ形） */
export interface RivalCard {
  type: 'daily-training-card';
  version: 1;
  cardId: string;
  nickname: string;
  bio: string;
  image: string | null;
  generatedAt: string;
  streak: number;
  bestStreak: number;
  weekDone: number;
  totalDays: number;
  totalSets: number;
  totalReps: number;
}

/* アプリ全体のデータ（localStorage / Supabase スナップショットの対象） */
export interface AppData {
  exercises: Exercise[];
  records: RecordsMap;
  settings: Settings;
  profile: Profile;
  rivals: RivalCard[];
  prefs: Prefs;
}

/* ロジック関数が参照する最小のデータ集合 */
export interface CoreData {
  exercises: Exercise[];
  records: RecordsMap;
  settings: Settings;
}

export interface DayEntry {
  id: string;
  name: string;
  target: number;
  done: number;
  amount: number | null;
  unit: string | null;
  skipped: boolean;
  countedDone: number;
}

export interface DayStats {
  entries: DayEntry[];
  totalTarget: number;
  totalDone: number;
  rate: number;
  complete: boolean;
  short: boolean;
  skippedCount: number;
}

export interface PeriodStats {
  trainingDays: number;
  completeDays: number;
  sets: number;
  reps: number;
  hasData: boolean;
  repsKnown: boolean;
  rate: number | null;
}

export interface ExerciseTotal {
  name: string;
  sets: number;
  reps: number;
  repsKnown: boolean;
}

/* インポート検証の結果 */
export type ImportResult =
  | {
      ok: true;
      data: {
        exercises: Exercise[];
        records: RecordsMap;
        settings: Settings;
        /* 旧形式の書き出しでは null（＝今のものを保持） */
        profile: Profile | null;
        rivals: RivalCard[] | null;
      };
    }
  | { ok: false; error: string };

/* Supabase に保存するスナップショット（prefs は端末ローカルのため含めない） */
export interface CloudSnapshot {
  exercises: Exercise[];
  records: RecordsMap;
  settings: Settings;
  profile: Profile;
  rivals: RivalCard[];
}
