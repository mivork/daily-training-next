'use client';

import { useEffect, useState } from 'react';
import { RANKING_LIMIT, RANKING_METRICS, type ViewName } from '../lib/constants';
import { rankingMetricValue, rankRankingRows } from '../lib/logic';
import { fetchMyStanding, fetchRankingTop, type MyStanding } from '../lib/ranking';
import { useStore } from '../lib/store';
import type { RankingMetricKey, RankingRow } from '../lib/types';

interface RankingViewProps {
  /* 表示中のビューかどうか。開いたときに最新のランキングを読み直す */
  active: boolean;
  showView: (view: ViewName) => void;
}

export function RankingView({ active, showView }: RankingViewProps) {
  const { cloudConfigured, user, data } = useStore();
  const optIn = data.settings.rankingOptIn;
  const userId = user?.id ?? null;

  const [metric, setMetric] = useState<RankingMetricKey>('week');
  const [rows, setRows] = useState<RankingRow[] | null>(null);
  const [standing, setStanding] = useState<MyStanding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!active || !cloudConfigured) return;
    let cancelled = false;
    // ランキング画面を開いたタイミングで読み直す（意図的なパターン）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    (async () => {
      const result = await fetchRankingTop(metric);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        setStanding(null);
        setLoading(false);
        return;
      }
      setRows(result.rows);
      /* 自分が上位に入っていない場合は、自分の順位を別枠で出すために取得する */
      if (userId && optIn && !result.rows.some((r) => r.userId === userId)) {
        const mine = await fetchMyStanding(userId, metric);
        if (cancelled) return;
        setStanding(mine);
      } else {
        setStanding(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, cloudConfigured, metric, reloadKey, userId, optIn]);

  if (!cloudConfigured) {
    return (
      <section className="card" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading">ランキング</h2>
        <p className="settings-hint">
          ランキングはオンライン版で使える機能です。この環境ではクラウド連携が未設定のため、この機能は使えません。
        </p>
      </section>
    );
  }

  const metricDef = RANKING_METRICS.find((m) => m.key === metric) ?? RANKING_METRICS[0];
  const ranked = rows !== null ? rankRankingRows(rows, metric) : [];

  return (
    <section className="card" aria-labelledby="ranking-heading">
      <h2 id="ranking-heading">ランキング</h2>
      <p className="settings-hint">
        参加しているみんなの記録です。記録が変わると自動で更新されます。
      </p>

      {/* 参加への案内 */}
      {!user ? (
        <div className="ranking-guide">
          <p>ランキングへの参加は、設定画面のアカウント欄でオンにできます（参加するかどうかは自由に選べます）。</p>
          <button type="button" className="btn btn--small" onClick={() => showView('settings')}>
            設定を開く
          </button>
        </div>
      ) : !optIn ? (
        <div className="ranking-guide">
          <p>
            あなたはまだランキングに参加していません。設定画面のアカウント欄で「ランキングに参加する」をオンにすると、ニックネームと記録がここに公開されます。
          </p>
          <button type="button" className="btn btn--small" onClick={() => showView('settings')}>
            設定を開く
          </button>
        </div>
      ) : (
        <p className="ranking-guide ranking-guide--joined">
          あなたもランキングに参加中です。表示名は「
          {data.settings.nickname.trim() !== '' ? data.settings.nickname.trim() : 'ゲスト'}」です。
        </p>
      )}

      {/* 指標の切り替え */}
      <div className="ranking-tabs" role="group" aria-label="ランキングの指標">
        {RANKING_METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`ranking-tabs__btn${metric === m.key ? ' ranking-tabs__btn--active' : ''}`}
            aria-pressed={metric === m.key}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error !== '' ? (
        <>
          <p className="data-status" role="alert">
            {error}
          </p>
          <button type="button" className="btn" onClick={() => setReloadKey((k) => k + 1)}>
            もう一度読み込む
          </button>
        </>
      ) : loading && rows === null ? (
        <p className="empty-message">読み込み中…</p>
      ) : rows !== null && rows.length === 0 ? (
        <p className="empty-message">まだ参加者がいません。最初の参加者になりましょう！</p>
      ) : (
        <>
          <ol className="ranking-list">
            {ranked.map((row) => {
              const mine = userId !== null && row.userId === userId;
              return (
                <li
                  key={row.userId}
                  className={`ranking-row${mine ? ' ranking-row--me' : ''}`}
                >
                  <span className="ranking-row__rank">{row.rank}位</span>
                  <span className="ranking-row__main">
                    <span className="ranking-row__name">
                      {row.nickname}
                      {mine && <span className="ranking-row__you">（あなた）</span>}
                    </span>
                    <span className="ranking-row__detail">
                      今週 {row.weekDone}日・連続 {row.streak}日・累計 {row.totalDays}日・
                      {row.totalSets}セット
                    </span>
                  </span>
                  <span className="ranking-row__value">
                    {rankingMetricValue(row, metric)}
                    {metricDef.unit}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* 自分が上位に入っていない場合の別枠表示 */}
          {userId && optIn && standing && (
            <div className="ranking-mine">
              <span className="ranking-row__rank">{standing.rank}位</span>
              <span className="ranking-row__main">
                <span className="ranking-row__name">
                  {standing.row.nickname}
                  <span className="ranking-row__you">（あなた）</span>
                </span>
                <span className="ranking-row__detail">上位{RANKING_LIMIT}件の外にいます</span>
              </span>
              <span className="ranking-row__value">
                {rankingMetricValue(standing.row, metric)}
                {metricDef.unit}
              </span>
            </div>
          )}
          {userId && optIn && !standing && rows !== null && !rows.some((r) => r.userId === userId) && (
            <p className="settings-hint">あなたの記録はまもなくランキングに反映されます。</p>
          )}

          <div className="data-actions__row">
            <button
              type="button"
              className="btn btn--small"
              disabled={loading}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {loading ? '読み込み中…' : '最新の状態に更新'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
