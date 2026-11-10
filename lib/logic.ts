import {
  ADVICE_TEXTS,
  type AdviceKey,
  BODY_MOVING_AVERAGE_WINDOW,
  HEIGHT_RANGE,
  TIME_SLOT_LABELS,
} from './constants';
import {
  addDays,
  dateKeyOf,
  formatDateJa,
  formatShortDate,
  parseKey,
  startOfWeekMonday,
  todayDate,
} from './dates';
import { toInt } from './sanitize';
import type {
  BodyData,
  BodyEntry,
  BodyField,
  BodyPeriodComparison,
  BodyPeriodFieldStats,
  BodyPeriodKind,
  BodyPoint,
  BodySummary,
  CoreData,
  DayRecord,
  DayStats,
  Exercise,
  ExerciseRepTotal,
  ExerciseSetTotal,
  ExerciseTotal,
  HeatmapDay,
  HeatmapState,
  Insight,
  NextAction,
  PeriodStats,
  RankedRankingRow,
  RankingMetricKey,
  RankingRow,
  RankingValues,
  WeekTrendPoint,
  WeekdayRate,
} from './types';

/* ===== 日種別・短縮の判定 ===== */

/* その日が短縮日かどうか（設定で選んだ曜日かどうか） */
export function defaultShortFor(data: CoreData, date: Date): boolean {
  return data.settings.shortWeekdays.includes(date.getDay());
}

/* 設定の「トレーニングする曜日」に含まれる日かどうか（現在の設定でのライブ判定） */
export function isTrainingDay(data: CoreData, date: Date): boolean {
  return data.settings.trainingWeekdays.includes(date.getDay());
}

export function getRecord(data: CoreData, key: string): DayRecord | null {
  return data.records[key] ?? null;
}

/* 記録に保存済みの日種別。無い記録は null。
   記録を作る時点でその日の種別を固定し、後の設定変更で過去が変わらないようにする。 */
export function storedDayType(data: CoreData, key: string): 'training' | 'rest' | null {
  const record = getRecord(data, key);
  if (record && (record.dayType === 'training' || record.dayType === 'rest')) {
    return record.dayType;
  }
  return null;
}

/* その日がトレーニング日かどうか。保存済みの種別があればそれを使い、
   無ければ（旧形式の記録や未記録の日）現在の設定で判定する（後方互換）。 */
export function isTrainingRecordDay(data: CoreData, key: string, date: Date): boolean {
  const stored = storedDayType(data, key);
  if (stored !== null) return stored === 'training';
  return isTrainingDay(data, date);
}

/* 今日の実効値: 保存済みの記録があればそれ（手動トグルが優先）、
   なければ設定の曜日選択から初期値を決める。 */
export function effectiveShort(data: CoreData, key: string, date: Date): boolean {
  const record = getRecord(data, key);
  if (record && typeof record.short === 'boolean') return record.short;
  return defaultShortFor(data, date);
}

/* 日種別: 'rest'（休みの日）/ 'short'（短縮日）/ 'normal'（通常日） */
export function dayKindFor(data: CoreData, key: string, date: Date): 'rest' | 'short' | 'normal' {
  if (!isTrainingRecordDay(data, key, date)) return 'rest';
  return effectiveShort(data, key, date) ? 'short' : 'normal';
}

/* 「今日の予定」に出す時間の文言。時間帯が「決めていない」で時刻も無い場合は空。 */
export function timeTextFor(data: CoreData): string {
  const label = TIME_SLOT_LABELS[data.settings.timeSlot] || '';
  const value = data.settings.timeValue;
  if (label && value) return `${label} ${value}ごろ`;
  if (value) return `${value}ごろ`;
  return label;
}

export function targetSetsFor(data: CoreData, exercise: Exercise, short: boolean): number {
  return short ? Math.min(exercise.sets, data.settings.shortGoalSets) : exercise.sets;
}

/* ===== スナップショット =====
   その日のスナップショット（種目名・目標セット数・回数/秒数・単位）を記録に残す。
   種目を後で消したり変えたりしても、その日の履歴や集計が壊れないようにするため。
   目標セット数は短縮を適用しない素のセット数（base）を保存し、短縮の適用は
   dayStats 側で record.short を見て行う。
   一度保存した種目の目標は上書きしない。当日あとから追加された種目だけが加わる。 */
export function refreshSnapshot(data: CoreData, record: DayRecord): void {
  if (!record.targets || typeof record.targets !== 'object') record.targets = {};
  if (!record.names || typeof record.names !== 'object') record.names = {};
  if (!record.amounts || typeof record.amounts !== 'object') record.amounts = {};
  if (!record.units || typeof record.units !== 'object') record.units = {};
  data.exercises.forEach((ex) => {
    if (typeof record.targets![ex.id] !== 'number') {
      record.targets![ex.id] = ex.sets;
      record.names![ex.id] = ex.name;
      record.amounts![ex.id] = ex.amount;
      record.units![ex.id] = ex.unit;
    }
  });
}

/* スナップショットを現在の種目で作り直す（過去日の編集で新規に記録を作るときだけ使う）。 */
export function writeSnapshot(data: CoreData, record: DayRecord): void {
  record.targets = {};
  record.names = {};
  record.amounts = {};
  record.units = {};
  data.exercises.forEach((ex) => {
    record.targets![ex.id] = ex.sets;
    record.names![ex.id] = ex.name;
    record.amounts![ex.id] = ex.amount;
    record.units![ex.id] = ex.unit;
  });
}

/* その日にスキップされた種目かどうか。skipped の無い旧記録でも安全に読む。 */
export function isSkippedIn(record: DayRecord | null, id: string): boolean {
  return !!(
    record &&
    record.skipped &&
    typeof record.skipped === 'object' &&
    record.skipped[id] === true
  );
}

/* ===== 1日の統計 =====
   スナップショットがあればそれを使い、なければ現在の種目で計算する。
   スキップした種目は「実施した」扱いにせず、完了率の分母と完了セット数・
   合計回数（countedDone 経由）からも外す。ただし全種目が
   「完了またはスキップ」なら、その日は完了として扱う。 */
export function dayStats(data: CoreData, key: string): DayStats {
  const record = getRecord(data, key);
  const date = parseKey(key);
  const short =
    record && typeof record.short === 'boolean' ? record.short : defaultShortFor(data, date);
  const entries: DayStats['entries'] = [];
  let totalTarget = 0;
  let totalDone = 0;
  let skippedCount = 0;

  const pushEntry = (entry: DayStats['entries'][number]) => {
    entries.push(entry);
    if (entry.skipped) {
      skippedCount += 1;
    } else {
      totalTarget += entry.target;
      totalDone += entry.done;
    }
  };

  if (record && record.targets && typeof record.targets === 'object') {
    Object.keys(record.targets).forEach((id) => {
      const baseTarget = toInt(record.targets![id], 0, 0, 999);
      /* スナップショットの目標は素のセット数。短縮日はここで絞る。
         旧形式の記録（短縮適用済みの目標が保存されている）でも min のため結果は同じ。 */
      const target = short ? Math.min(baseTarget, data.settings.shortGoalSets) : baseTarget;
      const doneRaw = record.done && typeof record.done[id] === 'number' ? record.done[id] : 0;
      const done = Math.min(doneRaw, target);
      const name =
        record.names && typeof record.names[id] === 'string' ? record.names[id] : '削除済みの種目';
      let amount =
        record.amounts && typeof record.amounts[id] === 'number' ? record.amounts[id] : null;
      let unit = record.units && typeof record.units[id] === 'string' ? record.units[id] : null;
      if (amount === null || unit === null) {
        const current = data.exercises.find((ex) => ex.id === id) ?? null;
        if (current) {
          if (amount === null) amount = current.amount;
          if (unit === null) unit = current.unit;
        }
      }
      const skipped = isSkippedIn(record, id);
      pushEntry({
        id,
        name,
        target,
        done,
        amount,
        unit,
        skipped,
        countedDone: skipped ? 0 : done,
      });
    });
  } else {
    data.exercises.forEach((ex) => {
      const target = targetSetsFor(data, ex, short);
      const doneRaw =
        record && record.done && typeof record.done[ex.id] === 'number' ? record.done[ex.id] : 0;
      const done = Math.min(doneRaw, target);
      const skipped = isSkippedIn(record, ex.id);
      pushEntry({
        id: ex.id,
        name: ex.name,
        target,
        done,
        amount: ex.amount,
        unit: ex.unit,
        skipped,
        countedDone: skipped ? 0 : done,
      });
    });
    /* 現在の種目に無いIDの記録があっても壊れないように名前だけ拾う */
    if (record && record.done) {
      Object.keys(record.done).forEach((id) => {
        const known = data.exercises.some((ex) => ex.id === id);
        if (!known) {
          entries.push({
            id,
            name: '削除済みの種目',
            target: 0,
            done: 0,
            amount: null,
            unit: null,
            skipped: false,
            countedDone: 0,
          });
        }
      });
    }
  }

  /* 完了 = 目標のある種目がすべて「完了またはスキップ」 */
  const countable = entries.filter((e) => e.target > 0);
  const complete =
    countable.length > 0 && countable.every((e) => e.skipped || e.done >= e.target);
  const rate = totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : complete ? 100 : 0;
  return { entries, totalTarget, totalDone, rate, complete, short, skippedCount };
}

/* ===== 連続日数 =====
   トレーニングする日だけを対象に、完了が何日続いているかを数える。
   休みの日はスキップして数え、連続を切らない。
   今日がトレーニング日でまだ未完了なら、昨日以前から数える。 */
export function calcStreak(data: CoreData): number {
  let streak = 0;
  let cursor = todayDate();
  if (isTrainingRecordDay(data, dateKeyOf(cursor), cursor) && !dayStats(data, dateKeyOf(cursor)).complete) {
    cursor = addDays(cursor, -1);
  }
  let guard = 0;
  while (guard < 3660) {
    guard += 1;
    if (isTrainingRecordDay(data, dateKeyOf(cursor), cursor)) {
      if (dayStats(data, dateKeyOf(cursor)).complete) {
        streak += 1;
      } else {
        break;
      }
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* 全期間を通しての最長連続日数。トレーニングの日だけを数え、
   休みの日はスキップして連続を切らない。 */
export function calcLongestStreak(data: CoreData): number {
  const keys = Object.keys(data.records);
  if (keys.length === 0) return 0;
  keys.sort();
  let cursor = parseKey(keys[0]);
  const today = todayDate();
  let longest = 0;
  let current = 0;
  let guard = 0;
  while (cursor <= today && guard < 36600) {
    guard += 1;
    if (isTrainingRecordDay(data, dateKeyOf(cursor), cursor)) {
      if (dayStats(data, dateKeyOf(cursor)).complete) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return longest;
}

/* ===== 期間集計（マイページ用） =====
   start から end（含む）までの期間集計。未来の日は数えない。
   スナップショットをもとに計算するので、種目を削除・変更しても過去の集計は壊れない。 */
export function periodStats(data: CoreData, start: Date, end: Date): PeriodStats {
  const today = todayDate();
  const result: PeriodStats = {
    trainingDays: 0,
    completeDays: 0,
    sets: 0,
    reps: 0,
    hasData: false,
    repsKnown: false,
    rate: null,
  };
  let last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (last > today) last = today;
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= last) {
    const key = dateKeyOf(cursor);
    if (getRecord(data, key)) result.hasData = true;
    const stats = dayStats(data, key);
    if (isTrainingRecordDay(data, key, cursor)) {
      result.trainingDays += 1;
      if (stats.complete) result.completeDays += 1;
    }
    result.sets += stats.totalDone;
    stats.entries.forEach((entry) => {
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        result.repsKnown = true;
        /* スキップした種目は数えない（countedDone はスキップ時 0） */
        result.reps += entry.countedDone * entry.amount;
      }
    });
    cursor = addDays(cursor, 1);
  }
  if (result.trainingDays > 0) {
    result.rate = Math.round((result.completeDays / result.trainingDays) * 100);
  }
  return result;
}

/* 今週（月曜〜日曜）の進捗。done は今日までの完了したトレーニング日、
   remaining は今日（未完了なら）と今後のトレーニング日の数。 */
export function weekProgressStats(data: CoreData): { done: number; remaining: number } {
  const today = todayDate();
  const monday = startOfWeekMonday(today);
  let done = 0;
  let remaining = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (!isTrainingRecordDay(data, dateKeyOf(d), d)) continue;
    const complete = dayStats(data, dateKeyOf(d)).complete;
    if (d < today) {
      if (complete) done += 1;
    } else if (d.getTime() === today.getTime()) {
      if (complete) done += 1;
      else remaining += 1;
    } else {
      remaining += 1;
    }
  }
  return { done, remaining };
}

/* 種目別の累計。全記録のスナップショットを種目名ごとに集計する。
   削除した種目も、その日のスナップショット名で含める。 */
export function exerciseTotals(data: CoreData): ExerciseTotal[] {
  const byName = new Map<string, ExerciseTotal>();
  Object.keys(data.records).forEach((key) => {
    dayStats(data, key).entries.forEach((entry) => {
      let total = byName.get(entry.name);
      if (!total) {
        total = { name: entry.name, sets: 0, reps: 0, repsKnown: false };
        byName.set(entry.name, total);
      }
      total.sets += entry.countedDone;
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        total.repsKnown = true;
        total.reps += entry.countedDone * entry.amount;
      }
    });
  });
  const list = [...byName.values()].filter((t) => t.sets > 0);
  list.sort((a, b) => {
    if (b.sets !== a.sets) return b.sets - a.sets;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return list;
}

/* 全期間の累計。スナップショットをもとに計算する。 */
export function allTimeTotals(data: CoreData): {
  totalDays: number;
  totalSets: number;
  totalReps: number;
} {
  const totals = { totalDays: 0, totalSets: 0, totalReps: 0 };
  Object.keys(data.records).forEach((key) => {
    const stats = dayStats(data, key);
    if (isTrainingRecordDay(data, key, parseKey(key)) && stats.complete) totals.totalDays += 1;
    totals.totalSets += stats.totalDone;
    stats.entries.forEach((entry) => {
      if (entry.unit === '回' && typeof entry.amount === 'number') {
        totals.totalReps += entry.countedDone * entry.amount;
      }
    });
  });
  return totals;
}

/* ===== オンラインランキング用集計 =====
   定義は対戦カード（buildOwnCard）やマイページの集計と揃える:
   weekDone = 今週の完了日数（weekProgressStats.done。分母はトレーニング日のみ）、
   streak = 現在の連続日数（calcStreak）、
   totalDays / totalSets = 累計の完了日数・完了セット数（allTimeTotals）。 */
export function rankingValuesOf(data: CoreData): RankingValues {
  const totals = allTimeTotals(data);
  return {
    weekDone: weekProgressStats(data).done,
    streak: calcStreak(data),
    totalDays: totals.totalDays,
    totalSets: totals.totalSets,
  };
}

/* ランキングに表示するニックネーム。プロフィールで設定するニックネームは
   settings.nickname に保存されている。未設定なら「ゲスト」にする。 */
export function rankingNicknameOf(data: CoreData): string {
  const n = data.settings.nickname.trim();
  return n !== '' ? n : 'ゲスト';
}

/* 指標キーからランキング行の値を取り出す */
export function rankingMetricValue(row: RankingRow, metric: RankingMetricKey): number {
  if (metric === 'week') return row.weekDone;
  if (metric === 'streak') return row.streak;
  return row.totalDays;
}

/* ランキング行を指標の降順に並べ、順位を付ける。
   同じ値の行は同じ順位（競技順位方式: 1位, 1位, 3位…）。
   並び順を安定させるため、同点のときはニックネーム→ユーザーID順にする。 */
export function rankRankingRows(rows: RankingRow[], metric: RankingMetricKey): RankedRankingRow[] {
  const sorted = [...rows].sort((a, b) => {
    const diff = rankingMetricValue(b, metric) - rankingMetricValue(a, metric);
    if (diff !== 0) return diff;
    if (a.nickname !== b.nickname) return a.nickname < b.nickname ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  let prevValue: number | null = null;
  let prevRank = 0;
  return sorted.map((row, index) => {
    const value = rankingMetricValue(row, metric);
    const rank = prevValue !== null && value === prevValue ? prevRank : index + 1;
    prevValue = value;
    prevRank = rank;
    return { ...row, rank };
  });
}

/* ===== グラフ用集計（マイページ） ===== */

/* 週ごとの推移: 今週を含む直近 weekCount 週（月曜はじまり、古い週→新しい週の順）。
   各週の完了日数と完了率は periodStats で出す。今週は今日までの集計になるため、
   完了率の分母（トレーニング日）も今日までだけが数えられる。
   トレーニング日が無い週は rate が null になる（グラフでは線を切る）。 */
export function weeklyTrend(data: CoreData, weekCount = 12): WeekTrendPoint[] {
  const thisMonday = startOfWeekMonday(todayDate());
  const points: WeekTrendPoint[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const sunday = addDays(monday, 6);
    const stats = periodStats(data, monday, sunday);
    points.push({
      mondayKey: dateKeyOf(monday),
      label: `${monday.getMonth() + 1}/${monday.getDate()}`,
      completeDays: stats.completeDays,
      trainingDays: stats.trainingDays,
      rate: stats.rate,
    });
  }
  return points;
}

/* 月別の完了日数: 指定した年の1月〜12月（要素数12）。月別グラフ用。 */
export function monthlyCompleteDays(data: CoreData, year: number): number[] {
  const counts: number[] = [];
  for (let m = 0; m < 12; m++) {
    counts.push(periodStats(data, new Date(year, m, 1), new Date(year, m + 1, 0)).completeDays);
  }
  return counts;
}

/* 種目別の合計回数（横棒グラフ用）。「回」の種目だけを対象にし、
   「秒」の種目は回数に混ぜない（従来の集計方針どおり）。
   合計回数の多い順に並べ、上位 limit 件を返す。 */
export function exerciseRepTotals(data: CoreData, limit = 10): ExerciseRepTotal[] {
  return exerciseTotals(data)
    .filter((t) => t.repsKnown && t.reps > 0)
    .map((t) => ({ name: t.name, reps: t.reps }))
    .sort((a, b) => {
      if (b.reps !== a.reps) return b.reps - a.reps;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    })
    .slice(0, limit);
}

/* 種目別の合計セット数（横棒グラフ用）。「秒」の種目も含めた全種目が対象で、
   回数グラフと違い、プランクのような種目もそのまま比べられる。
   exerciseTotals の並び（セット数の多い順、同数は名前順）を保ち、上位 limit 件を返す。 */
export function exerciseSetTotals(data: CoreData, limit = 10): ExerciseSetTotal[] {
  return exerciseTotals(data)
    .map((t) => ({ name: t.name, sets: t.sets }))
    .slice(0, Math.max(0, limit));
}

/* 曜日別の完了率（棒グラフ用）。月〜日の順で7件返す。
   最も古い記録の日から今日までの各日について、トレーニング日かどうかを
   isTrainingRecordDay（保存済みの日種別を優先し、無ければ設定の曜日）で判定し、
   曜日ごとに「トレーニング日のうち完了した日の割合」を出す。
   periodStats と同じく、トレーニング日なのに記録が無い日は未完了として分母に入る。
   トレーニング日が無い曜日は rate が null。記録が無ければ全曜日 null。 */
const WEEKDAY_ORDER: { weekday: number; label: string }[] = [
  { weekday: 1, label: '月' },
  { weekday: 2, label: '火' },
  { weekday: 3, label: '水' },
  { weekday: 4, label: '木' },
  { weekday: 5, label: '金' },
  { weekday: 6, label: '土' },
  { weekday: 0, label: '日' },
];

export function weekdayCompletionRates(data: CoreData): WeekdayRate[] {
  const training = new Map<number, number>();
  const complete = new Map<number, number>();
  WEEKDAY_ORDER.forEach(({ weekday }) => {
    training.set(weekday, 0);
    complete.set(weekday, 0);
  });
  const keys = Object.keys(data.records).sort();
  if (keys.length > 0) {
    const today = todayDate();
    let cursor = parseKey(keys[0]);
    let guard = 0;
    while (cursor <= today && guard < 3660) {
      guard += 1;
      const key = dateKeyOf(cursor);
      if (isTrainingRecordDay(data, key, cursor)) {
        const day = cursor.getDay();
        training.set(day, (training.get(day) ?? 0) + 1);
        if (dayStats(data, key).complete) {
          complete.set(day, (complete.get(day) ?? 0) + 1);
        }
      }
      cursor = addDays(cursor, 1);
    }
  }
  return WEEKDAY_ORDER.map(({ weekday, label }) => {
    const trainingDays = training.get(weekday) ?? 0;
    const completeDays = complete.get(weekday) ?? 0;
    return {
      weekday,
      label,
      trainingDays,
      completeDays,
      rate: trainingDays > 0 ? Math.round((completeDays / trainingDays) * 100) : null,
    };
  });
}

/* 年間ヒートマップ用: 指定した年の1月1日〜12月31日の各日について、
   状態（完了/短縮で完了/休み/未完了/未来）を返す。状態の判定は
   カレンダーの表示（dayStats の完了と dayKindFor）と揃えてある。 */
export function heatmapDays(data: CoreData, year: number): HeatmapDay[] {
  const today = todayDate();
  const days: HeatmapDay[] = [];
  let cursor = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  while (cursor <= end) {
    const key = dateKeyOf(cursor);
    let state: HeatmapState;
    if (cursor > today) {
      state = 'future';
    } else if (dayStats(data, key).complete) {
      state = dayKindFor(data, key, cursor) === 'short' ? 'done-short' : 'done';
    } else if (dayKindFor(data, key, cursor) === 'rest') {
      state = 'rest';
    } else {
      state = 'missed';
    }
    days.push({ key, state });
    cursor = addDays(cursor, 1);
  }
  return days;
}

/* 記録がある最も古い年。記録が無ければ null。 */
export function oldestRecordYear(data: CoreData): number | null {
  let oldest: number | null = null;
  Object.keys(data.records).forEach((key) => {
    const y = Number(key.split('-')[0]);
    if (!Number.isNaN(y) && (oldest === null || y < oldest)) oldest = y;
  });
  return oldest;
}

/* ===== 今日画面の補助 ===== */

/* 今日のその種目の目標セット数。スナップショット（素のセット数）を優先し、
   無ければ現在の種目設定から決める。短縮日は shortGoalSets で絞る。 */
export function todayTargetFor(
  data: CoreData,
  record: DayRecord | null,
  ex: Exercise,
  short: boolean,
): number {
  if (record && record.targets && typeof record.targets[ex.id] === 'number') {
    return short
      ? Math.min(record.targets[ex.id], data.settings.shortGoalSets)
      : record.targets[ex.id];
  }
  return targetSetsFor(data, ex, short);
}

/* 今日の予定表示: その日の状態と、その理由（設定の曜日か、今日だけの切替か）を添える。 */
export function todayScheduleText(
  data: CoreData,
  key: string,
  date: Date,
  kind: 'rest' | 'short' | 'normal',
): string {
  if (kind === 'rest') {
    return '今日は休みの日です（設定で休みの日に選んだ曜日です）';
  }
  let text = '今日はトレーニングの日' + (kind === 'short' ? '（短縮）' : '');
  const timeText = timeTextFor(data);
  if (timeText) text += '・' + timeText;
  const record = getRecord(data, key);
  const recordShort = record && typeof record.short === 'boolean' ? record.short : null;
  let reason = '';
  if (kind === 'short') {
    reason =
      recordShort === true && !defaultShortFor(data, date)
        ? '今日だけ短縮モードにしました'
        : '設定で短縮日に選んだ曜日です';
  } else if (recordShort === false && defaultShortFor(data, date)) {
    reason = '設定では短縮日ですが、今日は短縮モードをオフにしました';
  }
  if (reason) text += '（' + reason + '）';
  return text;
}

/* ===== 「次にやること」の算出 =====
   今日の種目（現在の種目リストの並び順）の中で、スキップしておらず
   まだ目標セット数に届いていない最初の種目を「次にやること」とする。
   その次に控えている未完了の種目も after に入れる（予告表示用）。
   すべて完了またはスキップ済みなら null。
   目標・完了数・名前は dayStats のスナップショット基準に揃える。 */
export function nextActionFor(data: CoreData, key: string): NextAction | null {
  const stats = dayStats(data, key);
  const byId = new Map(stats.entries.map((e) => [e.id, e]));
  let next: NextAction | null = null;
  for (const ex of data.exercises) {
    const entry = byId.get(ex.id);
    if (!entry || entry.skipped || entry.target <= 0 || entry.done >= entry.target) continue;
    if (next === null) {
      next = {
        exerciseId: ex.id,
        name: entry.name,
        setIndex: entry.done,
        done: entry.done,
        target: entry.target,
        amount: entry.amount,
        unit: entry.unit,
        after: null,
      };
    } else {
      next.after = { exerciseId: ex.id, name: entry.name };
      break;
    }
  }
  return next;
}

/* ===== 初回の実践型ガイドのステップ算出 =====
   ステップ1: 今日の種目を確認する（今日の記録がまだ無い間）
   ステップ2: 最初の種目の1セット目を押してみる（記録はあるが完了セットはまだ無い間）
   ステップ3: 記録されたことを確認する（今日の完了セットが1つ以上ある）
   通常の操作（記録を作る・セットを記録する）だけで自動的に進む。 */
export function practiceGuideProgress(
  data: CoreData,
  key: string,
): { current: 1 | 2 | 3; step1Done: boolean; step2Done: boolean } {
  const stats = dayStats(data, key);
  const step2Done = stats.totalDone > 0;
  const step1Done = step2Done || getRecord(data, key) !== null;
  const current: 1 | 2 | 3 = step2Done ? 3 : step1Done ? 2 : 1;
  return { current, step1Done, step2Done };
}

/* 種目がはじめの6種目のままかどうか（開始プリセット表示判定） */
export function isInitialMenu(data: CoreData, seed: Exercise[]): boolean {
  if (data.exercises.length !== seed.length) return false;
  return seed.every((s) => data.exercises.some((ex) => ex.id === s.id));
}

/* ===== Museのアドバイス =====
   記録と設定からルールで1つ選ぶ。外部送信はしない。
   医療的な断定はせず、一般的な文言だけを使う。 */

/* date より前で直近のトレーニング日のキー（見つからなければ null）。 */
export function previousTrainingKey(data: CoreData, date: Date): string | null {
  let cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let i = 0; i < 30; i++) {
    cursor = addDays(cursor, -1);
    if (isTrainingRecordDay(data, dateKeyOf(cursor), cursor)) return dateKeyOf(cursor);
  }
  return null;
}

/* date の前日までの直近 days 日間で、トレーニング日のうち
   記録がある日と完了した日の数を数える。 */
export function recentTrainingStats(
  data: CoreData,
  date: Date,
  days: number,
): { recorded: number; complete: number } {
  let recorded = 0;
  let complete = 0;
  let cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let i = 0; i < days; i++) {
    cursor = addDays(cursor, -1);
    if (!isTrainingRecordDay(data, dateKeyOf(cursor), cursor)) continue;
    const key = dateKeyOf(cursor);
    if (getRecord(data, key)) {
      recorded += 1;
      if (dayStats(data, key).complete) complete += 1;
    }
  }
  return { recorded, complete };
}

/* アドバイスを1つ選ぶ決定的な関数。上から順に優先する。 */
export function pickAdviceKey(data: CoreData): AdviceKey {
  const date = todayDate();
  const key = dateKeyOf(date);

  /* 1. 今日が休みの日 */
  if (dayKindFor(data, key, date) === 'rest') return 'rest';

  /* 2. 今日がすでに完了 */
  if (dayStats(data, key).complete) return 'done';

  const hasRecords = Object.keys(data.records).length > 0;

  /* 3. 前回のトレーニング日が未完了で、今日はトレーニング日 */
  const prevKey = previousTrainingKey(data, date);
  if (hasRecords && prevKey && !dayStats(data, prevKey).complete) {
    return 'retryShort';
  }

  /* 4. 直近7日（トレーニング日のみ）の完了率が50%未満で、記録が3日以上ある */
  const recent = recentTrainingStats(data, date, 7);
  if (recent.recorded >= 3 && recent.complete / recent.recorded < 0.5) {
    return 'easeOff';
  }

  /* 5〜6. 連続日数 */
  const streak = calcStreak(data);
  if (streak >= 7) return 'streakLong';
  if (streak >= 3) return 'streak';

  /* 7. 記録がまだ無い */
  if (!hasRecords) return 'first';

  /* 8. 今日が短縮日 */
  if (effectiveShort(data, key, date)) return 'shortDay';

  /* 9. 既定 */
  return 'fallback';
}

export function pickAdvice(data: CoreData): string {
  return ADVICE_TEXTS[pickAdviceKey(data)];
}

/* ===== からだデータ（体重・体脂肪率・ウエスト） =====
   測った日だけ記録する形式。無い項目・無い日は集計に入れない。 */

function bodyValueOf(entry: BodyEntry | undefined, field: BodyField): number | null {
  const v = entry ? entry[field] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* 測定がある日を古い順に取り出す（いずれかの項目が数値の日だけ） */
export function bodyEntries(bodyData: BodyData): { key: string; entry: BodyEntry }[] {
  const list: { key: string; entry: BodyEntry }[] = [];
  Object.keys(bodyData)
    .sort()
    .forEach((key) => {
      const entry = bodyData[key];
      if (
        entry &&
        (bodyValueOf(entry, 'weight') !== null ||
          bodyValueOf(entry, 'bodyFat') !== null ||
          bodyValueOf(entry, 'waist') !== null)
      ) {
        list.push({ key, entry });
      }
    });
  return list;
}

/* 項目ごとの測定系列（古い順）。その項目を測った日だけが入る。 */
export function bodySeries(bodyData: BodyData, field: BodyField): BodyPoint[] {
  const points: BodyPoint[] = [];
  Object.keys(bodyData)
    .sort()
    .forEach((key) => {
      const v = bodyValueOf(bodyData[key], field);
      if (v !== null) points.push({ key, value: v });
    });
  return points;
}

/* 移動平均: 各測定について、その測定を含む直近最大 window 回分の平均。
   測っていない日ではなく「測定回数」ベースで数える（1日おき測定でも同じ動きになる）。 */
export function movingAveragePoints(
  points: BodyPoint[],
  window: number = BODY_MOVING_AVERAGE_WINDOW,
): BodyPoint[] {
  const size = Math.max(1, Math.floor(window));
  return points.map((point, i) => {
    const from = Math.max(0, i - size + 1);
    let sum = 0;
    for (let j = from; j <= i; j++) sum += points[j].value;
    return { key: point.key, value: Math.round((sum / (i - from + 1)) * 10) / 10 };
  });
}

/* グラフ用: 最初の測定日から最後の測定日までを1日ずつ並べ、測っていない日は
   null にする（Chart.js 側で spanGaps により線をつなぐ。値の補間はしない）。
   移動平均も測定日だけに置き、それ以外は null。 */
export function bodyChartSeries(
  bodyData: BodyData,
  field: BodyField,
): { keys: string[]; values: (number | null)[]; averages: (number | null)[] } {
  const points = bodySeries(bodyData, field);
  if (points.length === 0) return { keys: [], values: [], averages: [] };
  const valueByKey = new Map(points.map((p) => [p.key, p.value]));
  const avgByKey = new Map(movingAveragePoints(points).map((p) => [p.key, p.value]));
  const keys: string[] = [];
  let cursor = parseKey(points[0].key);
  const last = parseKey(points[points.length - 1].key);
  let guard = 0;
  while (cursor <= last && guard < 36600) {
    guard += 1;
    keys.push(dateKeyOf(cursor));
    cursor = addDays(cursor, 1);
  }
  return {
    keys,
    values: keys.map((k) => valueByKey.get(k) ?? null),
    averages: keys.map((k) => avgByKey.get(k) ?? null),
  };
}

/* 項目ごとの集計: 最新・前回・最初と、その差（小数1桁に丸める）。
   その項目の測定が無ければ null。 */
export function bodySummary(bodyData: BodyData, field: BodyField): BodySummary | null {
  const points = bodySeries(bodyData, field);
  if (points.length === 0) return null;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const latest = points[points.length - 1];
  const previous = points.length >= 2 ? points[points.length - 2] : null;
  const first = points[0];
  return {
    latest,
    previous,
    first,
    vsPrevious: previous ? round1(latest.value - previous.value) : null,
    vsFirst: round1(latest.value - first.value),
    count: points.length,
  };
}

/* ===== からだデータの期間比較 =====
   今日を含む暦の期間（週は月曜はじまりの暦週・暦月・暦年）と、その直前の期間で
   項目ごとの平均を比べる。トレーニング記録の期間比較と同じ期間の切り方。
   平均はその期間に実測がある値だけから出す（測っていない日は数えない・補間しない）。 */

/* 今日を含む期間とその直前の期間の範囲（開始日・終了日） */
function bodyPeriodRange(
  kind: BodyPeriodKind,
  today: Date,
): { currentStart: Date; currentEnd: Date; previousStart: Date; previousEnd: Date } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (kind === 'week') {
    const monday = startOfWeekMonday(today);
    return {
      currentStart: monday,
      currentEnd: addDays(monday, 6),
      previousStart: addDays(monday, -7),
      previousEnd: addDays(monday, -1),
    };
  }
  if (kind === 'month') {
    return {
      currentStart: new Date(y, m, 1),
      currentEnd: new Date(y, m + 1, 0),
      previousStart: new Date(y, m - 1, 1),
      previousEnd: new Date(y, m, 0),
    };
  }
  return {
    currentStart: new Date(y, 0, 1),
    currentEnd: new Date(y, 11, 31),
    previousStart: new Date(y - 1, 0, 1),
    previousEnd: new Date(y - 1, 11, 31),
  };
}

const BODY_FIELDS: BodyField[] = ['weight', 'bodyFat', 'waist'];

/* 項目ごとの期間比較: 今の期間の平均と前の期間の平均、その差、
   今の期間の中での最初→最後の変化を出す。 */
export function bodyPeriodComparison(
  bodyData: BodyData,
  kind: BodyPeriodKind,
  today: Date = todayDate(),
): BodyPeriodComparison {
  const range = bodyPeriodRange(kind, today);
  const currentStart = dateKeyOf(range.currentStart);
  const currentEnd = dateKeyOf(range.currentEnd);
  const previousStart = dateKeyOf(range.previousStart);
  const previousEnd = dateKeyOf(range.previousEnd);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const avgOf = (points: BodyPoint[]): number | null =>
    points.length === 0
      ? null
      : round1(points.reduce((sum, p) => sum + p.value, 0) / points.length);

  const fields = {} as Record<BodyField, BodyPeriodFieldStats>;
  BODY_FIELDS.forEach((field) => {
    const points = bodySeries(bodyData, field);
    const current = points.filter((p) => p.key >= currentStart && p.key <= currentEnd);
    const previous = points.filter((p) => p.key >= previousStart && p.key <= previousEnd);
    const currentAvg = avgOf(current);
    const previousAvg = avgOf(previous);
    const currentFirst = current.length > 0 ? current[0] : null;
    const currentLast = current.length > 0 ? current[current.length - 1] : null;
    fields[field] = {
      currentAvg,
      previousAvg,
      diff: currentAvg !== null && previousAvg !== null ? round1(currentAvg - previousAvg) : null,
      currentCount: current.length,
      previousCount: previous.length,
      currentFirst,
      currentLast,
      currentChange:
        currentFirst !== null && currentLast !== null && current.length >= 2
          ? round1(currentLast.value - currentFirst.value)
          : null,
    };
  });

  return { kind, currentStart, currentEnd, previousStart, previousEnd, fields };
}

/* BMI（体重 kg ÷ 身長 m の二乗、小数1桁）。
   身長が未設定（0）・範囲外、または体重が不正なら null（＝表示しない）。 */
export function bmiOf(weightKg: number, heightCm: number): number | null {
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (
    typeof heightCm !== 'number' ||
    !Number.isFinite(heightCm) ||
    heightCm < HEIGHT_RANGE.min ||
    heightCm > HEIGHT_RANGE.max
  ) {
    return null;
  }
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/* 最近のからだ記録（新しい順、最大 limit 件）。一覧表示用。 */
export function recentBodyEntries(
  bodyData: BodyData,
  limit = 10,
): { key: string; entry: BodyEntry }[] {
  const all = bodyEntries(bodyData);
  return all.slice(Math.max(0, all.length - Math.max(0, limit))).reverse();
}

/* ===== 分析（マイページの「分析」カード） =====
   記録とからだデータから、読み取れる「気づき」を文章にする。
   今日画面のアドバイス（pickAdviceKey / pickAdvice）と同じ集計部品
   （periodStats・weekdayCompletionRates・exerciseTotals・calcStreak・
   bodySeries・movingAveragePoints など）の上に作り、集計方法は揃える。
   データが不足する観点は出さない。医療的な断定はせず、一般的な文言だけを使う。 */

/* 小数1桁に丸める（からだデータの集計と同じ決め方） */
function round1Of(n: number): number {
  return Math.round(n * 10) / 10;
}

/* 変化量の符号付き表示（例: +0.3 / -1） */
function signedOf(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

/* 直近4週間（今日を含む28日）と、その前4週間の期間集計。
   分析の気づきと相談用まとめで同じ切り方を使う。 */
export function fourWeekComparison(
  data: CoreData,
  today: Date = todayDate(),
): { current: PeriodStats; previous: PeriodStats } {
  return {
    current: periodStats(data, addDays(today, -27), today),
    previous: periodStats(data, addDays(today, -55), addDays(today, -28)),
  };
}

/* 2つの日付キーの間の日数（b - a） */
function daysBetween(aKey: string, bKey: string): number {
  return Math.round((parseKey(bKey).getTime() - parseKey(aKey).getTime()) / (24 * 60 * 60 * 1000));
}

export function insightsFor(
  data: CoreData,
  bodyData: BodyData,
  today: Date = todayDate(),
): Insight[] {
  const insights: Insight[] = [];

  /* 連続記録: 現在値と過去最長、最長更新まであと何日か */
  const streak = calcStreak(data);
  const longest = calcLongestStreak(data);
  if (longest >= 2) {
    if (streak > 0 && streak >= longest) {
      insights.push({
        key: 'streak',
        label: '連続記録',
        text: `現在の連続は${streak}日で、過去最長（${longest}日）に並んでいます。次のトレーニング日を完了すると、最長記録を更新できます。`,
      });
    } else if (streak > 0) {
      insights.push({
        key: 'streak',
        label: '連続記録',
        text: `現在の連続は${streak}日、過去最長は${longest}日です。あと${longest - streak + 1}日続けると、最長記録を更新できます。`,
      });
    } else {
      insights.push({
        key: 'streak',
        label: '連続記録',
        text: `今は連続が途切れていますが、過去最長は${longest}日です。今日の分を1つ完了するところから、また積み上げられます。`,
      });
    }
  }

  /* 直近4週間とその前4週間の完了率の変化 */
  const { current, previous } = fourWeekComparison(data, today);
  if (
    current.rate !== null &&
    previous.rate !== null &&
    current.trainingDays >= 3 &&
    previous.trainingDays >= 3 &&
    /* 両期間とも完了がゼロなら「横ばい」と言わず、出さない */
    current.completeDays + previous.completeDays > 0
  ) {
    const diff = current.rate - previous.rate;
    const tail =
      diff >= 10
        ? '少しずつ上向いています。この調子でいきましょう。'
        : diff <= -10
          ? '少し下がり気味です。忙しい日は短縮モードを活用してみましょう。'
          : '大きな変化はなく、安定しています。';
    insights.push({
      key: 'trend',
      label: '最近の流れ',
      text: `直近4週間の完了率は${current.rate}%（完了${current.completeDays}日／トレーニング日${current.trainingDays}日）で、その前4週間は${previous.rate}%でした。${tail}`,
    });
  }

  /* 曜日別の弱点: 完了率が一番低い曜日（ばらつきがあるときだけ） */
  const weekdayRates = weekdayCompletionRates(data);
  const totalTrainingDays = weekdayRates.reduce((sum, r) => sum + r.trainingDays, 0);
  const ratedWeekdays = weekdayRates.filter((r) => r.rate !== null && r.trainingDays >= 2);
  if (totalTrainingDays >= 7 && ratedWeekdays.length >= 3) {
    const weakest = ratedWeekdays.reduce((a, b) => ((b.rate ?? 0) < (a.rate ?? 0) ? b : a));
    const strongest = ratedWeekdays.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a));
    if (weakest.rate !== null && strongest.rate !== null && weakest.rate < strongest.rate) {
      insights.push({
        key: 'weekday',
        label: '曜日',
        text: `${weakest.label}曜日の完了率が${weakest.rate}%（完了${weakest.completeDays}日／トレーニング日${weakest.trainingDays}日）で、ほかの曜日より低めです。いちばん高いのは${strongest.label}曜日の${strongest.rate}%です。${weakest.label}曜日が忙しい場合は、はじめから短縮モードにしておくのも手です。`,
      });
    }
  }

  /* 種目の偏り: 完了セット数が一番多い種目と少ない種目 */
  const totals = exerciseTotals(data);
  const totalSets = totals.reduce((sum, t) => sum + t.sets, 0);
  if (totals.length >= 2 && totalSets >= 10) {
    const most = totals[0];
    const least = totals[totals.length - 1];
    if (most.sets > least.sets) {
      insights.push({
        key: 'exercise',
        label: '種目のバランス',
        text: `完了セット数は「${most.name}」が${most.sets}セットで一番多く、「${least.name}」が${least.sets}セットで少なめです。偏りが気になるときは、少なめの種目のセット数を少し増やすと全体のバランスが取れます。`,
      });
    }
  }

  /* 短縮日の活用: 直近4週間で、記録のあるトレーニング日のうち
     短縮モードで完了した日の割合 */
  let shortRecorded = 0;
  let shortDone = 0;
  for (let i = 0; i < 28; i++) {
    const d = addDays(today, -i);
    const key = dateKeyOf(d);
    if (!isTrainingRecordDay(data, key, d)) continue;
    if (!getRecord(data, key)) continue;
    shortRecorded += 1;
    const stats = dayStats(data, key);
    if (stats.short && stats.complete) shortDone += 1;
  }
  if (shortRecorded >= 4 && shortDone >= 1) {
    const pct = Math.round((shortDone / shortRecorded) * 100);
    insights.push({
      key: 'short',
      label: '短縮モード',
      text: `直近4週間では、記録のあるトレーニング日${shortRecorded}日のうち${shortDone}日（${pct}%）を短縮モードで完了しています。短い分だけでもやり切れているのは、続ける力になっています。`,
    });
  }

  /* 体重の変化ペース: 直近約1か月の変化量と月あたり換算、移動平均の向き */
  const weightPoints = bodySeries(bodyData, 'weight');
  if (weightPoints.length >= 2) {
    const latest = weightPoints[weightPoints.length - 1];
    const windowStartKey = dateKeyOf(addDays(parseKey(latest.key), -30));
    const inWindow = weightPoints.filter((p) => p.key >= windowStartKey);
    if (inWindow.length >= 2) {
      const first = inWindow[0];
      const spanDays = daysBetween(first.key, latest.key);
      if (spanDays >= 7) {
        const change = round1Of(latest.value - first.value);
        const perMonth = round1Of((change * 30) / spanDays);
        let text = `体重は直近約1か月で${signedOf(change)}kgの変化です（月あたり約${signedOf(perMonth)}kgのペース）。`;
        /* 移動平均の向き: 最新の移動平均と、約4週間前の時点の移動平均を比べる */
        const averages = movingAveragePoints(weightPoints);
        const avgByKey = new Map(averages.map((p) => [p.key, p.value]));
        const earlierKey = [...avgByKey.keys()]
          .filter((k) => k <= dateKeyOf(addDays(parseKey(latest.key), -28)))
          .pop();
        const latestAvg = avgByKey.get(latest.key);
        const earlierAvg = earlierKey ? avgByKey.get(earlierKey) : undefined;
        if (latestAvg !== undefined && earlierAvg !== undefined) {
          const avgDiff = round1Of(latestAvg - earlierAvg);
          text +=
            avgDiff <= -0.2
              ? '移動平均でもゆるやかに下がり続けています。'
              : avgDiff >= 0.2
                ? '移動平均では上向きになっています。'
                : '移動平均はほぼ横ばいです。';
        }
        insights.push({ key: 'weight', label: '体重', text });
      }
    }
  }

  return insights;
}

/* ===== Muse に相談する用のまとめ =====
   期間の統計・種目別合計・からだデータの要約・分析の気づきを、
   チャットの Muse に貼れる整形済みテキストにする。生成だけを行い、
   クリップボードへのコピーは画面側の仕事にする。 */
export function buildConsultSummary(
  data: CoreData & { bodyData: BodyData },
  today: Date = todayDate(),
): string {
  const bodyData = data.bodyData;
  const lines: string[] = [];
  lines.push('【毎日トレーニングの記録まとめ】');
  lines.push(`（${formatDateJa(today)}時点）`);
  lines.push('');

  /* トレーニング（全期間）: いちばん古い記録の日から今日までで集計する */
  lines.push('■ トレーニング（全期間）');
  const recordKeys = Object.keys(data.records).sort();
  if (recordKeys.length === 0) {
    lines.push('・まだ記録がありません。');
  } else {
    const all = periodStats(data, parseKey(recordKeys[0]), today);
    const totals = allTimeTotals(data);
    lines.push(
      `・完了日数: ${all.completeDays}日（トレーニング日${all.trainingDays}日${all.rate !== null ? `、完了率${all.rate}%` : ''}）`,
    );
    lines.push(`・完了セット数: ${totals.totalSets}セット`);
    if (all.repsKnown) lines.push(`・合計回数: ${totals.totalReps}回`);
    lines.push(`・現在の連続: ${calcStreak(data)}日／最長連続: ${calcLongestStreak(data)}日`);
    const week = weekProgressStats(data);
    lines.push(
      `・今週の進捗: 完了${week.done}日${data.settings.weeklyGoal > 0 ? `（目標${data.settings.weeklyGoal}日）` : `（今週のトレーニング日は残り${week.remaining}日）`}`,
    );
  }
  lines.push('');

  /* 直近4週間とその前4週間の比較 */
  lines.push('■ 期間の比較（直近4週間とその前4週間）');
  if (recordKeys.length === 0) {
    lines.push('・まだ記録がありません。');
  } else {
    const { current, previous } = fourWeekComparison(data, today);
    const periodLine = (label: string, stats: PeriodStats) =>
      stats.rate === null
        ? `・${label}: データなし`
        : `・${label}: 完了率${stats.rate}%（完了${stats.completeDays}日／トレーニング日${stats.trainingDays}日、${stats.sets}セット）`;
    lines.push(periodLine('直近4週間', current));
    lines.push(periodLine('その前4週間', previous));
  }
  lines.push('');

  /* 種目別の合計（セット数の多い順、上位8件） */
  lines.push('■ 種目別の合計');
  const totals = exerciseTotals(data);
  if (totals.length === 0) {
    lines.push('・まだ記録がありません。');
  } else {
    totals.slice(0, 8).forEach((t) => {
      lines.push(`・${t.name}: ${t.sets}セット${t.repsKnown ? `・合計${t.reps}回` : ''}`);
    });
  }
  lines.push('');

  /* からだデータの要約 */
  lines.push('■ からだデータ');
  const fieldLines: { field: BodyField; label: string; unit: string }[] = [
    { field: 'weight', label: '体重', unit: 'kg' },
    { field: 'bodyFat', label: '体脂肪率', unit: '%' },
    { field: 'waist', label: 'ウエスト', unit: 'cm' },
  ];
  let hasBody = false;
  fieldLines.forEach(({ field, label, unit }) => {
    const summary = bodySummary(bodyData, field);
    if (!summary) return;
    hasBody = true;
    lines.push(
      `・${label}: 最新${summary.latest.value}${unit}（${formatShortDate(parseKey(summary.latest.key))}）、最初の記録から${signedOf(summary.vsFirst)}${unit}、測定${summary.count}回`,
    );
  });
  if (!hasBody) {
    lines.push('・まだ記録がありません。');
  } else {
    const weightSummary = bodySummary(bodyData, 'weight');
    const bmi = weightSummary ? bmiOf(weightSummary.latest.value, data.settings.heightCm) : null;
    if (bmi !== null) {
      lines.push(`・BMI: ${bmi}（最新の体重と身長${data.settings.heightCm}cmから計算）`);
    }
  }
  lines.push('');

  /* 分析の気づき */
  lines.push('■ アプリの分析メモ');
  const insights = insightsFor(data, bodyData, today);
  if (insights.length === 0) {
    lines.push('・まだ分析できる記録がありません。');
  } else {
    insights.forEach((ins) => {
      lines.push(`・${ins.text}`);
    });
  }
  lines.push('');
  lines.push('この記録をもとに、無理なく続けられるトレーニングと生活習慣のアドバイスをお願いします。');
  return lines.join('\n');
}
