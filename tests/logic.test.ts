import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SEED_EXERCISES } from '../lib/constants';
import { addDays, dateKeyOf, parseKey, startOfWeekMonday, todayDate } from '../lib/dates';
import {
  calcStreak,
  dayStats,
  exerciseRepTotals,
  heatmapDays,
  monthlyCompleteDays,
  nextActionFor,
  periodStats,
  pickAdviceKey,
  practiceGuideProgress,
  rankingNicknameOf,
  rankingValuesOf,
  rankRankingRows,
  weeklyTrend,
} from '../lib/logic';
import { clone, sanitizePrefs, sanitizeSettings } from '../lib/sanitize';
import {
  buildExportPayload,
  decodeTransferCode,
  encodeTransferCode,
  validateImportData,
} from '../lib/transfer';
import type { CoreData, DayRecord, RankingRow } from '../lib/types';

const EX1 = { id: 'ex1', name: '腕立て伏せ', amount: 20, unit: '回' as const, sets: 2, note: '' };
const EX2 = { id: 'ex2', name: 'プランク', amount: 30, unit: '秒' as const, sets: 2, note: '' };

function makeCore(records: CoreData['records'], settingsPatch: Partial<CoreData['settings']> = {}): CoreData {
  return {
    exercises: [EX1, EX2],
    records,
    settings: { ...clone(DEFAULT_SETTINGS), ...settingsPatch },
  };
}

function completeRecord(dayType: 'training' | 'rest' = 'training'): DayRecord {
  return {
    done: { ex1: 2, ex2: 2 },
    short: false,
    dayType,
    targets: { ex1: 2, ex2: 2 },
    names: { ex1: '腕立て伏せ', ex2: 'プランク' },
    amounts: { ex1: 20, ex2: 30 },
    units: { ex1: '回', ex2: '秒' },
  };
}

function keyDaysAgo(n: number): string {
  return dateKeyOf(addDays(todayDate(), -n));
}

describe('dayStats', () => {
  it('スナップショットをもとに完了を判定する', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord() });
    const stats = dayStats(core, keyDaysAgo(0));
    expect(stats.complete).toBe(true);
    expect(stats.totalTarget).toBe(4);
    expect(stats.totalDone).toBe(4);
    expect(stats.rate).toBe(100);
  });

  it('短縮日は目標が shortGoalSets で絞られる', () => {
    const rec = completeRecord();
    rec.short = true;
    rec.done = { ex1: 1, ex2: 1 };
    const core = makeCore({ [keyDaysAgo(0)]: rec });
    const stats = dayStats(core, keyDaysAgo(0));
    expect(stats.totalTarget).toBe(2);
    expect(stats.complete).toBe(true);
  });

  it('スキップした種目は分母から外れ、残りが完了なら日も完了になる', () => {
    const rec = completeRecord();
    rec.done = { ex1: 2 };
    rec.skipped = { ex2: true };
    const core = makeCore({ [keyDaysAgo(0)]: rec });
    const stats = dayStats(core, keyDaysAgo(0));
    expect(stats.skippedCount).toBe(1);
    expect(stats.totalTarget).toBe(2);
    expect(stats.complete).toBe(true);
    const ex2 = stats.entries.find((e) => e.id === 'ex2');
    expect(ex2?.countedDone).toBe(0);
  });

  it('記録が無い日は未完了で、現在の種目から目標を作る', () => {
    const core = makeCore({});
    const stats = dayStats(core, keyDaysAgo(0));
    expect(stats.complete).toBe(false);
    expect(stats.totalTarget).toBe(4);
    expect(stats.totalDone).toBe(0);
  });
});

describe('calcStreak', () => {
  it('今日が未完了なら昨日以前から数える', () => {
    const core = makeCore({
      [keyDaysAgo(1)]: completeRecord(),
      [keyDaysAgo(2)]: completeRecord(),
    });
    expect(calcStreak(core)).toBe(2);
  });

  it('休みの日（dayType=rest）は連続を切らない', () => {
    const restRec = completeRecord('rest');
    restRec.done = {};
    const core = makeCore({
      [keyDaysAgo(1)]: restRec,
      [keyDaysAgo(2)]: completeRecord(),
      [keyDaysAgo(3)]: completeRecord(),
    });
    expect(calcStreak(core)).toBe(2);
  });

  it('未完了のトレーニング日で連続が止まる', () => {
    const partial = completeRecord();
    partial.done = { ex1: 1 };
    const core = makeCore({
      [keyDaysAgo(1)]: partial,
      [keyDaysAgo(2)]: completeRecord(),
    });
    expect(calcStreak(core)).toBe(0);
  });
});

describe('periodStats', () => {
  it('完了日数・完了率・合計回数を集計する（回の種目だけ回数を数える）', () => {
    const core = makeCore({ [keyDaysAgo(1)]: completeRecord() });
    const stats = periodStats(core, addDays(todayDate(), -1), todayDate());
    expect(stats.hasData).toBe(true);
    expect(stats.trainingDays).toBe(2);
    expect(stats.completeDays).toBe(1);
    expect(stats.rate).toBe(50);
    expect(stats.sets).toBe(4);
    /* 腕立て伏せ 2セット × 20回 = 40回。プランクは「秒」なので数えない */
    expect(stats.reps).toBe(40);
  });

  it('記録が無い期間は hasData=false（完了率は0%）', () => {
    const core = makeCore({});
    const stats = periodStats(core, addDays(todayDate(), -400), addDays(todayDate(), -390));
    expect(stats.hasData).toBe(false);
    expect(stats.rate).toBe(0);
  });

  it('トレーニング日が無い設定では rate=null', () => {
    const core = makeCore({}, { trainingWeekdays: [] });
    const stats = periodStats(core, addDays(todayDate(), -7), todayDate());
    expect(stats.trainingDays).toBe(0);
    expect(stats.rate).toBeNull();
  });
});

describe('weeklyTrend', () => {
  it('直近12週分を古い順に返し、各点は月曜はじまりになる', () => {
    const trend = weeklyTrend(makeCore({}), 12);
    expect(trend).toHaveLength(12);
    trend.forEach((p) => {
      expect(parseKey(p.mondayKey).getDay()).toBe(1);
    });
    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].mondayKey > trend[i - 1].mondayKey).toBe(true);
    }
    /* 最後の点は今週 */
    expect(trend[11].mondayKey).toBe(dateKeyOf(startOfWeekMonday(todayDate())));
  });

  it('完了した日がある週は完了日数と完了率（トレーニング日のみ）が出る', () => {
    /* 8日前は先週以前のどこかの日。その日の週だけを抜き出して確かめる */
    const targetDate = addDays(todayDate(), -8);
    const targetMondayKey = dateKeyOf(startOfWeekMonday(targetDate));
    const core = makeCore({ [dateKeyOf(targetDate)]: completeRecord() });
    const point = weeklyTrend(core, 12).find((p) => p.mondayKey === targetMondayKey);
    expect(point).toBeDefined();
    expect(point!.completeDays).toBe(1);
    expect(point!.trainingDays).toBe(7);
    /* 完了率 = 1/7 → 14% */
    expect(point!.rate).toBe(14);
  });

  it('今日が完了していれば今週の点に反映される', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord() });
    const trend = weeklyTrend(core, 12);
    expect(trend[11].completeDays).toBeGreaterThanOrEqual(1);
  });

  it('トレーニング日が無い設定では完了率が null になる', () => {
    const core = makeCore({}, { trainingWeekdays: [] });
    const trend = weeklyTrend(core, 12);
    trend.forEach((p) => {
      expect(p.trainingDays).toBe(0);
      expect(p.rate).toBeNull();
    });
  });
});

describe('monthlyCompleteDays', () => {
  it('12か月分を返し、完了した日の月だけ数える', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord() });
    const counts = monthlyCompleteDays(core, todayDate().getFullYear());
    expect(counts).toHaveLength(12);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(counts[todayDate().getMonth()]).toBe(1);
  });

  it('記録が無ければ全て0', () => {
    const counts = monthlyCompleteDays(makeCore({}), todayDate().getFullYear());
    expect(counts.every((c) => c === 0)).toBe(true);
  });
});

describe('exerciseRepTotals', () => {
  it('「回」の種目だけを合計回数の多い順に返す（秒の種目は混ぜない）', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord(), [keyDaysAgo(1)]: completeRecord() });
    const totals = exerciseRepTotals(core);
    /* 腕立て伏せ: 2日 × 2セット × 20回 = 80回。プランク（秒）は含まれない */
    expect(totals).toEqual([{ name: '腕立て伏せ', reps: 80 }]);
  });

  it('記録が無ければ空', () => {
    expect(exerciseRepTotals(makeCore({}))).toEqual([]);
  });
});

describe('heatmapDays', () => {
  it('1年分（365日または366日）を返す', () => {
    const year = todayDate().getFullYear();
    const days = heatmapDays(makeCore({}), year);
    const expected = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
    expect(days).toHaveLength(expected);
    expect(days[0].key).toBe(`${year}-01-01`);
    expect(days[days.length - 1].key).toBe(`${year}-12-31`);
  });

  it('完了・短縮完了・休み・未完了・未来を区別する', () => {
    const year = todayDate().getFullYear();
    const shortRec = completeRecord();
    shortRec.short = true;
    shortRec.done = { ex1: 1, ex2: 1 };
    const restRec = completeRecord('rest');
    restRec.done = {};
    const core = makeCore({
      [keyDaysAgo(0)]: completeRecord(),
      [keyDaysAgo(1)]: shortRec,
      [keyDaysAgo(2)]: restRec,
    });
    const days = heatmapDays(core, year);
    const byKey = new Map(days.map((d) => [d.key, d.state]));
    expect(byKey.get(keyDaysAgo(0))).toBe('done');
    expect(byKey.get(keyDaysAgo(1))).toBe('done-short');
    expect(byKey.get(keyDaysAgo(2))).toBe('rest');
    /* 記録の無い過去のトレーニング日は未完了、未来の日は future */
    expect(byKey.get(keyDaysAgo(10))).toBe('missed');
    const futureKey = dateKeyOf(addDays(todayDate(), 30));
    if (parseKey(futureKey).getFullYear() === year) {
      expect(byKey.get(futureKey)).toBe('future');
    }
  });
});

describe('pickAdviceKey', () => {
  it('記録が無ければ first', () => {
    expect(pickAdviceKey(makeCore({}))).toBe('first');
  });

  it('今日が完了していれば done', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord() });
    expect(pickAdviceKey(core)).toBe('done');
  });

  it('今日が休みの日（設定で外した曜日）なら rest', () => {
    const todayDow = todayDate().getDay();
    const trainingWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== todayDow);
    const core = makeCore({}, { trainingWeekdays });
    expect(pickAdviceKey(core)).toBe('rest');
  });
});

describe('rankingValuesOf', () => {
  it('今週の完了日数・連続日数・累計が既存の集計と一致する', () => {
    const core = makeCore({
      [keyDaysAgo(0)]: completeRecord(),
      [keyDaysAgo(1)]: completeRecord(),
      [keyDaysAgo(2)]: completeRecord(),
    });
    const values = rankingValuesOf(core);
    /* 昨日と一昨日は先週にまたがる場合があるため、今週分は weekProgressStats と同じになることだけを見る */
    expect(values.streak).toBe(3);
    expect(values.totalDays).toBe(3);
    /* 完了セット数: 3日 ×（2種目 × 2セット）= 12 */
    expect(values.totalSets).toBe(12);
    expect(values.weekDone).toBeGreaterThanOrEqual(1);
    expect(values.weekDone).toBeLessThanOrEqual(3);
  });

  it('記録が無ければすべて0', () => {
    expect(rankingValuesOf(makeCore({}))).toEqual({
      weekDone: 0,
      streak: 0,
      totalDays: 0,
      totalSets: 0,
    });
  });
});

describe('rankingNicknameOf', () => {
  it('設定済みのニックネームを使う', () => {
    expect(rankingNicknameOf(makeCore({}, { nickname: 'たろう' }))).toBe('たろう');
  });

  it('未設定なら「ゲスト」になる', () => {
    expect(rankingNicknameOf(makeCore({}))).toBe('ゲスト');
  });
});

describe('rankRankingRows', () => {
  const row = (patch: Partial<RankingRow> & { userId: string }): RankingRow => ({
    nickname: patch.userId,
    weekDone: 0,
    streak: 0,
    totalDays: 0,
    totalSets: 0,
    updatedAt: '',
    ...patch,
  });

  it('指標の降順に並び、同点は同じ順位になる（競技順位方式）', () => {
    const ranked = rankRankingRows(
      [
        row({ userId: 'a', weekDone: 3 }),
        row({ userId: 'b', weekDone: 5 }),
        row({ userId: 'c', weekDone: 5 }),
        row({ userId: 'd', weekDone: 1 }),
      ],
      'week',
    );
    expect(ranked.map((r) => r.userId)).toEqual(['b', 'c', 'a', 'd']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  it('指標を切り替えると並びが変わる', () => {
    const rows = [
      row({ userId: 'a', weekDone: 7, streak: 1, totalDays: 10 }),
      row({ userId: 'b', weekDone: 0, streak: 9, totalDays: 3 }),
    ];
    expect(rankRankingRows(rows, 'week')[0].userId).toBe('a');
    expect(rankRankingRows(rows, 'streak')[0].userId).toBe('b');
    expect(rankRankingRows(rows, 'total')[0].userId).toBe('a');
  });

  it('元の配列を変更しない', () => {
    const rows = [row({ userId: 'a', totalDays: 1 }), row({ userId: 'b', totalDays: 2 })];
    rankRankingRows(rows, 'total');
    expect(rows.map((r) => r.userId)).toEqual(['a', 'b']);
  });
});

describe('sanitizeSettings の rankingOptIn', () => {
  it('既定はオフで、旧データ（項目なし）でもオフになる', () => {
    expect(sanitizeSettings({}).rankingOptIn).toBe(false);
    expect(sanitizeSettings(null).rankingOptIn).toBe(false);
  });

  it('true のときだけオンになり、それ以外はオフになる', () => {
    expect(sanitizeSettings({ rankingOptIn: true }).rankingOptIn).toBe(true);
    expect(sanitizeSettings({ rankingOptIn: 'yes' }).rankingOptIn).toBe(false);
    expect(sanitizeSettings({ rankingOptIn: 1 }).rankingOptIn).toBe(false);
  });
});

describe('引き継ぎコード', () => {
  it('日本語と絵文字を含むJSONが往復する', () => {
    const text = JSON.stringify({ name: '毎日トレーニング', memo: 'がんばる💪' });
    const code = encodeTransferCode(text);
    expect(decodeTransferCode(code)).toBe(text);
  });

  it('壊れたコードは null を返す', () => {
    expect(decodeTransferCode('not-base64!!')).toBeNull();
    expect(decodeTransferCode('')).toBeNull();
  });
});

describe('validateImportData', () => {
  const baseData = {
    exercises: clone(SEED_EXERCISES),
    records: {},
    settings: clone(DEFAULT_SETTINGS),
    profile: { image: '', bio: '' },
    rivals: [],
    bodyData: {},
    prefs: { schemaVersion: 1, guideDismissed: false, practiceGuideDismissed: false, tutorialSeen: false, exportLastAt: '', mpYear: null, mpMonth: null, mpWeek: '', startPresetDone: false },
  };

  it('バニラ版の書き出し形式を受け付ける', () => {
    const payload = buildExportPayload(baseData, '2026年11月10日');
    const result = validateImportData(JSON.parse(JSON.stringify(payload)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.exercises).toHaveLength(6);
    }
  });

  it('新しい schemaVersion は読み込めない', () => {
    const payload = { ...buildExportPayload(baseData, ''), schemaVersion: 99 };
    const result = validateImportData(payload);
    expect(result.ok).toBe(false);
  });

  it('不正な日付キーの記録は読み込めない', () => {
    const payload = buildExportPayload(baseData, '');
    (payload.records as Record<string, unknown>)['2026-13-40'] = { done: {} };
    const result = validateImportData(payload);
    expect(result.ok).toBe(false);
  });

  it('種目の数値が文字列なら読み込めない', () => {
    const payload = buildExportPayload(baseData, '');
    (payload.exercises[0] as unknown as Record<string, unknown>).amount = '20';
    const result = validateImportData(payload);
    expect(result.ok).toBe(false);
  });
});

describe('nextActionFor', () => {
  function todayRecord(done: DayRecord['done'], patch: Partial<DayRecord> = {}): DayRecord {
    return {
      done,
      short: false,
      dayType: 'training',
      targets: { ex1: 2, ex2: 2 },
      names: { ex1: '腕立て伏せ', ex2: 'プランク' },
      amounts: { ex1: 20, ex2: 30 },
      units: { ex1: '回', ex2: '秒' },
      ...patch,
    };
  }

  it('記録が無ければ最初の種目の1セット目で、その次も予告する', () => {
    const core = makeCore({});
    const action = nextActionFor(core, keyDaysAgo(0));
    expect(action).not.toBeNull();
    expect(action?.exerciseId).toBe('ex1');
    expect(action?.name).toBe('腕立て伏せ');
    expect(action?.setIndex).toBe(0);
    expect(action?.done).toBe(0);
    expect(action?.target).toBe(2);
    expect(action?.amount).toBe(20);
    expect(action?.unit).toBe('回');
    expect(action?.after?.exerciseId).toBe('ex2');
  });

  it('途中まで記録していれば同じ種目の次のセットになる', () => {
    const core = makeCore({ [keyDaysAgo(0)]: todayRecord({ ex1: 1 }) });
    const action = nextActionFor(core, keyDaysAgo(0));
    expect(action?.exerciseId).toBe('ex1');
    expect(action?.setIndex).toBe(1);
    expect(action?.done).toBe(1);
  });

  it('最初の種目が終わっていれば次の種目になり、予告は無くなる', () => {
    const core = makeCore({ [keyDaysAgo(0)]: todayRecord({ ex1: 2 }) });
    const action = nextActionFor(core, keyDaysAgo(0));
    expect(action?.exerciseId).toBe('ex2');
    expect(action?.setIndex).toBe(0);
    expect(action?.after).toBeNull();
  });

  it('スキップした種目は対象から外れる', () => {
    const core = makeCore({
      [keyDaysAgo(0)]: todayRecord({}, { skipped: { ex1: true } }),
    });
    const action = nextActionFor(core, keyDaysAgo(0));
    expect(action?.exerciseId).toBe('ex2');
  });

  it('すべて完了していれば null', () => {
    const core = makeCore({ [keyDaysAgo(0)]: completeRecord() });
    expect(nextActionFor(core, keyDaysAgo(0))).toBeNull();
  });

  it('短縮日は目標が shortGoalSets で絞られた種目が対象になる', () => {
    const core = makeCore({ [keyDaysAgo(0)]: todayRecord({ ex1: 1 }, { short: true }) });
    const action = nextActionFor(core, keyDaysAgo(0));
    /* 短縮では ex1 は1セットで完了扱いのため、次は ex2 の1セット目（目標1） */
    expect(action?.exerciseId).toBe('ex2');
    expect(action?.target).toBe(1);
    expect(action?.setIndex).toBe(0);
  });
});

describe('practiceGuideProgress', () => {
  it('記録が無ければステップ1', () => {
    const core = makeCore({});
    const progress = practiceGuideProgress(core, keyDaysAgo(0));
    expect(progress.current).toBe(1);
    expect(progress.step1Done).toBe(false);
    expect(progress.step2Done).toBe(false);
  });

  it('今日の記録ができていればステップ2（セットはまだ）', () => {
    const core = makeCore({
      [keyDaysAgo(0)]: { done: {}, short: false, dayType: 'training' },
    });
    const progress = practiceGuideProgress(core, keyDaysAgo(0));
    expect(progress.current).toBe(2);
    expect(progress.step1Done).toBe(true);
    expect(progress.step2Done).toBe(false);
  });

  it('1セットでも記録すればステップ3', () => {
    const core = makeCore({
      [keyDaysAgo(0)]: { done: { ex1: 1 }, short: false, dayType: 'training' },
    });
    const progress = practiceGuideProgress(core, keyDaysAgo(0));
    expect(progress.current).toBe(3);
    expect(progress.step1Done).toBe(true);
    expect(progress.step2Done).toBe(true);
  });
});

describe('sanitizePrefs の practiceGuideDismissed', () => {
  it('既定は false で、旧データ（項目なし）でも false になる', () => {
    expect(sanitizePrefs({}).practiceGuideDismissed).toBe(false);
    expect(sanitizePrefs(null).practiceGuideDismissed).toBe(false);
  });

  it('true のときだけ true になる', () => {
    expect(sanitizePrefs({ practiceGuideDismissed: true }).practiceGuideDismissed).toBe(true);
    expect(sanitizePrefs({ practiceGuideDismissed: 'yes' }).practiceGuideDismissed).toBe(false);
  });
});
