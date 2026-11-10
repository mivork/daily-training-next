import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import {
  bmiOf,
  bodyChartSeries,
  bodyEntries,
  bodySeries,
  bodySummary,
  movingAveragePoints,
  recentBodyEntries,
} from '../lib/logic';
import { clone, sanitizeBodyData, sanitizeSettings } from '../lib/sanitize';
import { buildExportPayload, validateImportData } from '../lib/transfer';
import type { BodyData } from '../lib/types';

/* 1日おきに測った想定のサンプル（体重は少しずつ減少、体脂肪率は一部のみ） */
const sample: BodyData = {
  '2026-11-01': { weight: 62.0, bodyFat: 20.0, waist: 78.0 },
  '2026-11-03': { weight: 61.5 },
  '2026-11-05': { weight: 61.8, bodyFat: 19.5 },
  '2026-11-07': { weight: 60.9 },
  '2026-11-09': { weight: 61.2, waist: 77.0 },
};

describe('bodySeries', () => {
  it('項目を測った日だけを古い順に取り出す', () => {
    expect(bodySeries(sample, 'weight')).toEqual([
      { key: '2026-11-01', value: 62.0 },
      { key: '2026-11-03', value: 61.5 },
      { key: '2026-11-05', value: 61.8 },
      { key: '2026-11-07', value: 60.9 },
      { key: '2026-11-09', value: 61.2 },
    ]);
    expect(bodySeries(sample, 'bodyFat')).toEqual([
      { key: '2026-11-01', value: 20.0 },
      { key: '2026-11-05', value: 19.5 },
    ]);
    expect(bodySeries({}, 'weight')).toEqual([]);
  });
});

describe('bodyEntries / recentBodyEntries', () => {
  it('測定がある日だけを取り出し、最近の記録は新しい順', () => {
    expect(bodyEntries(sample)).toHaveLength(5);
    const recent = recentBodyEntries(sample, 2);
    expect(recent.map((r) => r.key)).toEqual(['2026-11-09', '2026-11-07']);
    /* 空のエントリは数えない */
    expect(bodyEntries({ '2026-11-01': {} })).toEqual([]);
  });
});

describe('movingAveragePoints', () => {
  it('直近の測定最大7回分の平均を出す', () => {
    const points = bodySeries(sample, 'weight');
    const avg = movingAveragePoints(points, 3);
    expect(avg.map((p) => p.value)).toEqual([62.0, 61.8, 61.8, 61.4, 61.3]);
    /* キーは元の測定日と揃う */
    expect(avg.map((p) => p.key)).toEqual(points.map((p) => p.key));
  });

  it('測定が1つだけならその値が平均になる', () => {
    expect(movingAveragePoints([{ key: '2026-11-01', value: 55.5 }])).toEqual([
      { key: '2026-11-01', value: 55.5 },
    ]);
    expect(movingAveragePoints([])).toEqual([]);
  });
});

describe('bodyChartSeries', () => {
  it('測っていない日は null にして全日を並べる', () => {
    const chart = bodyChartSeries(sample, 'weight');
    expect(chart.keys).toHaveLength(9); // 11/1〜11/9
    expect(chart.keys[0]).toBe('2026-11-01');
    expect(chart.keys[8]).toBe('2026-11-09');
    /* 11/2 は測定なし → 実測も移動平均も null */
    expect(chart.values[1]).toBeNull();
    expect(chart.averages[1]).toBeNull();
    expect(chart.values[0]).toBe(62.0);
    expect(chart.values[2]).toBe(61.5);
    expect(chart.averages[0]).toBe(62.0);
  });

  it('データが無ければ空を返す', () => {
    expect(bodyChartSeries({}, 'weight')).toEqual({ keys: [], values: [], averages: [] });
  });
});

describe('bodySummary', () => {
  it('最新・前回・最初と変化を出す', () => {
    const s = bodySummary(sample, 'weight');
    expect(s).not.toBeNull();
    expect(s!.latest).toEqual({ key: '2026-11-09', value: 61.2 });
    expect(s!.previous).toEqual({ key: '2026-11-07', value: 60.9 });
    expect(s!.first).toEqual({ key: '2026-11-01', value: 62.0 });
    expect(s!.vsPrevious).toBe(0.3);
    expect(s!.vsFirst).toBe(-0.8);
    expect(s!.count).toBe(5);
  });

  it('測定が1回だけなら前回比は null、最初からの変化は 0', () => {
    const s = bodySummary({ '2026-11-01': { weight: 60 } }, 'weight');
    expect(s!.vsPrevious).toBeNull();
    expect(s!.vsFirst).toBe(0);
    expect(s!.count).toBe(1);
  });

  it('その項目の測定が無ければ null', () => {
    expect(bodySummary({ '2026-11-01': { bodyFat: 20 } }, 'weight')).toBeNull();
    expect(bodySummary({}, 'weight')).toBeNull();
  });
});

describe('bmiOf', () => {
  it('体重と身長から BMI を出す（小数1桁）', () => {
    expect(bmiOf(61.2, 170)).toBe(21.2);
  });

  it('身長が未設定（0）や範囲外なら null', () => {
    expect(bmiOf(61.2, 0)).toBeNull();
    expect(bmiOf(61.2, 99)).toBeNull();
    expect(bmiOf(61.2, 251)).toBeNull();
    expect(bmiOf(0, 170)).toBeNull();
  });
});

describe('sanitizeBodyData', () => {
  it('不正な日付・範囲外の値・空のエントリを落とす', () => {
    const cleaned = sanitizeBodyData({
      '2026-11-01': { weight: 61.25, bodyFat: 20 },
      '2026-13-01': { weight: 60 },
      '2026-11-02': { weight: 500 },
      '2026-11-03': {},
      '2026-11-04': { waist: 'abc' },
    });
    expect(Object.keys(cleaned)).toEqual(['2026-11-01']);
    /* 小数1桁に丸める */
    expect(cleaned['2026-11-01'].weight).toBe(61.3);
    expect(cleaned['2026-11-01'].bodyFat).toBe(20);
  });

  it('旧データ（undefined や null）では空になる', () => {
    expect(sanitizeBodyData(undefined)).toEqual({});
    expect(sanitizeBodyData(null)).toEqual({});
  });
});

describe('sanitizeSettings の heightCm', () => {
  it('身長を読み取り、旧データでは未設定（0）になる', () => {
    expect(sanitizeSettings({ ...clone(DEFAULT_SETTINGS), heightCm: 170 }).heightCm).toBe(170);
    expect(sanitizeSettings({}).heightCm).toBe(0);
    expect(sanitizeSettings({ ...clone(DEFAULT_SETTINGS), heightCm: 999 }).heightCm).toBe(250);
  });
});

describe('validateImportData の bodyData', () => {
  const baseData = {
    exercises: [],
    records: {},
    settings: clone(DEFAULT_SETTINGS),
    profile: { image: '', bio: '' },
    rivals: [],
    bodyData: clone(sample),
    prefs: clone({
      schemaVersion: 1,
      guideDismissed: false,
      practiceGuideDismissed: false,
      tutorialSeen: false,
      exportLastAt: '',
      mpYear: null,
      mpMonth: null,
      mpWeek: '',
      startPresetDone: false,
    }),
  };

  it('からだデータ入りの書き出しを受け付け、そのまま取り込む', () => {
    const payload = buildExportPayload(baseData, '');
    const result = validateImportData(JSON.parse(JSON.stringify(payload)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bodyData).toEqual(sample);
    }
  });

  it('からだデータが無い旧形式の書き出しでは bodyData は null（保持）', () => {
    const payload = buildExportPayload(baseData, '') as unknown as Record<string, unknown>;
    delete payload.bodyData;
    const result = validateImportData(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bodyData).toBeNull();
    }
  });

  it('範囲外の体重があれば読み込めない', () => {
    const payload = buildExportPayload(baseData, '') as unknown as {
      bodyData: Record<string, Record<string, unknown>>;
    };
    payload.bodyData['2026-11-01'].weight = 999;
    const result = validateImportData(payload);
    expect(result.ok).toBe(false);
  });

  it('不正な日付キーのからだデータは読み込めない', () => {
    const payload = buildExportPayload(baseData, '') as unknown as {
      bodyData: Record<string, unknown>;
    };
    payload.bodyData['2026-02-30'] = { weight: 60 };
    const result = validateImportData(payload);
    expect(result.ok).toBe(false);
  });
});
