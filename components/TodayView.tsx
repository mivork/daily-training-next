'use client';

import { useEffect, useRef, useState } from 'react';
import { Collapse } from './Collapse';
import { RecordEditForm } from './RecordEditForm';
import { SEED_EXERCISES } from '../lib/constants';
import { addDays, dateKeyOf, formatDateJa, todayDate } from '../lib/dates';
import {
  calcStreak,
  dayKindFor,
  dayStats,
  effectiveShort,
  isInitialMenu,
  isSkippedIn,
  isTrainingRecordDay,
  nextActionFor,
  pickAdvice,
  practiceGuideProgress,
  refreshSnapshot,
  todayScheduleText,
  todayTargetFor,
  weekProgressStats,
} from '../lib/logic';
import { clone } from '../lib/sanitize';
import { useStore } from '../lib/store';
import type { ViewName } from '../lib/constants';
import type { DayRecord } from '../lib/types';

interface TodayViewProps {
  showView: (view: ViewName) => void;
  onEditExercise: (exerciseId: string) => void;
}

export function TodayView({ showView, onEditExercise }: TodayViewProps) {
  const { data, update, showToast, announce } = useStore();
  const core = { exercises: data.exercises, records: data.records, settings: data.settings };

  const [presetJustLightened, setPresetJustLightened] = useState(false);
  const [editingHistoryKey, setEditingHistoryKey] = useState<string | null>(null);
  const [historyEditNonce, setHistoryEditNonce] = useState(0);
  const [shareStatus, setShareStatus] = useState('');
  const [lastCompleteAll, setLastCompleteAll] = useState<{
    key: string;
    record: DayRecord | null;
  } | null>(null);
  /* セット記録直後の「元に戻す」バーの対象（誤操作防止） */
  const [lastSetAction, setLastSetAction] = useState<{
    exerciseId: string;
    prevDone: number;
    message: string;
  } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const completeUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* 同じセットボタンの連続タップ（記録→取り消しの往復）を防ぐガード */
  const lastToggleRef = useRef<{ exerciseId: string; setIndex: number; at: number } | null>(null);
  const prevCompleteRef = useRef<boolean | null>(null);

  const date = todayDate();
  const key = dateKeyOf(date);
  const record = data.records[key] ?? null;
  const short = effectiveShort(core, key, date);
  const stats = dayStats(core, key);
  const kind = dayKindFor(core, key, date);
  const streak = calcStreak(core);
  const weekProgress = weekProgressStats(core);

  /* 「次にやること」: 休みの日には出さない */
  const nextAction = kind === 'rest' ? null : nextActionFor(core, key);

  /* 初回の実践型ガイド: 過去の日付に記録したセットが1つも無い間だけ出す。
     今日の分で初めて記録しても、ステップ3（確認）までは表示し続ける。 */
  const hasPastRecordedSet = Object.entries(data.records).some(
    ([k, r]) =>
      k < key && r.done && Object.values(r.done).some((v) => typeof v === 'number' && v > 0),
  );
  const showPracticeGuide =
    !data.prefs.practiceGuideDismissed && !hasPastRecordedSet && kind !== 'rest';
  const guideProgress = practiceGuideProgress(core, key);

  /* セット記録時の短い振動。対応していない環境では何もしない */
  const vibrateShort = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(30);
      } catch {
        /* 振動できない環境では何もしない */
      }
    }
  };

  /* 完了への切り替わりを検知してフィードバックする。初回表示では鳴らさない。 */
  useEffect(() => {
    if (prevCompleteRef.current === false && stats.complete) {
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), 800);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(80);
        } catch {
          /* 振動できない環境では何もしない */
        }
      }
      return () => clearTimeout(t);
    }
    prevCompleteRef.current = stats.complete;
  }, [stats.complete]);

  /* 今日の記録を用意する（無ければ日種別を固定して作り、スナップショットを最新化） */
  const ensureTodayRecord = (shortValue: boolean): { records: typeof data.records; rec: DayRecord } => {
    const records = { ...data.records };
    const rec: DayRecord = records[key]
      ? clone(records[key])
      : {
          done: {},
          skipped: {},
          short: shortValue,
          dayType: core.settings.trainingWeekdays.includes(date.getDay()) ? 'training' : 'rest',
        };
    if (typeof rec.done !== 'object' || rec.done === null) rec.done = {};
    rec.short = shortValue;
    refreshSnapshot(core, rec);
    records[key] = rec;
    return { records, rec };
  };

  const toggleSet = (exerciseId: string, setIndex: number, eventTimeStamp?: number) => {
    /* 連続タップによる二重トグル防止: 同じボタンを短時間に再タップした場合は無視する。
       時刻はクリックイベントの timeStamp を使う（イベント発生時点の時刻）。 */
    const lastToggle = lastToggleRef.current;
    if (
      typeof eventTimeStamp === 'number' &&
      lastToggle &&
      lastToggle.exerciseId === exerciseId &&
      lastToggle.setIndex === setIndex &&
      eventTimeStamp - lastToggle.at < 500
    ) {
      return;
    }
    const { records, rec } = ensureTodayRecord(short);
    const current = typeof rec.done[exerciseId] === 'number' ? rec.done[exerciseId] : 0;
    /* 飛ばし押しの防止: 次のセットか、最後に完了したセットの取り消しだけを受け付ける */
    if (setIndex > current) return;
    if (typeof eventTimeStamp === 'number') {
      lastToggleRef.current = { exerciseId, setIndex, at: eventTimeStamp };
    }
    const next = setIndex < current ? setIndex : setIndex + 1;
    rec.done[exerciseId] = next;
    update({ records });
    showToast();
    const ex = data.exercises.find((e) => e.id === exerciseId);
    if (next > setIndex) {
      /* 記録した直後は「元に戻す」バーを出し、短く振動させて反応を返す */
      showSetUndo({
        exerciseId,
        prevDone: current,
        message: `${ex ? ex.name : '種目'} ${setIndex + 1}セット目を記録しました`,
      });
      vibrateShort();
    }
    announce(
      `${ex ? ex.name : '種目'} ${setIndex + 1}セット目を${next > setIndex ? '完了にしました' : '未完了に戻しました'}`,
    );
  };

  const completeExercise = (exerciseId: string) => {
    const ex = data.exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    const { records, rec } = ensureTodayRecord(short);
    const prevDone = typeof rec.done[exerciseId] === 'number' ? rec.done[exerciseId] : 0;
    rec.done[exerciseId] = todayTargetFor(core, rec, ex, short);
    update({ records });
    showToast();
    showSetUndo({ exerciseId, prevDone, message: `${ex.name}を完了にしました` });
    vibrateShort();
    announce(`${ex.name}を完了にしました`);
  };

  const hideCompleteUndo = () => {
    setLastCompleteAll(null);
    if (completeUndoTimer.current) {
      clearTimeout(completeUndoTimer.current);
      completeUndoTimer.current = null;
    }
  };

  /* セット記録の取り消しバー。すべて完了のバーとは同時に出さない */
  const hideSetUndo = () => {
    setLastSetAction(null);
    if (setUndoTimer.current) {
      clearTimeout(setUndoTimer.current);
      setUndoTimer.current = null;
    }
  };

  const showSetUndo = (action: { exerciseId: string; prevDone: number; message: string }) => {
    hideCompleteUndo();
    hideSetUndo();
    setLastSetAction(action);
    setUndoTimer.current = setTimeout(() => setLastSetAction(null), 6000);
  };

  const undoSetAction = () => {
    if (!lastSetAction) return;
    const records = { ...data.records };
    const rec = records[key] ? clone(records[key]) : null;
    if (rec) {
      if (typeof rec.done !== 'object' || rec.done === null) rec.done = {};
      rec.done[lastSetAction.exerciseId] = lastSetAction.prevDone;
      records[key] = rec;
      update({ records });
    }
    hideSetUndo();
    showToast('元に戻しました');
    announce('記録を取り消しました');
  };

  const completeAllToday = () => {
    hideSetUndo();
    const prevRecord = data.records[key] ? clone(data.records[key]) : null;
    const { records, rec } = ensureTodayRecord(short);
    data.exercises.forEach((ex) => {
      if (isSkippedIn(rec, ex.id)) return;
      rec.done[ex.id] = todayTargetFor(core, rec, ex, short);
    });
    setLastCompleteAll({ key, record: prevRecord });
    update({ records });
    showToast();
    if (completeUndoTimer.current) clearTimeout(completeUndoTimer.current);
    completeUndoTimer.current = setTimeout(() => setLastCompleteAll(null), 6000);
    announce('すべての種目を完了にしました');
  };

  const undoCompleteAll = () => {
    if (!lastCompleteAll) return;
    const records = { ...data.records };
    if (lastCompleteAll.record === null) {
      delete records[lastCompleteAll.key];
    } else {
      records[lastCompleteAll.key] = lastCompleteAll.record;
    }
    hideCompleteUndo();
    update({ records });
    showToast('元に戻しました');
    announce('完了を取り消しました');
  };

  const toggleSkipToday = (exerciseId: string) => {
    const ex = data.exercises.find((e) => e.id === exerciseId);
    const { records, rec } = ensureTodayRecord(short);
    if (!rec.skipped || typeof rec.skipped !== 'object') rec.skipped = {};
    let nowSkipped: boolean;
    if (rec.skipped[exerciseId] === true) {
      delete rec.skipped[exerciseId];
      nowSkipped = false;
    } else {
      rec.skipped[exerciseId] = true;
      nowSkipped = true;
    }
    update({ records });
    showToast();
    announce(
      `${ex ? ex.name : '種目'}${nowSkipped ? 'を今日はスキップにしました' : 'のスキップを取り消しました'}`,
    );
  };

  const onShortToggle = (checked: boolean) => {
    const { records } = ensureTodayRecord(checked);
    update({ records });
    showToast();
    announce(
      checked
        ? `短縮モードをオンにしました。今日の目標は各種目${data.settings.shortGoalSets}セットになります`
        : '短縮モードをオフにしました。今日の目標は通常に戻ります',
    );
  };

  const onShare = () => {
    const text =
      `毎日トレーニング: ${streak}日連続中。` +
      (stats.complete
        ? `今日は${stats.totalDone}/${stats.totalTarget}セット完了しました。`
        : `今日は${stats.totalDone}/${stats.totalTarget}セットまで進みました。`);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      navigator.share({ text }).catch(() => {
        /* キャンセル時は何もしない */
      });
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setShareStatus('結果をクリップボードにコピーしました。');
          announce('結果をクリップボードにコピーしました');
        },
        () => setShareStatus('コピーできませんでした。文面: ' + text),
      );
    } else {
      setShareStatus('この環境では共有できません。文面: ' + text);
    }
  };

  const applyLightPreset = () => {
    const keepIds = ['ex-pushup', 'ex-crunch', 'ex-plank'];
    const exercises = data.exercises
      .filter((ex) => keepIds.includes(ex.id))
      .map((ex) => ({ ...ex, sets: 1 }));
    setPresetJustLightened(true);
    update({ exercises });
    showToast();
    announce('ライトにしました。腕立て・クランチ・プランクの各1セットだけになりました');
  };

  const showPreset = !data.prefs.startPresetDone && (isInitialMenu(core, SEED_EXERCISES) || presetJustLightened);

  /* 履歴（過去14日） */
  const historyDays = Array.from({ length: 14 }, (_, i) => addDays(date, -i));
  let totalComplete = 0;
  Object.keys(data.records).forEach((k) => {
    if (isTrainingRecordDay(core, k, new Date(k + 'T00:00:00')) && dayStats(core, k).complete) {
      totalComplete += 1;
    }
  });

  return (
    <>
      {/* 初回の実践型ガイド（最初の記録までをステップで案内する）。
          表示中は、説明だけの案内と開始プリセットは出さない（案内の重複を避ける） */}
      {showPracticeGuide && (
        <section className="card practice-guide" aria-labelledby="practice-guide-heading">
          <h2 id="practice-guide-heading">はじめての記録</h2>
          <p className="practice-guide__progress">ステップ {guideProgress.current} / 3</p>
          <ol className="practice-guide__steps">
            <li
              className={`practice-guide__step${
                guideProgress.step1Done
                  ? ' practice-guide__step--done'
                  : guideProgress.current === 1
                    ? ' practice-guide__step--current'
                    : ''
              }`}
              aria-current={guideProgress.current === 1 ? 'step' : undefined}
            >
              <span className="practice-guide__mark" aria-hidden="true">
                {guideProgress.step1Done ? '✓' : '1'}
              </span>
              <div>
                <p className="practice-guide__step-title">今日の種目を確認する</p>
                <p className="practice-guide__step-text">
                  下に今日やる種目が並んでいます。種目は「メニュー」画面で追加・変更できます。
                </p>
              </div>
            </li>
            <li
              className={`practice-guide__step${
                guideProgress.step2Done
                  ? ' practice-guide__step--done'
                  : guideProgress.current === 2
                    ? ' practice-guide__step--current'
                    : ''
              }`}
              aria-current={guideProgress.current === 2 ? 'step' : undefined}
            >
              <span className="practice-guide__mark" aria-hidden="true">
                {guideProgress.step2Done ? '✓' : '2'}
              </span>
              <div>
                <p className="practice-guide__step-title">
                  「{nextAction ? nextAction.name : '最初の種目'}」の1セット目を押してみる
                </p>
                <p className="practice-guide__step-text">
                  やってみたら、「次にやること」のボタンか、種目リストの「1セット目」ボタンを押すと記録できます。
                </p>
              </div>
            </li>
            <li
              className={`practice-guide__step${
                guideProgress.current === 3 ? ' practice-guide__step--current' : ''
              }`}
              aria-current={guideProgress.current === 3 ? 'step' : undefined}
            >
              <span className="practice-guide__mark" aria-hidden="true">
                3
              </span>
              <div>
                <p className="practice-guide__step-title">記録されたことを確認する</p>
                <p className="practice-guide__step-text">
                  進捗バーと「○/○セット完了」が増えていれば、記録できています。あとは今日の分が終わるまで繰り返すだけです。
                </p>
              </div>
            </li>
          </ol>
          <div className="data-actions__row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                update({
                  prefs: { ...data.prefs, practiceGuideDismissed: true, guideDismissed: true },
                });
                announce('案内を閉じました');
              }}
            >
              閉じる
            </button>
          </div>
          <p className="settings-hint">
            この案内は初回だけ表示されます。トレーニングする曜日や短縮モードは「設定」で選べます。基本の使い方は、「設定」画面の「アプリ」からいつでも表示できます。
          </p>
        </section>
      )}

      {/* 初回の案内 */}
      {!showPracticeGuide && !data.prefs.guideDismissed && (
        <section className="card guide-card" aria-labelledby="guide-heading">
          <h2 id="guide-heading">はじめに</h2>
          <p>このアプリは、毎日の自重トレーニングを記録するアプリです。使い方はかんたんです。</p>
          <ul className="guide-card__list">
            <li>やった種目のセットをタップすると記録できます。</li>
            <li>種目は「メニュー」画面で追加・変更できます。記録はこのブラウザの中にだけ保存されます。</li>
            <li>最初に入っている6種目は、自由に追加・変更・削除できます。</li>
            <li>トレーニングする曜日や、忙しい日の短縮モードは「設定」で選べます。</li>
            <li>マイページでは、期間の比較やカレンダーも見られます。</li>
          </ul>
          <div className="data-actions__row">
            <button type="button" className="btn" onClick={() => showView('menu')}>
              種目を確認する
            </button>
            <button type="button" className="btn" onClick={() => showView('settings')}>
              曜日を設定する
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                update({ prefs: { ...data.prefs, guideDismissed: true } });
                announce('案内を閉じました');
              }}
            >
              閉じる
            </button>
          </div>
          <p className="settings-hint">この案内は、「設定」画面の「アプリ」からいつでも表示できます。</p>
        </section>
      )}

      {/* 開始プリセット */}
      {!showPracticeGuide && showPreset && (
        <section className="card start-preset" aria-labelledby="start-preset-heading">
          <h2 id="start-preset-heading">はじめ方を選ぶ</h2>
          <p>まずは今の6種目で始めるか、軽い3種目から始めるか選べます。あとから「メニュー」画面で自由に変えられます。</p>
          {!presetJustLightened ? (
            <div className="data-actions__row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  update({ prefs: { ...data.prefs, startPresetDone: true } });
                  announce('今の6種目のまま始めます');
                }}
              >
                そのまま始める（6種目）
              </button>
              <button type="button" className="btn" onClick={applyLightPreset}>
                ライトにする（3種目・各1セット）
              </button>
            </div>
          ) : (
            <>
              <p className="settings-hint">
                ライトにしました。外した種目（ヒップリフト・背筋・つま先立ち）は、「メニュー」画面の「テンプレートから追加」や追加フォームからいつでも戻せます。
              </p>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  setPresetJustLightened(false);
                  update({ prefs: { ...data.prefs, startPresetDone: true } });
                }}
              >
                わかった
              </button>
            </>
          )}
        </section>
      )}

      {/* 今日 */}
      <section className="card" aria-labelledby="today-heading">
        <h2 id="today-heading">今日</h2>

        <div className="today-summary">
          <p className="today-summary__date">{formatDateJa(date)}</p>
          <p className="today-summary__streak">
            {streak > 0 ? `連続 ${streak} 日達成中` : '今日から始めましょう'}
          </p>
          <p className="today-summary__schedule">{todayScheduleText(core, key, date, kind)}</p>
        </div>

        <div className="progress-card">
          <div
            className="progress__track"
            role="progressbar"
            aria-label="今日の進捗"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stats.rate}
          >
            <div
              className="progress__bar"
              ref={(node) => {
                if (node) node.style.width = `${stats.rate}%`;
              }}
            />
          </div>
          <div className="progress-card__texts">
            <p className="progress__text">
              {stats.totalDone} / {stats.totalTarget} セット完了（{stats.rate}%）
              {short ? ' ・短縮モード中' : ''}
              {stats.skippedCount > 0 ? ` ・スキップ${stats.skippedCount}種目` : ''}
            </p>
            <p className="week-progress">
              {data.settings.weeklyGoal > 0
                ? `今週の進捗: 完了${weekProgress.done}日 / 目標${data.settings.weeklyGoal}日${
                    weekProgress.done >= data.settings.weeklyGoal ? '（目標達成！）' : ''
                  }`
                : `今週の完了${weekProgress.done}日（今週のトレーニング日は残り${weekProgress.remaining}日）`}
            </p>
          </div>
        </div>

        {/* 次にやること: 次の未完了種目と、その次に控える種目の予告。
            休みの日は無理に出さず、種目が無いときも出さない。 */}
        {kind !== 'rest' &&
          data.exercises.length > 0 &&
          (nextAction ? (
            <div className="next-action">
              <p className="next-action__label">次にやること</p>
              <p className="next-action__main">
                {nextAction.name}
                <span className="next-action__set">{nextAction.setIndex + 1}セット目</span>
              </p>
              <p className="next-action__goal">
                目標: {nextAction.amount !== null ? `${nextAction.amount}${nextAction.unit ?? ''} × ` : ''}
                {nextAction.target}セット（{nextAction.done}/{nextAction.target}セット完了）
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={(e) => toggleSet(nextAction.exerciseId, nextAction.setIndex, e.timeStamp)}
              >
                このセットを記録する
              </button>
              {nextAction.after && (
                <p className="next-action__after">その次は {nextAction.after.name}</p>
              )}
            </div>
          ) : (
            <div className="next-action next-action--done">
              <p className="next-action__label">次にやること</p>
              <p className="next-action__main">今日の分はすべて終わりました</p>
              <p className="next-action__goal">
                完了かスキップで、今日の種目はすべて片付いています。おつかれさまでした。
              </p>
            </div>
          ))}

        {kind === 'rest' && (
          <p className="rest-banner">
            今日は休みの日です。完了は必須ではありません。やる場合は、できるところだけチェックしてOKです（付けた分は記録に残ります）。
          </p>
        )}

        <label className="short-toggle">
          <input type="checkbox" checked={short} onChange={(e) => onShortToggle(e.target.checked)} />
          <span className="short-toggle__text">
            <span className="short-toggle__label">短縮モード</span>
            <span className="short-toggle__hint">
              オンで今日の目標は各種目1セット（今日だけの切替）。曜日ごとの自動短縮は「設定」で選べます。
            </span>
          </span>
          <span className={`short-toggle__state${short ? ' short-toggle__state--on' : ''}`} aria-hidden="true">
            {short ? 'オン' : 'オフ'}
          </span>
        </label>

        <div className="today-actions">
          <button
            type="button"
            className="btn"
            disabled={data.exercises.length === 0 || stats.complete}
            onClick={completeAllToday}
          >
            すべて完了
          </button>
        </div>
        {lastCompleteAll && (
          <div className="undo-bar">
            <span>すべての種目を完了にしました。</span>
            <button type="button" className="btn btn--small" onClick={undoCompleteAll}>
              元に戻す
            </button>
          </div>
        )}
        {lastSetAction && (
          <div className="undo-bar">
            <span>{lastSetAction.message}</span>
            <button type="button" className="btn btn--small" onClick={undoSetAction}>
              元に戻す
            </button>
          </div>
        )}

        <ul className="exercise-list">
          {data.exercises.map((ex) => {
            const target = todayTargetFor(core, record, ex, short);
            const rawDone =
              record && typeof record.done[ex.id] === 'number' ? record.done[ex.id] : 0;
            const doneCount = Math.min(rawDone, target);
            const skipped = isSkippedIn(record, ex.id);
            const statusLabel = doneCount >= target ? '完了' : doneCount > 0 ? '途中' : '未実施';
            return (
              <li key={ex.id} className={`exercise-row${skipped ? ' exercise-row--skipped' : ''}`}>
                <div>
                  <h3>{ex.name}</h3>
                  <p className="exercise-row__target">
                    {ex.amount}
                    {ex.unit} × {target}セット
                  </p>
                  {skipped ? (
                    <p className="exercise-row__progress exercise-row__progress--skipped">
                      スキップ中（今日の完了条件からは外れます）
                    </p>
                  ) : (
                    <p
                      className={`exercise-row__progress ${
                        doneCount >= target
                          ? 'exercise-row__progress--done'
                          : doneCount > 0
                            ? 'exercise-row__progress--partial'
                            : 'exercise-row__progress--todo'
                      }`}
                    >
                      {doneCount}/{target} セット（{statusLabel}）
                    </p>
                  )}
                  {ex.note && (
                    <p className="exercise-row__note" title={ex.note}>
                      {ex.note}
                    </p>
                  )}
                </div>
                <div className="exercise-row__sets" role="group" aria-label={`${ex.name}のセット完了チェック`}>
                  {Array.from({ length: target }, (_, index) => {
                    const isDone = index < doneCount;
                    const isNext = index === doneCount;
                    const isUndoable = doneCount > 0 && index === doneCount - 1;
                    return (
                      <button
                        key={index}
                        type="button"
                        className={`set-toggle${isDone ? ' set-toggle--done' : ''}${isNext ? ' set-toggle--next' : ''}`}
                        aria-pressed={isDone}
                        aria-label={`${ex.name} ${index + 1}セット目を${isDone ? '未完了に戻す' : '完了にする'}${isNext && !isDone ? '（次はこれ）' : ''}`}
                        disabled={skipped || !(isNext || isUndoable)}
                        onClick={(e) => toggleSet(ex.id, index, e.timeStamp)}
                      >
                        {index + 1}セット目
                      </button>
                    );
                  })}
                </div>
                <div className="exercise-row__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={skipped || doneCount >= target}
                    onClick={() => completeExercise(ex.id)}
                  >
                    この種目を完了
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => toggleSkipToday(ex.id)}>
                    {skipped ? 'スキップを取り消す' : '今日はスキップ'}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => onEditExercise(ex.id)}>
                    編集
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {data.exercises.length === 0 && (
          <p className="empty-message">種目がありません。「メニュー」画面から追加してください。</p>
        )}

        {stats.complete && (
          <p className={`done-banner${celebrating ? ' done-banner--celebrate' : ''}`}>
            今日は完了！おつかれさまでした。
          </p>
        )}

        <div className="advice-card">
          <Collapse title="Museのアドバイス" titleClassName="advice-card__title">
            <p className="advice-card__text">{pickAdvice(core)}</p>
          </Collapse>
        </div>

        <div className="share-block">
          <Collapse title="結果の共有">
            <div className="share-row">
              <button type="button" className="btn" onClick={onShare}>
                今日の結果を共有
              </button>
              <p className="data-status" role="status">
                {shareStatus}
              </p>
            </div>
            <p className="settings-hint">
              共有されるのは、連続日数と今日の完了状況（○/○セット）だけです。種目の内容や日々の記録は含まれません。
            </p>
          </Collapse>
        </div>
      </section>

      {/* 履歴 */}
      <section className="card" aria-labelledby="history-heading">
        <Collapse title="履歴（過去14日）" headingTag="h2">
          <p className="history-total">累計の完了日数: {totalComplete}日</p>
          <ul className="history-list">
            {historyDays.map((d) => {
              const k = dateKeyOf(d);
              const dStats = dayStats(core, k);
              const dKind = dayKindFor(core, k, d);
              const hasEditable = dStats.entries.some((e) => e.target > 0 && !e.skipped);
              return (
                <li className="history-row" key={k}>
                  <span className="history-row__date">{formatDateJa(d)}</span>
                  {dKind === 'rest' ? (
                    <span className="badge badge--rest">休み</span>
                  ) : (
                    <span className={`badge ${dStats.complete ? 'badge--done' : 'badge--pending'}`}>
                      {dStats.complete ? '完了' : '未完了'}
                    </span>
                  )}
                  {dKind !== 'rest' && (
                    <span className="history-row__rate">
                      完了率 {dStats.rate}%{dStats.short ? '（短縮）' : ''}
                    </span>
                  )}
                  {dStats.entries.length > 0 &&
                    (dKind !== 'rest' || dStats.totalDone > 0 || dStats.skippedCount > 0) && (
                      <span className="history-row__detail">
                        {dStats.entries
                          .map((e) => (e.skipped ? `${e.name} スキップ` : `${e.name} ${e.done}/${e.target}`))
                          .join('、')}
                      </span>
                    )}
                  {editingHistoryKey === k ? (
                    <RecordEditForm
                      key={`${k}-${historyEditNonce}`}
                      dateKey={k}
                      date={d}
                      stats={dStats}
                      onAfterSave={() => {
                        setEditingHistoryKey(null);
                        setHistoryEditNonce((n) => n + 1);
                      }}
                      onCancel={() => setEditingHistoryKey(null)}
                    />
                  ) : hasEditable ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      aria-label={`${formatDateJa(d)}の記録を編集`}
                      onClick={() => setEditingHistoryKey(k)}
                    >
                      編集
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Collapse>
      </section>
    </>
  );
}
