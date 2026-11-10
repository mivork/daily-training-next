'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { BodySection } from './BodySection';
import { Collapse } from './Collapse';
import { Heatmap } from './Heatmap';
import { RecordEditForm } from './RecordEditForm';

/* グラフ（Chart.js）は重いので、初期表示の対象から外して遅延読み込みする */
const chartLoading = () => <p className="empty-message">グラフを読み込み中…</p>;
const WeeklyTrendChart = dynamic(
  () => import('./StatsCharts').then((m) => m.WeeklyTrendChart),
  { ssr: false, loading: chartLoading },
);
const MonthlyBarChart = dynamic(
  () => import('./StatsCharts').then((m) => m.MonthlyBarChart),
  { ssr: false, loading: chartLoading },
);
const ExerciseRepsChart = dynamic(
  () => import('./StatsCharts').then((m) => m.ExerciseRepsChart),
  { ssr: false, loading: chartLoading },
);
const ExerciseSetsChart = dynamic(
  () => import('./StatsCharts').then((m) => m.ExerciseSetsChart),
  { ssr: false, loading: chartLoading },
);
const WeekdayRateChart = dynamic(
  () => import('./StatsCharts').then((m) => m.WeekdayRateChart),
  { ssr: false, loading: chartLoading },
);
import { FILE_LIMITS, PROFILE_BIO_MAX, RIVAL_METRICS, type RivalMetricKey } from '../lib/constants';
import {
  addDays,
  dateKeyOf,
  formatDateJa,
  formatShortDate,
  isoWeekValue,
  mondayFromWeekValue,
  parseKey,
  startOfWeekMonday,
  todayDate,
} from '../lib/dates';
import { downloadTextFile, processProfileImage, readFileAsText } from '../lib/files';
import {
  allTimeTotals,
  calcLongestStreak,
  calcStreak,
  dayKindFor,
  dayStats,
  exerciseRepTotals,
  exerciseSetTotals,
  exerciseTotals,
  heatmapDays,
  monthlyCompleteDays,
  oldestRecordYear,
  periodStats,
  weekdayCompletionRates,
  weeklyTrend,
  weekProgressStats,
} from '../lib/logic';
import { sanitizeCard } from '../lib/sanitize';
import { useStore } from '../lib/store';
import type { PeriodStats, RivalCard } from '../lib/types';

function displayNicknameOf(nickname: string): string {
  const n = nickname.trim();
  return n !== '' ? n : 'あなた';
}

/* 自分の対戦カードを作る。集計はスナップショットベースなので、
   種目を削除・変更しても壊れない。 */
function buildOwnCard(data: ReturnType<typeof useStore>['data']): RivalCard {
  const core = { exercises: data.exercises, records: data.records, settings: data.settings };
  const totals = allTimeTotals(core);
  return {
    type: 'daily-training-card',
    version: 1,
    cardId: data.settings.cardId,
    nickname: displayNicknameOf(data.settings.nickname),
    bio: data.profile.bio,
    image: data.profile.image !== '' ? data.profile.image : null,
    generatedAt: dateKeyOf(todayDate()),
    streak: calcStreak(core),
    bestStreak: calcLongestStreak(core),
    weekDone: weekProgressStats(core).done,
    totalDays: totals.totalDays,
    totalSets: totals.totalSets,
    totalReps: totals.totalReps,
  };
}

/* 比較表に4指標（完了日数・完了率・完了セット数・合計回数）を入れる。
   記録が無い期間は数値の代わりに「データなし」と出し、差は「—」にする。 */
function CompareRows({ cur, prev }: { cur: PeriodStats; prev: PeriodStats }) {
  const sideText = (stats: PeriodStats, text: string) => (stats.hasData ? text : 'データなし');
  const diffText = (curVal: number | null, prevVal: number | null, suffix: string) => {
    if (!cur.hasData || !prev.hasData || curVal === null || prevVal === null) return '—';
    const d = curVal - prevVal;
    return `${d > 0 ? '+' : ''}${d}${suffix}`;
  };
  const rateText = (stats: PeriodStats) => (stats.rate === null ? '—' : `${stats.rate}%`);
  const repsText = (stats: PeriodStats) => (stats.repsKnown ? `${stats.reps}回` : '—');
  const repsVal = (stats: PeriodStats) => (stats.repsKnown ? stats.reps : null);
  const rows: [string, string, string, string][] = [
    ['完了日数', sideText(cur, `${cur.completeDays}日`), sideText(prev, `${prev.completeDays}日`), diffText(cur.completeDays, prev.completeDays, '日')],
    ['完了率', sideText(cur, rateText(cur)), sideText(prev, rateText(prev)), diffText(cur.rate, prev.rate, '%')],
    ['完了セット数', sideText(cur, `${cur.sets}セット`), sideText(prev, `${prev.sets}セット`), diffText(cur.sets, prev.sets, 'セット')],
    ['合計回数', sideText(cur, repsText(cur)), sideText(prev, repsText(prev)), diffText(repsVal(cur), repsVal(prev), '回')],
  ];
  return (
    <>
      {rows.map((row) => (
        <tr key={row[0]}>
          <th scope="row">{row[0]}</th>
          <td>{row[1]}</td>
          <td>{row[2]}</td>
          <td>{row[3]}</td>
        </tr>
      ))}
    </>
  );
}

function CompareTable({ cur, prev }: { cur: PeriodStats; prev: PeriodStats }) {
  return (
    <table className="compare-table">
      <thead>
        <tr>
          <th scope="col">指標</th>
          <th scope="col">今の期間</th>
          <th scope="col">前の期間</th>
          <th scope="col">差</th>
        </tr>
      </thead>
      <tbody>
        <CompareRows cur={cur} prev={prev} />
      </tbody>
    </table>
  );
}

export function MyPageView() {
  const { data, update, showToast, announce } = useStore();
  const core = { exercises: data.exercises, records: data.records, settings: data.settings };
  const today = todayDate();

  /* 期間選択の状態。初期値は prefs に保存された前回の選択、無ければ今の年・月・週。 */
  const [selYear, setSelYear] = useState<number>(() => data.prefs.mpYear ?? today.getFullYear());
  const [selMonth, setSelMonth] = useState<number>(() => data.prefs.mpMonth ?? today.getMonth());
  const [weekMonday, setWeekMonday] = useState<Date | null>(() =>
    data.prefs.mpWeek !== '' ? mondayFromWeekValue(data.prefs.mpWeek) : null,
  );
  const [calendarEditKey, setCalendarEditKey] = useState<string | null>(null);
  const [calendarEditNonce, setCalendarEditNonce] = useState(0);

  /* プロフィール編集 */
  const [nicknameInput, setNicknameInput] = useState(data.settings.nickname);
  const [bioInput, setBioInput] = useState(data.profile.bio);
  const [profileStatus, setProfileStatus] = useState('');

  /* 対戦 */
  const [cardStatus, setCardStatus] = useState('');
  const [rivalStatus, setRivalStatus] = useState('');

  /* 外部からのデータ差し替え（インポート等）に、入力欄が追随するようにする。
     入力中の欄は上書きしない（レンダー中の状態調整パターン）。 */
  const [prevNickname, setPrevNickname] = useState(data.settings.nickname);
  if (data.settings.nickname !== prevNickname) {
    setPrevNickname(data.settings.nickname);
    if (typeof document === 'undefined' || document.activeElement?.id !== 'profile-nickname') {
      setNicknameInput(data.settings.nickname);
    }
  }
  const [prevBio, setPrevBio] = useState(data.profile.bio);
  if (data.profile.bio !== prevBio) {
    setPrevBio(data.profile.bio);
    if (typeof document === 'undefined' || document.activeElement?.id !== 'profile-bio-input') {
      setBioInput(data.profile.bio);
    }
  }

  const persistSel = (year: number, month: number, monday: Date | null) => {
    update({
      prefs: {
        ...data.prefs,
        mpYear: year,
        mpMonth: month,
        mpWeek: monday ? isoWeekValue(monday) : '',
      },
    });
  };

  /* 年セレクト: 記録がある最も古い年〜今年（記録が無ければ今年のみ） */
  const oldest = oldestRecordYear(core);
  const firstYear = oldest === null ? today.getFullYear() : Math.min(oldest, today.getFullYear());
  const years: number[] = [];
  for (let y = firstYear; y <= today.getFullYear(); y++) years.push(y);
  const shownYear = Math.min(Math.max(selYear, firstYear), today.getFullYear());

  /* 週の比較: 選んだ週 vs その前週（週は月曜はじまり） */
  const selMonday = weekMonday ?? startOfWeekMonday(today);
  const selSunday = addDays(selMonday, 6);
  const prevMonday = addDays(selMonday, -7);
  const prevSunday = addDays(selMonday, -1);

  /* 月・年の比較 */
  const monthStart = new Date(shownYear, selMonth, 1);
  const monthEnd = new Date(shownYear, selMonth + 1, 0);
  const prevMonthStart = new Date(shownYear, selMonth - 1, 1);
  const prevMonthEnd = new Date(shownYear, selMonth, 0);

  /* グラフ用集計 */
  const monthCounts = monthlyCompleteDays(core, shownYear);
  const trend = weeklyTrend(core, 12);
  const latestWeek = trend[trend.length - 1];
  const repTotals = exerciseRepTotals(core);
  const setTotals = exerciseSetTotals(core);
  const weekdayRates = weekdayCompletionRates(core);
  const hasWeekdayData = weekdayRates.some((r) => r.trainingDays > 0);
  const heatDays = heatmapDays(core, shownYear);

  const totals = allTimeTotals(core);
  const totalsList = exerciseTotals(core);
  const ownCard = buildOwnCard(data);
  const people: RivalCard[] = [ownCard, ...data.rivals];
  const hasRivals = data.rivals.length > 0;
  const nickname = displayNicknameOf(data.settings.nickname);
  const hasImage = data.profile.image !== '';

  /* カレンダー（月曜はじまり） */
  const calFirst = new Date(shownYear, selMonth, 1);
  const calStartOffset = (calFirst.getDay() + 6) % 7;
  const daysInMonth = new Date(shownYear, selMonth + 1, 0).getDate();
  const calCells: (number | null)[] = [];
  for (let i = 0; i < calStartOffset; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calRows: (number | null)[][] = [];
  for (let i = 0; i < calCells.length; i += 7) calRows.push(calCells.slice(i, i + 7));
  const todayKey = dateKeyOf(today);

  const saveProfile = () => {
    update({
      settings: { ...data.settings, nickname: nicknameInput.trim().slice(0, 20) },
      profile: { ...data.profile, bio: bioInput.slice(0, PROFILE_BIO_MAX) },
    });
    setProfileStatus('プロフィールを保存しました。');
    showToast();
    announce('プロフィールを保存しました');
  };

  const onProfileImage = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > FILE_LIMITS.imageBytes) {
      setProfileStatus('画像ファイルが大きすぎます（10MBまで）。もう少し小さい画像を選んでください。');
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      setProfileStatus('画像ファイルを選んでください。');
      return;
    }
    const result = await processProfileImage(file);
    if (result.error || !result.dataUrl) {
      setProfileStatus(result.error ?? '画像を処理できませんでした。');
    } else {
      update({ profile: { ...data.profile, image: result.dataUrl } });
      setProfileStatus('プロフィール画像を設定しました。');
      announce('プロフィール画像を設定しました');
    }
  };

  const onRivalFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > FILE_LIMITS.jsonBytes) {
      setRivalStatus('ファイルが大きすぎます（5MBまで）。対戦カードのJSONか確認してください。');
      return;
    }
    let card: RivalCard | null = null;
    try {
      card = sanitizeCard(JSON.parse(await readFileAsText(file)));
    } catch {
      card = null;
    }
    if (!card) {
      setRivalStatus('取り込めませんでした。対戦カードのJSONファイルか確認してください。');
      return;
    }
    /* 照合はカード固有ID（cardId）を優先し、無い旧形式カードはニックネームで照合する */
    let existingIndex = -1;
    if (card.cardId !== '') {
      data.rivals.forEach((r, i) => {
        if (r.cardId !== '' && r.cardId === card!.cardId) existingIndex = i;
      });
    }
    if (existingIndex === -1) {
      data.rivals.forEach((r, i) => {
        if (r.nickname === card!.nickname) existingIndex = i;
      });
    }
    let message: string;
    if (existingIndex >= 0) {
      const rivals = [...data.rivals];
      rivals[existingIndex] = card;
      update({ rivals });
      message = `${card.nickname}さんのカードを更新しました。`;
    } else if (data.rivals.length >= 5) {
      message = '友達は最大5人までです。先に誰かのカードを削除してください。';
    } else {
      update({ rivals: [...data.rivals, card] });
      message = `${card.nickname}さんのカードを取り込みました。`;
    }
    setRivalStatus(message);
    announce(message);
  };

  const copyCard = () => {
    const text = JSON.stringify(buildOwnCard(data), null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCardStatus('対戦カードをクリップボードにコピーしました。LINEなどで友達に送ってください。');
          announce('対戦カードをコピーしました');
        },
        () => setCardStatus('コピーできませんでした。「対戦カードを書き出す」を使ってください。'),
      );
    } else {
      setCardStatus('この環境ではコピーできません。「対戦カードを書き出す」を使ってください。');
    }
  };

  return (
    <div className="mypage-layout">
      <nav className="card quick-links mypage-layout__wide" aria-label="マイページの目次">
        <a className="quick-links__link" href="#sec-profile">プロフィール</a>
        <a className="quick-links__link" href="#sec-body">からだ</a>
        <a className="quick-links__link" href="#sec-compare">期間の比較</a>
        <a className="quick-links__link" href="#sec-weekly">週ごとの推移</a>
        <a className="quick-links__link" href="#sec-weekday">曜日別の完了率</a>
        <a className="quick-links__link" href="#sec-calendar">カレンダー</a>
        <a className="quick-links__link" href="#sec-heatmap">記録マップ</a>
        <a className="quick-links__link" href="#sec-extotals">種目別の合計</a>
        <a className="quick-links__link" href="#sec-rivals">友達と競争</a>
        <a className="quick-links__link" href="#sec-totals">累計</a>
      </nav>

      {/* プロフィール */}
      <section className="card mypage-layout__wide" id="sec-profile" aria-labelledby="profile-heading">
        <h2 id="profile-heading">プロフィール</h2>
        <div className="profile-view">
          <div className="profile-avatar">
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="profile-avatar__img" src={data.profile.image} alt="プロフィール画像" />
            ) : (
              <span className="profile-avatar__initial" aria-hidden="true">
                {nickname.charAt(0)}
              </span>
            )}
          </div>
          <div className="profile-view__texts">
            <p className="profile-view__name">{nickname}</p>
            <p className="profile-view__bio">
              {data.profile.bio !== '' ? data.profile.bio : '紹介文はまだありません。'}
            </p>
          </div>
        </div>
        <div className="profile-edit">
          <div className="field">
            <label className="field__label" htmlFor="profile-nickname">
              ニックネーム
            </label>
            <input
              type="text"
              id="profile-nickname"
              maxLength={20}
              placeholder="例: たろう"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="profile-bio-input">
              紹介文
            </label>
            <textarea
              id="profile-bio-input"
              rows={3}
              maxLength={200}
              placeholder="例: 毎朝少しずつ続けています"
              value={bioInput}
              onChange={(e) => setBioInput(e.target.value)}
            />
            <p className="char-count">{bioInput.length} / 200文字</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="profile-image-file">
              プロフィール画像
            </label>
            <input
              type="file"
              id="profile-image-file"
              accept="image/*"
              onChange={(e) => {
                void onProfileImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="data-actions__row">
            <button type="button" className="btn btn--primary" onClick={saveProfile}>
              プロフィールを保存
            </button>
            {hasImage && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  update({ profile: { ...data.profile, image: '' } });
                  setProfileStatus('プロフィール画像を削除しました。');
                  announce('プロフィール画像を削除しました');
                }}
              >
                画像を削除
              </button>
            )}
          </div>
          <p className="data-status" role="status">
            {profileStatus}
          </p>
          <p className="settings-hint">
            画像と紹介文はこのブラウザの中にだけ保存され、外部に自動送信されません。端末の外に出るのは、自分で対戦カードを書き出して共有するときだけです。画像は最大256×256に縮小して保存します。
          </p>
        </div>
      </section>

      {/* からだ（体重・体脂肪率・ウエスト） */}
      <BodySection />

      {/* 期間の比較 */}
      <section className="card mypage-layout__wide" id="sec-compare" aria-labelledby="mypage-heading">
        <h2 id="mypage-heading">期間の比較</h2>
        <div className="period-select">
          <div className="field">
            <label className="field__label" htmlFor="mp-year">
              年
            </label>
            <select
              id="mp-year"
              value={shownYear}
              onChange={(e) => {
                const y = Number(e.target.value);
                setSelYear(y);
                setCalendarEditKey(null);
                persistSel(y, selMonth, weekMonday);
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="mp-month">
              月
            </label>
            <select
              id="mp-month"
              value={selMonth}
              onChange={(e) => {
                const m = Number(e.target.value);
                setSelMonth(m);
                setCalendarEditKey(null);
                persistSel(selYear, m, weekMonday);
              }}
            >
              {Array.from({ length: 12 }, (_, m) => (
                <option key={m} value={m}>
                  {m + 1}月
                </option>
              ))}
            </select>
          </div>
          <p className="period-select__hint">月と年の比較、月別グラフ、カレンダーに使います。選択は保存されます。</p>
        </div>

        <div className="compare-grid">
          <section className="compare-card" aria-labelledby="compare-week-heading">
            <h3 id="compare-week-heading">週の比較</h3>
            <div className="field period-select__week">
              <label className="field__label" htmlFor="mp-week">
                週を選ぶ
              </label>
              <input
                type="week"
                id="mp-week"
                value={isoWeekValue(selMonday)}
                onChange={(e) => {
                  const monday = mondayFromWeekValue(e.target.value);
                  setWeekMonday(monday);
                  persistSel(selYear, selMonth, monday);
                }}
              />
              <p className="settings-hint">週の比較に使います（月曜はじまり）。空のときは今週です。</p>
            </div>
            <p className="compare-card__periods">
              {formatShortDate(selMonday)}〜{formatShortDate(selSunday)} と {formatShortDate(prevMonday)}〜
              {formatShortDate(prevSunday)} の比較
            </p>
            <CompareTable cur={periodStats(core, selMonday, selSunday)} prev={periodStats(core, prevMonday, prevSunday)} />
          </section>

          <section className="compare-card" aria-labelledby="compare-month-heading">
            <h3 id="compare-month-heading">月の比較</h3>
            <p className="compare-card__periods">
              {shownYear}年{selMonth + 1}月 と {prevMonthStart.getFullYear()}年{prevMonthStart.getMonth() + 1}月 の比較
            </p>
            <CompareTable cur={periodStats(core, monthStart, monthEnd)} prev={periodStats(core, prevMonthStart, prevMonthEnd)} />
          </section>

          <section className="compare-card" aria-labelledby="compare-year-heading">
            <h3 id="compare-year-heading">年の比較</h3>
            <p className="compare-card__periods">
              {shownYear}年 と {shownYear - 1}年 の比較
            </p>
            <CompareTable
              cur={periodStats(core, new Date(shownYear, 0, 1), new Date(shownYear, 11, 31))}
              prev={periodStats(core, new Date(shownYear - 1, 0, 1), new Date(shownYear - 1, 11, 31))}
            />
          </section>
        </div>
      </section>

      {/* 週ごとの推移 */}
      <section className="card mypage-layout__wide" id="sec-weekly" aria-labelledby="weekly-heading">
        <Collapse title="週ごとの推移" headingTag="h2">
          <p className="settings-hint">
            直近12週の完了日数（棒）と完了率（折れ線）です。完了率はトレーニング日だけで計算しています（休みの日は分母に入りません）。今週は今日までの分です。
          </p>
          <WeeklyTrendChart points={trend} />
          {latestWeek && (
            <p className="settings-hint">
              今週は今日までで、トレーニング日{latestWeek.trainingDays}日のうち{latestWeek.completeDays}日完了
              {latestWeek.rate !== null ? `（完了率${latestWeek.rate}%）` : ''}です。週ごとの正確な数値は「期間の比較」の週の比較でも見られます。
            </p>
          )}
        </Collapse>
      </section>

      {/* 曜日別の完了率 */}
      <section className="card" id="sec-weekday" aria-labelledby="weekday-heading">
        <Collapse title="曜日別の完了率" headingTag="h2">
          <p className="settings-hint">
            曜日ごとに、トレーニング日のうち完了できた日の割合です。記録のあるいちばん古い日から今日までを通算しています（休みの日は分母に入りません）。
          </p>
          {hasWeekdayData ? (
            <>
              <WeekdayRateChart rates={weekdayRates} />
              <ul className="visually-hidden">
                {weekdayRates.map((r) => (
                  <li key={r.weekday}>
                    {r.label}曜日:{' '}
                    {r.rate !== null
                      ? `完了率${r.rate}%（完了${r.completeDays}日／トレーニング日${r.trainingDays}日）`
                      : 'トレーニング日はありません'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="empty-message">まだ記録がありません。</p>
          )}
        </Collapse>
      </section>

      {/* 月別グラフ */}
      <section className="card" aria-labelledby="chart-heading">
        <Collapse title="月別の完了日数" headingTag="h2">
          <p className="settings-hint">
            {shownYear}年の月ごとの完了日数です。年の選択は「期間の比較」の年セレクトと共通です。
          </p>
          <MonthlyBarChart year={shownYear} counts={monthCounts} />
          <ul className="visually-hidden">
            {monthCounts.map((count, idx) => (
              <li key={idx}>
                {shownYear}年{idx + 1}月: {count}日
              </li>
            ))}
          </ul>
        </Collapse>
      </section>

      {/* カレンダー */}
      <section className="card mypage-layout__wide" id="sec-calendar" aria-labelledby="calendar-heading">
        <h2 id="calendar-heading">カレンダー</h2>
        <p className="settings-hint">
          {shownYear}年{selMonth + 1}月のカレンダーです。記録がある日をタップすると、その日の記録を編集できます。
        </p>
        <div>
          <table className="calendar">
            <thead>
              <tr>
                {['月', '火', '水', '木', '金', '土', '日'].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((dayNum, ci) => {
                    if (dayNum === null) {
                      return <td key={ci} className="calendar__cell--blank" />;
                    }
                    const d = new Date(shownYear, selMonth, dayNum);
                    const k = dateKeyOf(d);
                    const dStats = dayStats(core, k);
                    const dKind = dayKindFor(core, k, d);
                    let statusText: string;
                    let markText = '';
                    let cellClass = '';
                    if (d > today) {
                      statusText = 'まだ先の日付です';
                    } else if (dStats.complete && dKind === 'short') {
                      statusText = '短縮で完了';
                      markText = '✓短';
                      cellClass = 'calendar__cell--done';
                    } else if (dStats.complete) {
                      statusText = '完了';
                      markText = '✓';
                      cellClass = 'calendar__cell--done';
                    } else if (dKind === 'rest') {
                      statusText = '休みの日';
                      markText = '休';
                      cellClass = 'calendar__cell--rest';
                    } else {
                      statusText = '未完了';
                      markText = '−';
                    }
                    if (k === todayKey) {
                      cellClass += ' calendar__cell--today';
                      statusText += '（今日）';
                    }
                    if (calendarEditKey === k) cellClass += ' calendar__cell--editing';
                    const editable =
                      d <= today && !!data.records[k] && dStats.entries.some((e) => e.target > 0);
                    return (
                      <td key={ci} className={cellClass} aria-label={editable ? undefined : `${formatDateJa(d)} ${statusText}`}>
                        {editable ? (
                          <button
                            type="button"
                            className="calendar__day-btn"
                            aria-label={`${formatDateJa(d)} ${statusText}。この日の記録を編集`}
                            aria-expanded={calendarEditKey === k}
                            onClick={() => setCalendarEditKey(calendarEditKey === k ? null : k)}
                          >
                            <span className="calendar__day-num">{dayNum}</span>
                            {markText && <span className="calendar__mark">{markText}</span>}
                          </button>
                        ) : (
                          <>
                            <span className="calendar__day-num">{dayNum}</span>
                            {markText && <span className="calendar__mark">{markText}</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="legend">
          <li className="legend__item"><span className="legend__mark">✓</span> 完了</li>
          <li className="legend__item"><span className="legend__mark">✓短</span> 短縮で完了</li>
          <li className="legend__item"><span className="legend__mark">休</span> 休みの日</li>
          <li className="legend__item"><span className="legend__mark">−</span> 未完了</li>
          <li className="legend__item"><span className="legend__mark legend__mark--today">今日</span> 今日の日付（太い枠）</li>
        </ul>
        <div>
          {calendarEditKey && data.records[calendarEditKey] && (
            <>
              <h3 className="calendar-edit__heading">{formatDateJa(parseKey(calendarEditKey))}の記録を編集</h3>
              <RecordEditForm
                key={`${calendarEditKey}-${calendarEditNonce}`}
                dateKey={calendarEditKey}
                date={parseKey(calendarEditKey)}
                stats={dayStats(core, calendarEditKey)}
                onAfterSave={() => setCalendarEditNonce((n) => n + 1)}
                onCancel={() => setCalendarEditKey(null)}
              />
            </>
          )}
        </div>
      </section>

      {/* 年間ヒートマップ */}
      <section className="card mypage-layout__wide" id="sec-heatmap" aria-labelledby="heatmap-heading">
        <h2 id="heatmap-heading">{shownYear}年の記録マップ</h2>
        <p className="settings-hint">
          1年分の記録を1日1マスで表しています（列が週、月曜はじまり）。マスにカーソルを合わせる（長押しする）と日付と状態が出ます。横にスクロールできます。月ごとの詳しい状態は上のカレンダーで見られます。
        </p>
        <Heatmap days={heatDays} year={shownYear} />
      </section>

      {/* 種目別の累計 */}
      <section className="card" id="sec-extotals" aria-labelledby="ex-totals-heading">
        <Collapse title="種目別の累計" headingTag="h2">
          <ul className="ex-totals">
            {totalsList.map((t) => (
              <li className="ex-totals__row" key={t.name}>
                <span className="ex-totals__name">{t.name}</span>
                <span className="ex-totals__value">
                  {t.sets}セット{t.repsKnown ? `・合計${t.reps}回` : ''}
                </span>
              </li>
            ))}
          </ul>
          {totalsList.length === 0 && <p className="empty-message">まだ記録がありません。</p>}
          {repTotals.length > 0 && (
            <>
              <p className="settings-hint">
                合計回数のグラフです（回で数える種目だけ、上位{repTotals.length}件）。秒で数える種目は回数に混ぜていません。正確な数値は上のリストのとおりです。
              </p>
              <ExerciseRepsChart totals={repTotals} />
            </>
          )}
          {setTotals.length > 0 && (
            <>
              <p className="settings-hint">
                合計セット数のグラフです（秒で数える種目も含めた全種目、上位{setTotals.length}件）。正確な数値は上のリストのとおりです。
              </p>
              <ExerciseSetsChart totals={setTotals} />
            </>
          )}
        </Collapse>
      </section>

      {/* 友達と競争 */}
      <section className="card" id="sec-rivals" aria-labelledby="rivals-heading">
        <Collapse title="友達と競争" headingTag="h2">
          <p className="settings-hint">サーバーを使わず、端末同士だけで完結する対戦です。</p>
          <ol className="steps">
            <li>自分の「対戦カード」を書き出します。</li>
            <li>書き出したファイルを、友達に送ります。</li>
            <li>友達からもらったカードを、下の「友達のカードを取り込む」から取り込みます。</li>
            <li>下の表で、友達と比べてみましょう。</li>
          </ol>
          <p className="settings-hint">
            カードは最大5人分まで。対戦カードには、ニックネーム・紹介文・プロフィール画像と成績が含まれます（種目や日々の記録は含まれません）。
          </p>
          <div className="data-actions">
            <div className="data-actions__row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  downloadTextFile('daily-training-card.json', JSON.stringify(buildOwnCard(data), null, 2));
                  setCardStatus('対戦カードを書き出しました。友達に送ってください。');
                }}
              >
                対戦カードを書き出す
              </button>
              <button type="button" className="btn" onClick={copyCard}>
                カードをコピー
              </button>
            </div>
            <p className="data-status" role="status">
              {cardStatus}
            </p>
            <div className="data-actions__row">
              <div className="field">
                <label className="field__label" htmlFor="rival-file">
                  友達のカードを取り込む（JSON）
                </label>
                <input
                  type="file"
                  id="rival-file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    void onRivalFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <p className="data-status" role="status">
              {rivalStatus}
            </p>
          </div>
          {!hasRivals && (
            <p className="empty-message">まだ友達のカードがありません。上の手順で、友達とカードを交換してみましょう。</p>
          )}
          {hasRivals && (
            <div>
              <div className="rival-summary">
                {data.rivals.map((rival) => {
                  let wins = 0;
                  let losses = 0;
                  let draws = 0;
                  RIVAL_METRICS.forEach((metric) => {
                    const ownVal = ownCard[metric.key as RivalMetricKey];
                    const rivalVal = rival[metric.key as RivalMetricKey];
                    if (ownVal > rivalVal) wins += 1;
                    else if (ownVal < rivalVal) losses += 1;
                    else draws += 1;
                  });
                  return (
                    <p className="rival-summary__line" key={rival.cardId || rival.nickname}>
                      {rival.nickname}さんとの勝敗: {wins}勝{losses}敗{draws > 0 ? `・${draws}分け` : ''}
                    </p>
                  );
                })}
              </div>
              <div className="table-scroll">
                <table className="compare-table rival-table">
                  <thead>
                    <tr>
                      <th scope="col">指標</th>
                      {people.map((person, i) => (
                        <th scope="col" key={i}>
                          {person.nickname}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RIVAL_METRICS.map((metric) => {
                      const mkey = metric.key as RivalMetricKey;
                      const max = Math.max(...people.map((p) => p[mkey]));
                      return (
                        <tr key={metric.key}>
                          <th scope="row">{metric.label}</th>
                          {people.map((person, i) => {
                            const isTop = person[mkey] === max;
                            return (
                              <td key={i} className={isTop ? 'rival-table__top' : undefined}>
                                {person[mkey]}
                                {metric.suffix}
                                {isTop ? ' ★' : ''}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <ul className="rival-list">
            {data.rivals.map((rival, index) => (
              <li className="rival-list__row" key={rival.cardId || rival.nickname}>
                <div className="rival-list__main">
                  <span className="rival-list__avatar">
                    {rival.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="rival-list__avatar-img" src={rival.image} alt="" />
                    ) : (
                      rival.nickname.charAt(0)
                    )}
                  </span>
                  <div>
                    <span className="rival-list__info">
                      {rival.nickname}（{rival.generatedAt !== '' ? rival.generatedAt : '日付不明'}のカード）
                    </span>
                    {rival.bio && <p className="rival-list__bio">{rival.bio}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  aria-label={`${rival.nickname}さんのカードを削除`}
                  onClick={() => {
                    const rivals = [...data.rivals];
                    rivals.splice(index, 1);
                    update({ rivals });
                    setRivalStatus(`${rival.nickname}さんのカードを削除しました。`);
                    announce(`${rival.nickname}さんのカードを削除しました`);
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </Collapse>
      </section>

      {/* 累計 */}
      <section className="card" id="sec-totals" aria-labelledby="totals-heading">
        <h2 id="totals-heading">累計</h2>
        <dl className="totals-grid">
          <div className="totals-grid__item">
            <dt>総完了日数</dt>
            <dd>{totals.totalDays}日</dd>
          </div>
          <div className="totals-grid__item">
            <dt>最長連続日数</dt>
            <dd>{calcLongestStreak(core)}日</dd>
          </div>
          <div className="totals-grid__item">
            <dt>現在の連続日数</dt>
            <dd>{calcStreak(core)}日</dd>
          </div>
          <div className="totals-grid__item">
            <dt>総完了セット数</dt>
            <dd>{totals.totalSets}セット</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
