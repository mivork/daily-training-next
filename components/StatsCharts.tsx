'use client';

/* マイページのグラフ群（Chart.js）。重いので MyPageView 側で
   next/dynamic（ssr: false）を使って遅延読み込みしている。
   色は夕日テーマの CSS 変数から読み、data-theme の変化に追随する。
   数値の正確な値は期間の比較などのテキスト側にも残してある。 */

import { useEffect, useMemo, useState } from 'react';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Bar, Chart, Line } from 'react-chartjs-2';
import { formatShortDate, parseKey } from '../lib/dates';
import type { ExerciseRepTotal, ExerciseSetTotal, WeekTrendPoint, WeekdayRate } from '../lib/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const FONT_FAMILY =
  '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif';
ChartJS.defaults.font.family = FONT_FAMILY;
/* 軸ラベルや凡例の既定サイズ（12px）は小さめなので、全グラフ共通で少し大きくする */
ChartJS.defaults.font.size = 13;

interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  primary: string;
  line: string;
  /* 主色より淡い夕日色（ランキングで自分以外のバーに使う） */
  soft: string;
}

/* 現在のテーマ（data-theme）に応じた色を CSS 変数から読む */
function readChartColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--color-text', '#2b1d16'),
    muted: v('--color-text-muted', '#6f5546'),
    grid: v('--color-border', '#cbb59f'),
    primary: v('--color-primary', '#c2410c'),
    line: v('--color-focus', '#b45309'),
    soft: v('--color-heat-short', '#f0b27a'),
  };
}

/* 横棒グラフの本数に応じた高さのクラス（回数グラフと共通の決め方） */
function rowsBoxClass(count: number): string {
  return count <= 3
    ? 'chart-box chart-box--rows-few'
    : count <= 6
      ? 'chart-box chart-box--rows-mid'
      : 'chart-box chart-box--rows-many';
}

/* data-theme の付け替え（テーマ切替）を監視して色を読み直す */
function useChartColors(): ChartColors {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute('data-theme') ?? '',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') ?? '');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => {
    void theme;
    return readChartColors();
  }, [theme]);
}

/* 週ごとの推移: 完了日数（棒・左軸）と完了率（折れ線・右軸）の複合グラフ */
export function WeeklyTrendChart({ points }: { points: WeekTrendPoint[] }) {
  const colors = useChartColors();
  const data: ChartData<'bar' | 'line', (number | null)[], string> = {
    labels: points.map((p) => p.label),
    datasets: [
      {
        type: 'bar',
        label: '完了日数',
        data: points.map((p) => p.completeDays),
        backgroundColor: colors.primary,
        borderRadius: 4,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: '完了率（%）',
        data: points.map((p) => p.rate),
        borderColor: colors.line,
        backgroundColor: colors.line,
        pointBackgroundColor: colors.line,
        yAxisID: 'y1',
        order: 1,
        spanGaps: false,
        tension: 0.25,
      },
    ],
  };
  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
      y: {
        type: 'linear',
        position: 'left',
        min: 0,
        suggestedMax: 7,
        ticks: { color: colors.muted, stepSize: 1 },
        grid: { color: colors.grid },
        title: { display: true, text: '完了日数（日）', color: colors.muted },
      },
      y1: {
        type: 'linear',
        position: 'right',
        min: 0,
        max: 100,
        ticks: { color: colors.muted, stepSize: 25 },
        grid: { drawOnChartArea: false },
        title: { display: true, text: '完了率（%）', color: colors.muted },
      },
    },
    plugins: {
      legend: { labels: { color: colors.text } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const point = points[items[0]?.dataIndex ?? 0];
            return point ? `${point.label}の週（トレーニング日${point.trainingDays}日）` : '';
          },
        },
      },
    },
  };
  const latest = points[points.length - 1];
  const summary = latest
    ? `直近${points.length}週の完了日数と完了率のグラフです。今週は今日までで、トレーニング日${latest.trainingDays}日のうち${latest.completeDays}日完了しています。`
    : '週ごとの推移のグラフです。';
  return (
    <div className="chart-box">
      <Chart type="bar" data={data} options={options} role="img" aria-label={summary} />
    </div>
  );
}

/* からだデータの推移: 実測の折れ線（点つき）と移動平均（破線）の重ね描き。
   keys は最初の測定日から最後の測定日までの全日で、測っていない日は
   values / averages が null。補間せず spanGaps で線をつなぐ。 */
export function BodyLineChart({
  keys,
  values,
  averages,
  label,
  unit,
  summary,
}: {
  keys: string[];
  values: (number | null)[];
  averages: (number | null)[] | null;
  label: string;
  unit: string;
  summary: string;
}) {
  const colors = useChartColors();
  const datasets: ChartData<'line', (number | null)[], string>['datasets'] = [
    {
      label,
      data: values,
      borderColor: colors.primary,
      backgroundColor: colors.primary,
      pointBackgroundColor: colors.primary,
      spanGaps: true,
      tension: 0.25,
      pointRadius: 3,
    },
  ];
  if (averages) {
    datasets.push({
      label: '移動平均',
      data: averages,
      borderColor: colors.line,
      backgroundColor: colors.line,
      borderDash: [6, 4],
      pointRadius: 0,
      spanGaps: true,
      tension: 0.25,
    });
  }
  const data: ChartData<'line', (number | null)[], string> = {
    labels: keys.map((k) => formatShortDate(parseKey(k))),
    datasets,
  };
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        ticks: { color: colors.muted, maxTicksLimit: 10 },
        grid: { color: colors.grid },
      },
      y: {
        grace: '15%',
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
        title: { display: true, text: `${label}（${unit}）`, color: colors.muted },
      },
    },
    plugins: {
      legend: { labels: { color: colors.text } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const k = keys[items[0]?.dataIndex ?? 0];
            return k ? formatShortDate(parseKey(k)) : '';
          },
          label: (item) =>
            item.parsed.y === null ? '' : `${item.dataset.label}: ${item.parsed.y}${unit}`,
        },
      },
    },
  };
  return (
    <div className="chart-box">
      <Line data={data} options={options} role="img" aria-label={summary} />
    </div>
  );
}

/* からだデータの期間比較: 今の期間の平均と前の期間の平均を並べた棒グラフ。
   データが無い期間は null にしてバー自体を出さない（注記は呼び出し側のテキストで伝える）。 */
export function BodyCompareBarChart({
  current,
  previous,
  label,
  unit,
  summary,
}: {
  current: number | null;
  previous: number | null;
  label: string;
  unit: string;
  summary: string;
}) {
  const colors = useChartColors();
  const data: ChartData<'bar', (number | null)[], string> = {
    labels: ['今の期間', '前の期間'],
    datasets: [
      {
        label: `${label}の平均`,
        data: [current, previous],
        backgroundColor: [colors.primary, colors.line],
        borderRadius: 4,
        maxBarThickness: 72,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
      y: {
        grace: '15%',
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
        title: { display: true, text: `${label}（${unit}）`, color: colors.muted },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) =>
            item.parsed.y === null ? '' : `${item.label}の平均: ${item.parsed.y}${unit}`,
        },
      },
    },
  };
  return (
    <div className="chart-box chart-box--monthly">
      <Bar data={data} options={options} role="img" aria-label={summary} />
    </div>
  );
}

/* 月別の完了日数: 選択中の年の12か月の棒グラフ */
export function MonthlyBarChart({ year, counts }: { year: number; counts: number[] }) {
  const colors = useChartColors();
  const data: ChartData<'bar', number[], string> = {
    labels: counts.map((_, i) => `${i + 1}月`),
    datasets: [
      {
        label: '完了日数',
        data: counts,
        backgroundColor: colors.primary,
        borderRadius: 4,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
      y: {
        min: 0,
        suggestedMax: Math.max(1, ...counts) + 1,
        ticks: { color: colors.muted, stepSize: 1 },
        grid: { color: colors.grid },
        title: { display: true, text: '完了日数（日）', color: colors.muted },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            const idx = items[0]?.dataIndex ?? 0;
            return `${year}年${idx + 1}月`;
          },
          label: (item) => `完了日数: ${item.parsed.y}日`,
        },
      },
    },
  };
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="chart-box chart-box--monthly">
      <Bar
        data={data}
        options={options}
        role="img"
        aria-label={`${year}年の月ごとの完了日数のグラフです。合計${total}日完了しています。`}
      />
    </div>
  );
}

/* 種目別の合計回数: 横棒グラフ（「回」の種目だけ） */
export function ExerciseRepsChart({ totals }: { totals: ExerciseRepTotal[] }) {
  const colors = useChartColors();
  const data: ChartData<'bar', number[], string> = {
    labels: totals.map((t) => t.name),
    datasets: [
      {
        label: '合計回数',
        data: totals.map((t) => t.reps),
        backgroundColor: colors.primary,
        borderRadius: 4,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        min: 0,
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
        title: { display: true, text: '合計回数（回）', color: colors.muted },
      },
      y: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => `合計 ${item.parsed.x}回`,
        },
      },
    },
  };
  const boxClass = rowsBoxClass(totals.length);
  const top = totals[0];
  return (
    <div className={boxClass}>
      <Bar
        data={data}
        options={options}
        role="img"
        aria-label={
          top
            ? `種目別の合計回数のグラフです。いちばん多いのは${top.name}の${top.reps}回です。`
            : '種目別の合計回数のグラフです。'
        }
      />
    </div>
  );
}

/* 種目別の合計セット数: 横棒グラフ（「秒」の種目も含めた全種目） */
export function ExerciseSetsChart({ totals }: { totals: ExerciseSetTotal[] }) {
  const colors = useChartColors();
  const data: ChartData<'bar', number[], string> = {
    labels: totals.map((t) => t.name),
    datasets: [
      {
        label: '合計セット数',
        data: totals.map((t) => t.sets),
        backgroundColor: colors.primary,
        borderRadius: 4,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        min: 0,
        ticks: { color: colors.muted, stepSize: 1 },
        grid: { color: colors.grid },
        title: { display: true, text: '合計セット数（セット）', color: colors.muted },
      },
      y: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => `合計 ${item.parsed.x}セット`,
        },
      },
    },
  };
  const top = totals[0];
  return (
    <div className={rowsBoxClass(totals.length)}>
      <Bar
        data={data}
        options={options}
        role="img"
        aria-label={
          top
            ? `種目別の合計セット数のグラフです。いちばん多いのは${top.name}の${top.sets}セットです。`
            : '種目別の合計セット数のグラフです。'
        }
      />
    </div>
  );
}

/* 曜日別の完了率: 月〜日の棒グラフ。トレーニング日が無い曜日はバーを出さない。 */
export function WeekdayRateChart({ rates }: { rates: WeekdayRate[] }) {
  const colors = useChartColors();
  const data: ChartData<'bar', (number | null)[], string> = {
    labels: rates.map((r) => `${r.label}曜日`),
    datasets: [
      {
        label: '完了率',
        data: rates.map((r) => r.rate),
        backgroundColor: colors.primary,
        borderRadius: 4,
        maxBarThickness: 56,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
      y: {
        min: 0,
        max: 100,
        ticks: { color: colors.muted, stepSize: 25 },
        grid: { color: colors.grid },
        title: { display: true, text: '完了率（%）', color: colors.muted },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => {
            const r = rates[item.dataIndex];
            if (!r || r.rate === null) return 'トレーニング日はありません';
            return `完了率 ${r.rate}%（完了${r.completeDays}日／トレーニング日${r.trainingDays}日）`;
          },
        },
      },
    },
  };
  const best = rates
    .filter((r) => r.rate !== null)
    .reduce<WeekdayRate | null>((acc, r) => (acc === null || (r.rate ?? 0) > (acc.rate ?? 0) ? r : acc), null);
  return (
    <div className="chart-box chart-box--monthly">
      <Bar
        data={data}
        options={options}
        role="img"
        aria-label={
          best
            ? `曜日別の完了率のグラフです。いちばん高いのは${best.label}曜日の${best.rate}%です。`
            : '曜日別の完了率のグラフです。'
        }
      />
    </div>
  );
}

/* ランキングのグラフ: 1件分の表示データ（ラベルは「○位 ニックネーム」形式で
   呼び出し側が組み立てる。mine は自分の行かどうか） */
export interface RankingChartEntry {
  label: string;
  value: number;
  mine: boolean;
}

/* ランキングの横棒グラフ: 自分は夕日の主色、他の人は淡い色で色分けする。
   正確な順位・数値は併記される一覧（表）が正になる。 */
export function RankingChart({
  entries,
  metricLabel,
  unit,
}: {
  entries: RankingChartEntry[];
  metricLabel: string;
  unit: string;
}) {
  const colors = useChartColors();
  const data: ChartData<'bar', number[], string> = {
    labels: entries.map((e) => e.label),
    datasets: [
      {
        label: metricLabel,
        data: entries.map((e) => e.value),
        backgroundColor: entries.map((e) => (e.mine ? colors.primary : colors.soft)),
        borderRadius: 4,
      },
    ],
  };
  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        min: 0,
        ticks: { color: colors.muted, stepSize: 1 },
        grid: { color: colors.grid },
        title: { display: true, text: `${metricLabel}（${unit}）`, color: colors.muted },
      },
      y: {
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => `${item.parsed.x}${unit}`,
        },
      },
    },
  };
  const top = entries[0];
  const mine = entries.find((e) => e.mine);
  const summary = top
    ? `${metricLabel}のランキングのグラフです。トップは${top.label}の${top.value}${unit}です。${
        mine && mine !== top ? `あなたは${mine.label}で${mine.value}${unit}です。` : ''
      }`
    : `${metricLabel}のランキングのグラフです。`;
  return (
    <div className={rowsBoxClass(entries.length)}>
      <Bar data={data} options={options} role="img" aria-label={summary} />
    </div>
  );
}
