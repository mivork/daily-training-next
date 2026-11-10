import { describe, expect, it} from 'vitest';
import { DEFAULT_SETTINGS} from '../lib/constants';
import { dateKeyOf} from '../lib/dates';
import { buildConsultSummary, fourWeekComparison, insightsFor} from '../lib/logic';
import type {
BodyData,
CoreData,
DayRecord,
Exercise,
RecordsMap,
Settings,
} from '../lib/types';

const EX1: Exercise = {
id: 'ex1',
name: '腕立て伏せ',
amount: 20,
unit: '回',
sets: 2,
note: '',
};
const EX2: Exercise = {
id: 'ex2',
name: 'プランク',
amount: 30,
unit: '秒',
sets: 2,
note: '',
};

function makeCore(records: RecordsMap, settingsPatch: Partial<Settings> = {}): CoreData {
return {
exercises: [EX1, EX2],
records,
settings: {...DEFAULT_SETTINGS,...settingsPatch},
};
}

/* 両種目とも目標セット数まで完了した日の記録（logic.test.ts と同じ形） */
function completeRecord(): DayRecord {
return {
done: { ex1: 2, ex2: 2},
short: false,
dayType: 'training',
targets: { ex1: 2, ex2: 2},
names: { ex1: '腕立て伏せ', ex2: 'プランク'},
amounts: { ex1: 20, ex2: 30},
units: { ex1: '回', ex2: '秒'},
};
}

function keyDaysAgo(n: number): string {
const d = new Date();
d.setDate(d.getDate() - n);
return dateKeyOf(d);
}

describe('insightsFor', () => {
it('記録が無ければ気づきは出ない', () => {
expect(insightsFor(makeCore({}), {})).toEqual([]);
});

it('連続記録: 現在と最長、あと何日で最長更新か', () => {
/* 10〜14日前の5日連続（過去最長）と、直近3日連続（現在） */
const records: RecordsMap = {};
[10, 11, 12, 13, 14].forEach((n) => {
records[keyDaysAgo(n)] = completeRecord();
});
[0, 1, 2].forEach((n) => {
records[keyDaysAgo(n)] = completeRecord();
});
const streak = insightsFor(makeCore(records), {}).find((i) => i.key === 'streak');
expect(streak).toBeDefined();
expect(streak?.text).toContain('現在の連続は3日');
expect(streak?.text).toContain('過去最長は5日');
expect(streak?.text).toContain('あと3日続けると、最長記録を更新できます');
});

it('直近4週間の完了率が上がっていれば「流れ」の気づきが出る', () => {
const records: RecordsMap = {};
/* 直近4週間: 28日すべて完了 */
for (let n = 0; n < 28; n++) records[keyDaysAgo(n)] = completeRecord();
const { current, previous} = fourWeekComparison(makeCore(records));
expect(current.rate).toBe(100);
expect(previous.rate).toBe(0);
const trend = insightsFor(makeCore(records), {}).find((i) => i.key === 'trend');
expect(trend).toBeDefined();
expect(trend?.text).toContain('直近4週間の完了率は100%');
expect(trend?.text).toContain('その前4週間は0%でした');
expect(trend?.text).toContain('上向いています');
});

it('曜日別の弱点: 特定の曜日だけ未完了だと、その曜日の気づきが出る', () => {
/* 過去35日、ある曜日（明日の曜日）だけ記録なし＝未完了にする */
const weakWeekday = (new Date().getDay() + 1) % 7;
const records: RecordsMap = {};
for (let n = 0; n < 35; n++) {
const d = new Date();
d.setDate(d.getDate() - n);
if (d.getDay() === weakWeekday) continue;
records[dateKeyOf(d)] = completeRecord();
}
const weekday = insightsFor(makeCore(records), {}).find((i) => i.key === 'weekday');
expect(weekday).toBeDefined();
expect(weekday?.text).toContain('完了率が0%');
});

it('種目の偏り: セット数が偏っていれば出る、そろっていれば出ない', () => {
const records: RecordsMap = {};
for (let n = 0; n < 6; n++) {
records[keyDaysAgo(n)] = {
done: { ex1: 2, ex2: 1},
short: false,
dayType: 'training',
targets: { ex1: 2, ex2: 2},
names: { ex1: '腕立て伏せ', ex2: 'プランク'},
amounts: { ex1: 20, ex2: 30},
units: { ex1: '回', ex2: '秒'},
};
}
const biased = insightsFor(makeCore(records), {}).find((i) => i.key === 'exercise');
expect(biased).toBeDefined();
expect(biased?.text).toContain('「腕立て伏せ」が12セットで一番多く');
expect(biased?.text).toContain('「プランク」が6セットで少なめです');

/* そろっている場合は出ない */
const even: RecordsMap = {};
for (let n = 0; n < 6; n++) even[keyDaysAgo(n)] = completeRecord();
expect(insightsFor(makeCore(even), {}).find((i) => i.key === 'exercise')).toBeUndefined();
});

it('短縮モードの活用: 短縮で完了した日の割合が出る', () => {
const records: RecordsMap = {};
/* 直近5日を短縮モードで完了（短縮の目標は両種目1セット） */
for (let n = 0; n < 5; n++) {
records[keyDaysAgo(n)] = {
done: { ex1: 1, ex2: 1},
short: true,
dayType: 'training',
targets: { ex1: 2, ex2: 2},
names: { ex1: '腕立て伏せ', ex2: 'プランク'},
amounts: { ex1: 20, ex2: 30},
units: { ex1: '回', ex2: '秒'},
};
}
const short = insightsFor(makeCore(records), {}).find((i) => i.key === 'short');
expect(short).toBeDefined();
expect(short?.text).toContain('5日のうち5日（100%）');
});

it('体重の変化ペース: 約1か月で1kg減なら月あたり約-1kg', () => {
const bodyData: BodyData = {
'2026-09-30': { weight: 62},
'2026-10-15': { weight: 61.6},
'2026-10-30': { weight: 61},
};
const weight = insightsFor(makeCore({}), bodyData, new Date(2026, 10, 5)).find(
(i) => i.key === 'weight',
);
expect(weight).toBeDefined();
expect(weight?.text).toContain('直近約1か月で-1kgの変化');
expect(weight?.text).toContain('月あたり約-1kgのペース');
expect(weight?.text).toContain('移動平均');
});

it('体重: 測定間隔が短すぎる場合は出ない', () => {
const bodyData: BodyData = {
'2026-10-28': { weight: 61},
'2026-10-30': { weight: 60.8},
};
expect(
insightsFor(makeCore({}), bodyData, new Date(2026, 10, 5)).find((i) => i.key === 'weight'),
).toBeUndefined();
});
});

describe('buildConsultSummary', () => {
it('記録が無くても崩れず、未記録の案内になる', () => {
const text = buildConsultSummary({...makeCore({}), bodyData: {}});
expect(text).toContain('');
expect(text).toContain('・まだ記録がありません。');
expect(text).toContain('アドバイスをお願いします');
});

it('統計・種目別・からだ・気づきを含むまとめを作る', () => {
const records: RecordsMap = {};
[0, 1, 2, 3, 4].forEach((n) => {
records[keyDaysAgo(n)] = completeRecord();
});
const bodyData: BodyData = {
'2026-10-01': { weight: 62},
'2026-10-31': { weight: 61},
};
const text = buildConsultSummary(
{...makeCore(records, { heightCm: 160}), bodyData},
new Date(2026, 10, 10),
);
expect(text).toContain('■ トレーニング（全期間）');
expect(text).toContain('完了日数: 5日');
expect(text).toContain('現在の連続: 5日');
expect(text).toContain('■ 種目別の合計');
expect(text).toContain('・腕立て伏せ: 10セット・合計200回');
expect(text).toContain('■ からだデータ');
expect(text).toContain('体重: 最新61kg');
expect(text).toContain('BMI: 23.8');
expect(text).toContain('■ アプリの分析メモ');
});
});
