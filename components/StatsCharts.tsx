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
import type { ExerciseRepTotal, WeekTrendPoint } from '../lib/types';

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

interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  primary: string;
  line: string;
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
  };
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
  const boxClass =
    totals.length <= 3
      ? 'chart-box chart-box--rows-few'
      : totals.length <= 6
        ? 'chart-box chart-box--rows-mid'
        : 'chart-box chart-box--rows-many';
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
