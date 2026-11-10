import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SEED_EXERCISES } from '../lib/constants';
import { addDays, dateKeyOf, todayDate } from '../lib/dates';
import {
  calcStreak,
  dayStats,
  periodStats,
  pickAdviceKey,
} from '../lib/logic';
import { clone } from '../lib/sanitize';
import {
  buildExportPayload,
  decodeTransferCode,
  encodeTransferCode,
  validateImportData,
} from '../lib/transfer';
import type { CoreData, DayRecord } from '../lib/types';

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
    prefs: { schemaVersion: 1, guideDismissed: false, exportLastAt: '', mpYear: null, mpMonth: null, mpWeek: '', startPresetDone: false },
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
