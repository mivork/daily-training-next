import type { Exercise, Prefs, RankingMetricKey, Settings } from './types';

/* localStorage のキー。バニラ版と完全に同じ（データ互換のため）。 */
export const STORAGE_KEYS = {
  exercises: 'dailyTraining.exercises.v1',
  records: 'dailyTraining.records.v1',
  settings: 'dailyTraining.settings.v1',
  rivals: 'dailyTraining.rivals.v1',
  profile: 'dailyTraining.profile.v1',
  prefs: 'dailyTraining.prefs.v1',
  backup: 'dailyTraining.backup.v1',
} as const;

/* 同期メタ情報（端末ローカル専用。書き出しJSONには含めない）。 */
export const SYNC_META_KEY = 'dailyTraining.sync.v1';

/* 書き出しJSONの形式バージョン。保存データ側にも同じ値を持つ。 */
export const SCHEMA_VERSION = 1;

/* ファイル読み込み前の上限。件数の上限もここで管理する。 */
export const FILE_LIMITS = {
  jsonBytes: 5 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  exercisesMax: 200,
  rivalsMax: 5,
} as const;

/* プロフィール画像: 最大256×256に縮小し、data URL の目安は約300KB。
   取り込み時の上限は余裕を持たせて約500KB。 */
export const PROFILE_IMAGE_MAX_PX = 256;
export const PROFILE_IMAGE_TARGET_LENGTH = 300000;
export const PROFILE_IMAGE_MAX_LENGTH = 500000;
export const PROFILE_BIO_MAX = 200;

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/* はじめのメニュー（テンプレート）。すべて編集・削除できる。 */
export const SEED_EXERCISES: Exercise[] = [
  { id: 'ex-pushup', name: '腕立て伏せ', amount: 20, unit: '回', sets: 2, note: '' },
  { id: 'ex-crunch', name: 'クランチ', amount: 30, unit: '回', sets: 2, note: 'お尻は地面につけたまま' },
  { id: 'ex-hip-lift', name: 'ヒップリフト', amount: 20, unit: '回', sets: 2, note: '' },
  { id: 'ex-back', name: '背筋', amount: 30, unit: '回', sets: 2, note: '小さく持ち上げるだけ。腰に違和感がある日は半分でもOK' },
  { id: 'ex-calf', name: 'つま先立ち', amount: 30, unit: '回', sets: 2, note: 'ゆっくり。壁に手をついてOK' },
  { id: 'ex-plank', name: 'プランク', amount: 30, unit: '秒', sets: 2, note: '' },
];

export const DEFAULT_SETTINGS: Settings = {
  shortGoalSets: 1,
  shortWeekdays: [],
  trainingWeekdays: [0, 1, 2, 3, 4, 5, 6],
  timeSlot: 'undecided',
  timeValue: '',
  weeklyGoal: 0,
  theme: '',
  nickname: '',
  cardId: '',
  rankingOptIn: false,
};

/* アプリの細かな状態（案内の表示、マイページの期間選択、最終書き出し日）。
   データ本体とは別のキーに分けて保存する。 */
export const DEFAULT_PREFS: Prefs = {
  schemaVersion: SCHEMA_VERSION,
  guideDismissed: false,
  practiceGuideDismissed: false,
  tutorialSeen: false,
  exportLastAt: '',
  mpYear: null,
  mpMonth: null,
  mpWeek: '',
  startPresetDone: false,
};

export interface ExerciseTemplate {
  name: string;
  amount: number;
  unit: '回' | '秒';
  sets: number;
  note: string;
}

/* 種目のテンプレート。「テンプレートから追加」で1タップ追加できる。
   同じ名前の種目がすでにある場合は追加しない。 */
export const EXERCISE_TEMPLATES: ExerciseTemplate[] = [
  { name: 'スクワット', amount: 20, unit: '回', sets: 2, note: 'ひざはつま先より前に出しすぎない' },
  { name: 'ランジ', amount: 10, unit: '回', sets: 2, note: '左右交互に。バランスが不安なら壁に手をつく' },
  { name: '壁腕立て', amount: 15, unit: '回', sets: 2, note: '壁に手をついて行う、やさしい腕立て伏せ' },
  { name: '腹筋（クランチ）', amount: 20, unit: '回', sets: 2, note: 'お尻は地面につけたまま' },
  { name: 'ヒップリフト', amount: 15, unit: '回', sets: 2, note: '' },
  { name: '背筋', amount: 15, unit: '回', sets: 2, note: '小さく持ち上げるだけ' },
  { name: 'つま先立ち', amount: 20, unit: '回', sets: 2, note: 'ゆっくり。壁に手をついてOK' },
  { name: 'プランク', amount: 30, unit: '秒', sets: 2, note: '' },
  { name: 'サイドプランク', amount: 20, unit: '秒', sets: 2, note: '左右それぞれ' },
  { name: 'もも上げ', amount: 30, unit: '回', sets: 2, note: 'その場で足踏みするように' },
];

/* やる時間の時間帯ラベル。「決めていない」は予定表示に出さない。 */
export const TIME_SLOT_LABELS: Record<Settings['timeSlot'], string> = {
  morning: '朝',
  noon: '昼',
  night: '夜',
  undecided: '',
};

/* Museのアドバイスの文言。記録をもとにアプリの中でルールで選ぶ。 */
export const ADVICE_TEXTS = {
  rest: '今日は休みの日です。体を休めることも、続けるための大切な一部です。次のトレーニング日に向けて、ゆっくり過ごしましょう。',
  done: '今日は完了しました。おつかれさまです。よく頑張りました。明日も自分のペースでいきましょう。',
  retryShort: '前回のトレーニング日はお休みでしたね。今日は短縮モードで1セットだけでも大丈夫です。少し動かせば、それで十分な一歩です。',
  easeOff: '最近は少し大変だったかもしれません。短縮日にする曜日を増やしたり、セット数を減らしたりして、続けやすい形にしてみましょう。',
  streakLong: 'トレーニングの日が7日以上続けて完了しています。すばらしい継続です。回数を増やさず、この調子を大切にしましょう。',
  streak: '続いていますね。その積み重ねが力になります。今日もいつも通りでいきましょう。',
  first: '記録はまだありません。まずは1種目・1セットからで大丈夫です。小さく始めて、慣れてきたら増やしていきましょう。',
  shortDay: '今日は短縮の日です。各種目1セットで完了になります。気軽に取り組みましょう。',
  fallback: '各種目、ゆっくりていねいな動きを意識して行いましょう。呼吸を止めずに進めるのがコツです。',
} as const;

export type AdviceKey = keyof typeof ADVICE_TEXTS;

export const RIVAL_MAX = 5;

export const RIVAL_METRICS = [
  { key: 'streak', label: '現在の連続日数', suffix: '日' },
  { key: 'bestStreak', label: '最長連続日数', suffix: '日' },
  { key: 'weekDone', label: '今週の完了日数', suffix: '日' },
  { key: 'totalDays', label: '総完了日数', suffix: '日' },
  { key: 'totalSets', label: '総完了セット数', suffix: 'セット' },
  { key: 'totalReps', label: '合計回数', suffix: '回' },
] as const;

export type RivalMetricKey = (typeof RIVAL_METRICS)[number]['key'];

export const VIEW_NAMES = ['today', 'menu', 'ranking', 'mypage', 'settings'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/* オンラインランキングの指標。key は画面側の識別子、column は dt_rankings の列名。 */
export const RANKING_METRICS: {
  key: RankingMetricKey;
  column: 'week_done' | 'streak' | 'total_days';
  label: string;
  unit: string;
}[] = [
  { key: 'week', column: 'week_done', label: '今週', unit: '日' },
  { key: 'streak', column: 'streak', label: '連続', unit: '日' },
  { key: 'total', column: 'total_days', label: '累計', unit: '日' },
];

/* ランキングに表示する上限件数 */
export const RANKING_LIMIT = 50;
