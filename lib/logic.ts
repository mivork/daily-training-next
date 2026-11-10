import { ADVICE_TEXTS, type AdviceKey, TIME_SLOT_LABELS } from './constants';
import { addDays, dateKeyOf, parseKey, startOfWeekMonday, todayDate } from './dates';
import { toInt } from './sanitize';
import type {
  CoreData,
  DayRecord,
  DayStats,
  Exercise,
  ExerciseRepTotal,
  ExerciseTotal,
  HeatmapDay,
  HeatmapState,
  NextAction,
  PeriodStats,
  RankedRankingRow,
  RankingMetricKey,
  RankingRow,
  RankingValues,
  WeekTrendPoint,
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
