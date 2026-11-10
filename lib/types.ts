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
  /* オンラインランキングへの参加（opt-in）。既定はオフ。
     旧データに項目が無い場合はオフとして扱う（後方互換）。 */
  rankingOptIn: boolean;
}

export interface Profile {
  image: string;
  bio: string;
}

export interface Prefs {
  schemaVersion: number;
  guideDismissed: boolean;
  /* 初回の実践型ガイド（ステップ案内）を閉じたかどうか。
     旧データに項目が無い場合は false（未表示）として扱う（後方互換）。 */
  practiceGuideDismissed: boolean;
  /* スライド式チュートリアルを見た（最後まで進めた、またはスキップした）かどうか。
     旧データに項目が無い場合は false（未表示）として扱う（後方互換）。 */
  tutorialSeen: boolean;
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

/* 種目別の合計回数（「回」の種目だけ。グラフ表示用） */
export interface ExerciseRepTotal {
  name: string;
  reps: number;
}

/* 週ごとの推移グラフの1点（月曜はじまりの週） */
export interface WeekTrendPoint {
  mondayKey: string;
  label: string;
  completeDays: number;
  trainingDays: number;
  /* トレーニング日が無い週は null（グラフでは線を切る） */
  rate: number | null;
}

/* 年間ヒートマップの1日の状態 */
export type HeatmapState = 'done' | 'done-short' | 'rest' | 'missed' | 'future';

export interface HeatmapDay {
  key: string;
  state: HeatmapState;
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

/* オンラインランキングの指標キー */
export type RankingMetricKey = 'week' | 'streak' | 'total';

/* ランキングに送る自分の集計値（dt_rankings の列に対応） */
export interface RankingValues {
  weekDone: number;
  streak: number;
  totalDays: number;
  totalSets: number;
}

/* dt_rankings の1行（ランキング画面の表示用） */
export interface RankingRow {
  userId: string;
  nickname: string;
  weekDone: number;
  streak: number;
  totalDays: number;
  totalSets: number;
  updatedAt: string;
}

/* 順位を付けたランキング行。同点は同じ順位にする（競技順位方式） */
export interface RankedRankingRow extends RankingRow {
  rank: number;
}

/* 「次にやること」カードの内容。今日まだ終わっていない最初の種目と、
   その次に控えている種目（予告用）を表す。すべて終わっていれば null を返す算出側の都合で、
   after は「その次」の種目が無ければ null。 */
export interface NextAction {
  exerciseId: string;
  name: string;
  /* 次に記録するセットの番号（0 はじまり） */
  setIndex: number;
  done: number;
  target: number;
  amount: number | null;
  unit: string | null;
  after: { exerciseId: string; name: string } | null;
}

/* Supabase に保存するスナップショット（prefs は端末ローカルのため含めない） */
export interface CloudSnapshot {
  exercises: Exercise[];
  records: RecordsMap;
  settings: Settings;
  profile: Profile;
  rivals: RivalCard[];
}
