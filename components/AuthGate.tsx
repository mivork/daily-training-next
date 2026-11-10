'use client';

import { useState } from 'react';
import { useStore } from '../lib/store';

type GateMessage = { kind: 'error' | 'notice'; text: string } | null;

/* ログイン必須の入口画面。本体（今日/メニュー等）は一切出さず、
   ログイン・新規登録・パスワード再設定の導線だけを出す。
   パスワード再設定リンクから戻ってきた場合は、新しいパスワードの設定フォームになる。
   クラウド未設定の環境では、ログイン自体ができない旨の案内だけを出す。 */
export function AuthGate() {
  const { cloudConfigured, passwordRecovery, signIn, signUp, requestPasswordReset, updatePassword } =
    useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<GateMessage>(null);

  const run = async (action: () => Promise<{ error?: string; notice?: string }>) => {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setMessage({ kind: 'error', text: result.error });
    } else if (result.notice) {
      setMessage({ kind: 'notice', text: result.notice });
    }
  };

  const messageNode = message && (
    <p
      className={`data-status${message.kind === 'error' ? ' data-status--error' : ''}`}
      role={message.kind === 'error' ? 'alert' : 'status'}
    >
      {message.text}
    </p>
  );

  /* クラウド未設定: ログインの仕組み自体が無いので、本番で開くよう案内する */
  if (!cloudConfigured) {
    return (
      <section className="card auth-gate" aria-labelledby="auth-gate-heading">
        <h2 id="auth-gate-heading">ログインが必要です</h2>
        <p className="settings-hint">
          この環境ではログイン機能が未設定のため、アプリを使えません。本番のページ（https://daily-training-seven.vercel.app/）で開いてください。
        </p>
      </section>
    );
  }

  /* パスワード再設定リンクから戻ってきた: 新しいパスワードを設定するまで本体に入れない */
  if (passwordRecovery) {
    return (
      <section className="card auth-gate" aria-labelledby="auth-gate-heading">
        <h2 id="auth-gate-heading">新しいパスワードの設定</h2>
        <p className="settings-hint">
          パスワード再設定のリンクから来ました。新しいパスワード（6文字以上）を設定すると、アプリに入れます。
        </p>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="gate-new-password">
              新しいパスワード
            </label>
            <input
              type="password"
              id="gate-new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="data-actions__row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void run(() => updatePassword(newPassword))}
          >
            パスワードを更新する
          </button>
        </div>
        {messageNode}
      </section>
    );
  }

  /* 未ログイン: ログイン / 新規登録フォーム */
  return (
    <section className="card auth-gate" aria-labelledby="auth-gate-heading">
      <h2 id="auth-gate-heading">ログイン</h2>
      <p className="settings-hint">
        このアプリを使うには、ログイン（はじめての方は新規登録）が必要です。記録はクラウドに保存され、別の端末でも同じデータが使えます。
      </p>
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="gate-email">
            メールアドレス
          </label>
          <input
            type="email"
            id="gate-email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="gate-password">
            パスワード
          </label>
          <input
            type="password"
            id="gate-password"
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
          disabled={busy}
          onClick={() => void run(() => signIn(email, password))}
        >
          ログイン
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(() => signUp(email, password))}
        >
          新規登録
        </button>
      </div>
      <p className="settings-hint">
        はじめての方は、メールアドレスとパスワードを入れて「新規登録」を押してください。そのままログインして使い始められます（確認メールは届きません）。
      </p>
      {messageNode}

      <h3 className="settings-group">パスワードを忘れたとき</h3>
      <p className="settings-hint">
        パスワード再設定のメールを送れます。上のメールアドレス欄に入力したアドレス宛てに送ります。
      </p>
      <div className="data-actions__row">
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          onClick={() => void run(() => requestPasswordReset(email))}
        >
          パスワード再設定のメールを送る
        </button>
      </div>
    </section>
  );
}
