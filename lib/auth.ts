/* Supabase Auth のエラーを、利用者向けの具体的な日本語文言に変換する純粋関数群。
   store からもテストからも使えるよう、副作用のない形にしている。 */

/** エラーらしい値から code と message を安全に取り出す */
function errorParts(error: unknown): { code: string; message: string } {
  if (error !== null && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : '',
      message: typeof e.message === 'string' ? e.message : '',
    };
  }
  if (typeof error === 'string') return { code: '', message: error };
  return { code: '', message: '' };
}

/**
 * 認証エラーを日本語の案内文に変換する。
 * 区別できない場合は fallback を返す（呼び出し側で操作に合った文言を渡す）。
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  const { code, message } = errorParts(error);
  const text = `${code} ${message}`;

  /* メール確認が終わっていない（確認オン時代に作られた未確認アカウント用に残す） */
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(text)) {
    return 'メール確認が完了していません。登録したときに届いた確認メールのリンクを開いてください。';
  }
  /* メールアドレスかパスワードが違う */
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(text)) {
    return 'メールアドレスかパスワードが違います。入力を確認してください。パスワードを忘れた場合は、再設定のメールを送ることもできます。';
  }
  /* すでに登録済みのメールアドレス */
  if (code === 'user_already_exists' || /already (registered|exists)/i.test(text)) {
    return 'このメールアドレスはすでに登録されています。ログインしてください。';
  }
  /* パスワードが短い・弱い */
  if (code === 'weak_password' || /password should be/i.test(text) || /weak password/i.test(text)) {
    return 'パスワードは6文字以上で入力してください。';
  }
  /* メール送信や操作の間隔制限 */
  if (/rate limit/i.test(text) || code.startsWith('over_')) {
    return '短い間隔で操作が続いたため、しばらく待ってからもう一度お試しください。';
  }
  /* メールアドレスの形式 */
  if (/validate email/i.test(text) || /invalid format/i.test(text) || /invalid email/i.test(text)) {
    return 'メールアドレスの形式を確認してください。';
  }
  return fallback;
}
