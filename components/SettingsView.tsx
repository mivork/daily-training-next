'use client';

import { useRef, useState } from 'react';
import { FILE_LIMITS, type ViewName } from '../lib/constants';
import { formatDateJa, todayDate } from '../lib/dates';
import { downloadTextFile, readFileAsText } from '../lib/files';
import { sanitizeSettings, toInt } from '../lib/sanitize';
import { hasBackup, readBackup } from '../lib/storage';
import { useStore } from '../lib/store';
import { buildExportPayload, decodeTransferCode, encodeTransferCode, validateImportData } from '../lib/transfer';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface SettingsViewProps {
  showView: (view: ViewName) => void;
  resolvedTheme: 'light' | 'dark';
  onToggleTheme: () => void;
  onResetAll: () => void;
}

export function SettingsView({ showView, resolvedTheme, onToggleTheme, onResetAll }: SettingsViewProps) {
  const {
    data,
    update,
    applyImport,
    deleteAll,
    showToast,
    announce,
    cloudConfigured,
    user,
    syncMessage,
    signIn,
    signUp,
    signOut,
  } = useStore();

  const [settingsStatus, setSettingsStatus] = useState('');
  const [dataStatus, setDataStatus] = useState('');
  /* 退避データの有無は localStorage を直接見る（データ更新のたびに再描画される） */
  const backupExists = hasBackup();
  const [transferOut, setTransferOut] = useState('');
  const [transferOutShown, setTransferOutShown] = useState(false);
  const [transferIn, setTransferIn] = useState('');
  const savedNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* アカウント */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  const notifySaved = () => {
    showToast();
    setSettingsStatus('保存しました');
    if (savedNoteTimer.current) clearTimeout(savedNoteTimer.current);
    savedNoteTimer.current = setTimeout(() => setSettingsStatus(''), 2500);
  };

  const toggleWeekday = (kind: 'trainingWeekdays' | 'shortWeekdays', day: number, checked: boolean) => {
    const current = data.settings[kind];
    const selected = checked ? [...current, day] : current.filter((d) => d !== day);
    selected.sort((a, b) => a - b);
    if (kind === 'trainingWeekdays' && selected.length === 0) {
      /* トレーニング日が0日になる操作は確認する。キャンセルでチェックを戻す（再描画で戻る） */
      if (!window.confirm('トレーニング日が0日になります。よろしいですか？')) {
        /* state は変えていないので、チェックは元の表示に戻る */
        update({ settings: { ...data.settings } });
        return;
      }
    }
    update({ settings: { ...data.settings, [kind]: selected } });
    notifySaved();
    if (kind === 'trainingWeekdays') announce('トレーニングする曜日を変更しました');
  };

  const markExported = () => {
    const text = formatDateJa(todayDate());
    update({ prefs: { ...data.prefs, exportLastAt: text } });
    return text;
  };

  const onExport = () => {
    const payload = buildExportPayload(data, formatDateJa(todayDate()));
    downloadTextFile('daily-training-export.json', JSON.stringify(payload, null, 2));
    markExported();
    setDataStatus('エクスポートしました。');
  };

  const onImportFile = async (file: File | undefined, input: HTMLInputElement) => {
    if (!file) return;
    if (file.size > FILE_LIMITS.jsonBytes) {
      setDataStatus('インポートできませんでした: ファイルが大きすぎます（上限5MB）。');
      input.value = '';
      return;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await readFileAsText(file));
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      setDataStatus('インポートできませんでした: JSONとして読めませんでした。ファイルを確認してください。');
      input.value = '';
      return;
    }
    const result = validateImportData(parsed);
    if (!result.ok) {
      setDataStatus('インポートできませんでした: ' + result.error);
      input.value = '';
      return;
    }
    applyImport(result);
    setDataStatus('インポートしました。読み込む前のデータは自動で退避しました（下のボタンから戻せます）。');
    input.value = '';
  };

  const showTransferCode = () => {
    setTransferOut(encodeTransferCode(JSON.stringify(buildExportPayload(data, formatDateJa(todayDate())))));
    setTransferOutShown(true);
    markExported();
    setDataStatus('引き継ぎコードを表示しました。コピーして、新しい端末で貼り付けてください。');
  };

  const copyTransferCode = () => {
    let code = transferOut;
    if (!transferOutShown || code === '') {
      code = encodeTransferCode(JSON.stringify(buildExportPayload(data, formatDateJa(todayDate()))));
      setTransferOut(code);
      setTransferOutShown(true);
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => {
          setDataStatus('引き継ぎコードをクリップボードにコピーしました。');
          announce('引き継ぎコードをコピーしました');
        },
        () => setDataStatus('コピーできませんでした。コードの欄から手動でコピーしてください。'),
      );
    } else {
      setDataStatus('この環境ではコピーできません。コードの欄から手動でコピーしてください。');
    }
  };

  const loadTransferCode = () => {
    const code = transferIn.trim();
    if (code === '') {
      setDataStatus('引き継ぎコードを貼り付けてください。');
      return;
    }
    /* サイズ上限はJSONインポートと同じ。Base64は元の約4/3倍になる */
    if (code.length > Math.ceil((FILE_LIMITS.jsonBytes * 4) / 3) + 1024) {
      setDataStatus('読み込めませんでした: コードが長すぎます（データの上限は5MBです）。');
      return;
    }
    const jsonText = decodeTransferCode(code);
    if (jsonText === null) {
      setDataStatus('読み込めませんでした: 引き継ぎコードとして読めませんでした。コード全体を貼り付けたか確認してください。');
      return;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      setDataStatus('読み込めませんでした: データとして読めませんでした。');
      return;
    }
    const result = validateImportData(parsed);
    if (!result.ok) {
      setDataStatus('読み込めませんでした: ' + result.error);
      return;
    }
    applyImport(result);
    setTransferIn('');
    setDataStatus('引き継ぎコードから読み込みました。読み込む前のデータは自動で退避しました（下のボタンから戻せます）。');
    announce('引き継ぎコードから読み込みました');
  };

  const restoreBackup = () => {
    const backup = readBackup();
    if (!backup) {
      setDataStatus('退避したデータがありません。');
      return;
    }
    if (!window.confirm('インポート前に退避したデータに戻します。よろしいですか？')) return;
    const result = validateImportData(backup);
    if (!result.ok) {
      setDataStatus('退避データが壊れているため、戻せませんでした: ' + result.error);
      return;
    }
    /* applyImport は復元前の現在データを退避し直すので、復元を取り消して戻すこともできる */
    applyImport(result);
    setDataStatus('退避したデータに戻しました。');
  };

  const onDeleteAll = () => {
    if (
      !window.confirm(
        'すべてのデータ（種目・記録・設定・プロフィール・友達のカード）を削除して、はじめの状態に戻します。よろしいですか？',
      )
    ) {
      return;
    }
    deleteAll();
    onResetAll();
    setDataStatus('全データを削除しました。');
  };

  const handleAuth = async (mode: 'signin' | 'signup') => {
    setAuthBusy(true);
    setAuthMessage('');
    const result = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setAuthBusy(false);
    if (result.error) {
      setAuthMessage(result.error);
    } else {
      setAuthMessage(result.notice ?? '');
      if (mode === 'signin') setPassword('');
    }
  };

  return (
    <div className="settings-layout">
      <section className="card" aria-labelledby="settings-heading">
        <h2 id="settings-heading">設定</h2>
        <p className="data-status" role="status">
          {settingsStatus}
        </p>

        <h3 className="settings-group">スケジュール</h3>
        <div className="settings-fieldset-grid">
        <fieldset className="settings-fieldset">
          <legend className="field__label">トレーニングする曜日</legend>
          <p className="settings-hint">外した曜日は「休みの日」になり、連続日数や完了率の対象外になります。</p>
          <div className="weekday-options">
            {WEEKDAY_LABELS.map((label, day) => (
              <label className="weekday-option" key={day}>
                <input
                  type="checkbox"
                  checked={data.settings.trainingWeekdays.includes(day)}
                  onChange={(e) => toggleWeekday('trainingWeekdays', day, e.target.checked)}
                />{' '}
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="settings-fieldset">
          <legend className="field__label">短縮日にする曜日</legend>
          <p className="settings-hint">
            選んだ曜日は短縮モード（目標は各種目1セット）で始まります。その日だけ変えたいときは今日画面のトグルで変えられます。
          </p>
          <div className="weekday-options">
            {WEEKDAY_LABELS.map((label, day) => (
              <label className="weekday-option" key={day}>
                <input
                  type="checkbox"
                  checked={data.settings.shortWeekdays.includes(day)}
                  onChange={(e) => toggleWeekday('shortWeekdays', day, e.target.checked)}
                />{' '}
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="settings-fieldset">
          <legend className="field__label">やる時間</legend>
          <p className="settings-hint">設定すると「今日の予定」に表示されます。</p>
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="time-slot">
                時間帯
              </label>
              <select
                id="time-slot"
                value={data.settings.timeSlot}
                onChange={(e) => {
                  const settings = sanitizeSettings({ ...data.settings, timeSlot: e.target.value });
                  update({ settings });
                  notifySaved();
                }}
              >
                <option value="morning">朝</option>
                <option value="noon">昼</option>
                <option value="night">夜</option>
                <option value="undecided">決めていない</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="time-value">
                時刻（任意）
              </label>
              <input
                type="time"
                id="time-value"
                value={data.settings.timeValue}
                onChange={(e) => {
                  const settings = sanitizeSettings({ ...data.settings, timeValue: e.target.value });
                  update({ settings });
                  notifySaved();
                }}
              />
            </div>
          </div>
        </fieldset>
        </div>

        <h3 className="settings-group">トレーニング</h3>
        <fieldset className="settings-fieldset">
          <legend className="field__label">1週間の目標</legend>
          <p className="settings-hint">1週間（月曜〜日曜）の目標日数。「今日」画面に今週の進捗が表示されます。</p>
          <div className="field">
            <label className="field__label" htmlFor="weekly-goal">
              目標日数
            </label>
            <select
              id="weekly-goal"
              value={String(data.settings.weeklyGoal)}
              onChange={(e) => {
                update({
                  settings: { ...data.settings, weeklyGoal: toInt(e.target.value, 0, 0, 7) },
                });
                notifySaved();
                announce('1週間の目標を変更しました');
              }}
            >
              <option value="0">設定しない</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}日
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <h3 className="settings-group">プロフィール</h3>
        <p className="settings-hint">ニックネームはマイページの「プロフィール」で変更できます（対戦カードにも表示されます）。</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            showView('mypage');
            setTimeout(() => document.getElementById('profile-nickname')?.focus(), 50);
          }}
        >
          マイページのプロフィールを開く
        </button>

        <h3 className="settings-group">アプリ</h3>
        <p className="settings-hint">画面の配色を切り替えます。</p>
        <button
          type="button"
          className="btn btn--small theme-toggle"
          aria-pressed={resolvedTheme === 'dark'}
          onClick={onToggleTheme}
        >
          {resolvedTheme === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}
        </button>
        <p className="settings-hint">初回の案内はこちらから再表示できます。</p>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            update({ prefs: { ...data.prefs, guideDismissed: false } });
            showView('today');
            announce('初回の案内を表示しました');
          }}
        >
          初回の案内を表示する
        </button>
      </section>

      {/* アカウント（クラウド同期・任意） */}
      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">アカウント（クラウド同期）</h2>
        {cloudConfigured ? (
          user ? (
            <>
              <p>
                ログイン中: <strong>{user.email}</strong>
              </p>
              <p className="settings-hint">
                ログイン中は、種目・記録・設定・プロフィール・友達のカードがクラウドに自動で保存され、別の端末でログインすると新しい方のデータでそろいます。
              </p>
              {syncMessage && (
                <p className="data-status" role="status">
                  {syncMessage}
                </p>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void signOut();
                  setAuthMessage('ログアウトしました。この端末のデータはそのまま残ります。');
                }}
              >
                ログアウト
              </button>
              {authMessage && (
                <p className="data-status" role="status">
                  {authMessage}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="settings-hint">
                ログインは任意です。しなくても全機能がこの端末で使えます。ログインすると、記録をクラウドに保存して別の端末とそろえられます。
              </p>
              <div className="form-grid">
                <div className="field">
                  <label className="field__label" htmlFor="auth-email">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    id="auth-email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="auth-password">
                    パスワード
                  </label>
                  <input
                    type="password"
                    id="auth-password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="data-actions__row">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={authBusy}
                  onClick={() => void handleAuth('signin')}
                >
                  ログイン
                </button>
                <button type="button" className="btn" disabled={authBusy} onClick={() => void handleAuth('signup')}>
                  新規登録
                </button>
              </div>
              <p className="settings-hint">
                新規登録すると確認メールが届きます。メール内のリンクを開いて登録を完了してから、ログインしてください。
              </p>
              {authMessage && (
                <p className="data-status" role="status">
                  {authMessage}
                </p>
              )}
            </>
          )
        ) : (
          <p className="settings-hint">
            いまはローカルのみモードです（クラウド連携は未設定）。データはこのブラウザの中にだけ保存され、全機能が使えます。
          </p>
        )}
      </section>

      {/* データ */}
      <section className="card" aria-labelledby="data-heading">
        <h2 id="data-heading">データ</h2>
        <div className="data-actions">
          <div className="data-actions__row">
            <button type="button" className="btn" onClick={onExport}>
              JSONエクスポート
            </button>
            <p className="data-status">
              {data.prefs.exportLastAt !== ''
                ? `最後に書き出した日: ${data.prefs.exportLastAt}`
                : 'まだ書き出していません。'}
            </p>
          </div>
          <div className="data-actions__row">
            <div className="field">
              <label className="field__label" htmlFor="import-file">
                JSONインポート
              </label>
              <input
                type="file"
                id="import-file"
                accept=".json,application/json"
                onChange={(e) => {
                  void onImportFile(e.target.files?.[0], e.target);
                }}
              />
            </div>
          </div>
          <p className="settings-hint">
            インポート時は、読み込む前のデータを自動で退避します。不正なファイルは読み込まず、今のデータのままになります。
          </p>
          {backupExists && (
            <div className="data-actions__row">
              <button type="button" className="btn" onClick={restoreBackup}>
                退避したデータに戻す
              </button>
            </div>
          )}
          <div className="field">
            <span className="field__label">引き継ぎコード</span>
            <p className="settings-hint">
              機種変更のとき、ファイルの代わりにコードでもデータを移せます。コードを表示してコピーし、新しい端末のこの欄に貼り付けて読み込んでください。読み込みの検証と上限は、JSONインポートと同じです。
            </p>
          </div>
          <div className="data-actions__row">
            <button type="button" className="btn" onClick={showTransferCode}>
              引き継ぎコードを表示
            </button>
            <button type="button" className="btn" onClick={copyTransferCode}>
              コードをコピー
            </button>
          </div>
          {transferOutShown && (
            <div className="field">
              <label className="field__label" htmlFor="transfer-code-out">
                自分のコード
              </label>
              <textarea id="transfer-code-out" className="transfer-code" rows={3} readOnly value={transferOut} />
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="transfer-code-in">
              コードを貼り付け
            </label>
            <textarea
              id="transfer-code-in"
              className="transfer-code"
              rows={3}
              placeholder="ここに引き継ぎコードを貼り付け"
              value={transferIn}
              onChange={(e) => setTransferIn(e.target.value)}
            />
          </div>
          <div className="data-actions__row">
            <button type="button" className="btn" onClick={loadTransferCode}>
              コードから読み込む
            </button>
          </div>
          <div className="data-actions__row">
            <button type="button" className="btn btn--danger" onClick={onDeleteAll}>
              全データ削除
            </button>
          </div>
          <p className="data-status" role="status">
            {dataStatus}
          </p>
        </div>
      </section>
    </div>
  );
}
