'use client';

/* マイページの「からだ」カード: 体重・体脂肪率・ウエストの記録とグラフ。
   測った日だけ記録する形式で、毎日記録しなくてもよい。
   グラフ（Chart.js）は既存グラフと同じく遅延読み込みにする。 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { BODY_RANGES, WEEKDAYS_JA } from '../lib/constants';
import {
  dateKeyOf,
  formatShortDate,
  isValidDateKey,
  parseKey,
  todayDate,
} from '../lib/dates';
import { bmiOf, bodyChartSeries, bodySeries, bodySummary, recentBodyEntries } from '../lib/logic';
import { useStore } from '../lib/store';
import type { BodyEntry, BodyField } from '../lib/types';

const chartLoading = () => <p className="empty-message">グラフを読み込み中…</p>;
const BodyLineChart = dynamic(() => import('./StatsCharts').then((m) => m.BodyLineChart), {
  ssr: false,
  loading: chartLoading,
});

const FIELDS: BodyField[] = ['weight', 'bodyFat', 'waist'];

/* 変化量の表示。プラスには + を付け、単位を添える（例: -0.5kg / +0.3%） */
function deltaText(value: number, unit: string): string {
  return `${value > 0 ? '+' : ''}${value}${unit}`;
}

function entryText(entry: BodyEntry): string {
  const parts: string[] = [];
  FIELDS.forEach((field) => {
    const v = entry[field];
    if (typeof v === 'number') parts.push(`${BODY_RANGES[field].label} ${v}${BODY_RANGES[field].unit}`);
  });
  return parts.join('・');
}

export function BodySection() {
  const { data, update, showToast, announce } = useStore();
  const todayKey = dateKeyOf(todayDate());

  /* 入力フォームの状態。日付を選ぶと、その日の記録があれば欄に読み込む */
  const [dateInput, setDateInput] = useState(todayKey);
  const [weightInput, setWeightInput] = useState(() =>
    typeof data.bodyData[todayKey]?.weight === 'number' ? String(data.bodyData[todayKey].weight) : '',
  );
  const [fatInput, setFatInput] = useState(() =>
    typeof data.bodyData[todayKey]?.bodyFat === 'number' ? String(data.bodyData[todayKey].bodyFat) : '',
  );
  const [waistInput, setWaistInput] = useState(() =>
    typeof data.bodyData[todayKey]?.waist === 'number' ? String(data.bodyData[todayKey].waist) : '',
  );
  const [status, setStatus] = useState('');

  const loadDay = (key: string) => {
    setDateInput(key);
    if (!isValidDateKey(key)) return;
    const entry = data.bodyData[key];
    setWeightInput(typeof entry?.weight === 'number' ? String(entry.weight) : '');
    setFatInput(typeof entry?.bodyFat === 'number' ? String(entry.bodyFat) : '');
    setWaistInput(typeof entry?.waist === 'number' ? String(entry.waist) : '');
    setStatus('');
  };

  const parseField = (text: string, field: BodyField): { value?: number; error?: string } => {
    const t = text.trim();
    if (t === '') return {};
    const range = BODY_RANGES[field];
    const n = Number(t);
    if (!Number.isFinite(n) || n < range.min || n > range.max) {
      return { error: `${range.label}は${range.min}〜${range.max}${range.unit}で入力してください。` };
    }
    return { value: Math.round(n * 10) / 10 };
  };

  const save = () => {
    if (!isValidDateKey(dateInput)) {
      setStatus('日付を正しく選んでください。');
      return;
    }
    if (dateInput > todayKey) {
      setStatus('未来の日付には記録できません。');
      return;
    }
    const w = parseField(weightInput, 'weight');
    const f = parseField(fatInput, 'bodyFat');
    const u = parseField(waistInput, 'waist');
    const error = w.error ?? f.error ?? u.error;
    if (error) {
      setStatus(error);
      return;
    }
    const entry: BodyEntry = {};
    if (w.value !== undefined) entry.weight = w.value;
    if (f.value !== undefined) entry.bodyFat = f.value;
    if (u.value !== undefined) entry.waist = u.value;
    const next = { ...data.bodyData };
    if (Object.keys(entry).length === 0) {
      if (next[dateInput]) {
        delete next[dateInput];
        update({ bodyData: next });
        setStatus(`${formatShortDate(parseKey(dateInput))}のからだデータを削除しました。`);
        announce('からだデータを削除しました');
      } else {
        setStatus('体重・体脂肪率・ウエストのどれか1つは入力してください。');
      }
      return;
    }
    next[dateInput] = entry;
    update({ bodyData: next });
    setStatus(`${formatShortDate(parseKey(dateInput))}のからだデータを保存しました。`);
    showToast();
    announce('からだデータを保存しました');
  };

  const removeDay = () => {
    const next = { ...data.bodyData };
    delete next[dateInput];
    update({ bodyData: next });
    setWeightInput('');
    setFatInput('');
    setWaistInput('');
    setStatus(`${formatShortDate(parseKey(dateInput))}のからだデータを削除しました。`);
    announce('からだデータを削除しました');
  };

  const weightSummary = bodySummary(data.bodyData, 'weight');
  const bmi = weightSummary ? bmiOf(weightSummary.latest.value, data.settings.heightCm) : null;
  const recent = recentBodyEntries(data.bodyData, 10);
  const selectedEntry = isValidDateKey(dateInput) ? data.bodyData[dateInput] : undefined;

  return (
    <section className="card mypage-layout__wide" id="sec-body" aria-labelledby="body-heading">
      <h2 id="body-heading">からだ</h2>
      <p className="settings-hint">
        体重・体脂肪率・ウエストを、測った日だけ記録できます。毎日でなくて大丈夫です。記録すると下にグラフが出ます。
      </p>

      {weightSummary ? (
        <dl className="totals-grid">
          <div className="totals-grid__item">
            <dt>最新の体重（{formatShortDate(parseKey(weightSummary.latest.key))}）</dt>
            <dd>{weightSummary.latest.value}kg</dd>
          </div>
          <div className="totals-grid__item">
            <dt>前回の測定から</dt>
            <dd>
              {weightSummary.vsPrevious !== null ? deltaText(weightSummary.vsPrevious, 'kg') : '—'}
            </dd>
          </div>
          <div className="totals-grid__item">
            <dt>最初の記録から</dt>
            <dd>{deltaText(weightSummary.vsFirst, 'kg')}</dd>
          </div>
          {bmi !== null && (
            <div className="totals-grid__item">
              <dt>BMI（最新の体重から）</dt>
              <dd>{bmi}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="settings-hint">体重を記録すると、ここに最新の値と変化が出ます。</p>
      )}
      {data.settings.heightCm === 0 && (
        <p className="settings-hint">
          身長を「設定」画面で入力すると、最新の体重から BMI も表示されます（BMI
          の計算にだけ使います）。
        </p>
      )}

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="body-date">
            日付
          </label>
          <input
            type="date"
            id="body-date"
            value={dateInput}
            max={todayKey}
            onChange={(e) => loadDay(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="body-weight">
            体重（kg）
          </label>
          <input
            type="number"
            id="body-weight"
            inputMode="decimal"
            step={0.1}
            min={BODY_RANGES.weight.min}
            max={BODY_RANGES.weight.max}
            placeholder="例: 60.5"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="body-fat">
            体脂肪率（%・任意）
          </label>
          <input
            type="number"
            id="body-fat"
            inputMode="decimal"
            step={0.1}
            min={BODY_RANGES.bodyFat.min}
            max={BODY_RANGES.bodyFat.max}
            placeholder="例: 18.5"
            value={fatInput}
            onChange={(e) => setFatInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="body-waist">
            ウエスト（cm・任意）
          </label>
          <input
            type="number"
            id="body-waist"
            inputMode="decimal"
            step={0.1}
            min={BODY_RANGES.waist.min}
            max={BODY_RANGES.waist.max}
            placeholder="例: 72.0"
            value={waistInput}
            onChange={(e) => setWaistInput(e.target.value)}
          />
        </div>
      </div>
      <div className="data-actions__row">
        <button type="button" className="btn btn--primary" onClick={save}>
          からだデータを保存
        </button>
        {selectedEntry && (
          <button type="button" className="btn btn--danger" onClick={removeDay}>
            この日のデータを削除
          </button>
        )}
      </div>
      <p className="data-status" role="status">
        {status}
      </p>

      {FIELDS.map((field) => {
        const range = BODY_RANGES[field];
        const points = bodySeries(data.bodyData, field);
        if (points.length === 0) return null;
        const chart = bodyChartSeries(data.bodyData, field);
        const summary = bodySummary(data.bodyData, field);
        const summaryText = summary
          ? `${range.label}の推移のグラフです。最新は${formatShortDate(parseKey(summary.latest.key))}の${summary.latest.value}${range.unit}で、全部で${summary.count}回記録があります。`
          : `${range.label}の推移のグラフです。`;
        return (
          <div className="body-chart" key={field}>
            <h3>
              {range.label}の推移
            </h3>
            <BodyLineChart
              keys={chart.keys}
              values={chart.values}
              averages={points.length >= 2 ? chart.averages : null}
              label={range.label}
              unit={range.unit}
              summary={summaryText}
            />
            <ul className="visually-hidden">
              {points.map((p) => (
                <li key={p.key}>
                  {formatShortDate(parseKey(p.key))}: {p.value}
                  {range.unit}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {recent.length > 0 && (
        <>
          <h3>最近の記録</h3>
          <ul className="ex-totals">
            {recent.map(({ key, entry }) => (
              <li className="ex-totals__row" key={key}>
                <span className="ex-totals__name">
                  {formatShortDate(parseKey(key))}（{WEEKDAYS_JA[parseKey(key).getDay()]}）
                </span>
                <span className="ex-totals__value">{entryText(entry)}</span>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={`${formatShortDate(parseKey(key))}のからだデータを編集`}
                  onClick={() => loadDay(key)}
                >
                  編集
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
