'use client';

/* 年間ヒートマップ（自前CSSグリッド）。1日1マスで、列が週（月曜はじまり）。
   各マスの状態の判定は lib/logic.ts の heatmapDays が行う。
   カレンダーと同じ状態を色分けし、title で日付と状態が読めるようにする。 */

import { formatDateJa, parseKey } from '../lib/dates';
import type { HeatmapDay, HeatmapState } from '../lib/types';

const STATE_LABELS: Record<HeatmapState, string> = {
  done: '完了',
  'done-short': '短縮で完了',
  rest: '休みの日',
  missed: '未完了',
  future: 'まだ先の日付です',
};

export function Heatmap({ days, year }: { days: HeatmapDay[]; year: number }) {
  /* 先頭の空白マス: 1月1日の曜日（月曜=0）だけ前に詰める */
  const firstOffset = (new Date(year, 0, 1).getDay() + 6) % 7;
  const countOf = (state: HeatmapState) => days.filter((d) => d.state === state).length;
  const summary =
    `${year}年の記録を1日1マスで表した図です。` +
    `完了${countOf('done')}日、短縮で完了${countOf('done-short')}日、` +
    `未完了${countOf('missed')}日、休みの日${countOf('rest')}日です。`;
  return (
    <div>
      <div className="heatmap-scroll">
        <div className="heatmap" role="img" aria-label={summary}>
          {Array.from({ length: firstOffset }, (_, i) => (
            <span key={`blank-${i}`} className="heatmap__cell heatmap__cell--blank" aria-hidden="true" />
          ))}
          {days.map((d) => (
            <span
              key={d.key}
              className={`heatmap__cell heatmap__cell--${d.state}`}
              title={`${formatDateJa(parseKey(d.key))}: ${STATE_LABELS[d.state]}`}
            />
          ))}
        </div>
      </div>
      <ul className="legend">
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--done" aria-hidden="true" /> 完了
        </li>
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--done-short" aria-hidden="true" /> 短縮で完了
        </li>
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--rest" aria-hidden="true" /> 休みの日
        </li>
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--missed" aria-hidden="true" /> 未完了
        </li>
      </ul>
    </div>
  );
}
