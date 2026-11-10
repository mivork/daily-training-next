import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '../lib/auth';

const FALLBACK = 'フォールバック文';

describe('authErrorMessage', () => {
  it('メール未確認（code）', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' }, FALLBACK)).toContain(
      'メール確認が完了していません',
    );
  });

  it('メール未確認（message のみ）', () => {
    expect(authErrorMessage({ message: 'Email not confirmed' }, FALLBACK)).toContain('メール確認が完了していません');
  });

  it('資格情報違い（code）', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }, FALLBACK)).toContain(
      'メールアドレスかパスワードが違います',
    );
  });

  it('資格情報違い（message のみ）', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'), FALLBACK)).toContain(
      'メールアドレスかパスワードが違います',
    );
  });

  it('登録済みメールアドレス', () => {
    expect(authErrorMessage({ code: 'user_already_exists', message: 'User already registered' }, FALLBACK)).toContain(
      'すでに登録されています',
    );
  });

  it('弱いパスワード', () => {
    expect(
      authErrorMessage({ code: 'weak_password', message: 'Password should be at least 6 characters' }, FALLBACK),
    ).toContain('6文字以上');
  });

  it('送信間隔の制限', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', message: 'Rate limit' }, FALLBACK)).toContain(
      'しばらく待ってから',
    );
  });

  it('メールアドレスの形式', () => {
    expect(authErrorMessage({ message: 'Unable to validate email address: invalid format' }, FALLBACK)).toContain(
      'メールアドレスの形式を確認してください',
    );
  });

  it('区別できないエラーはフォールバック', () => {
    expect(authErrorMessage({ code: 'unknown_code', message: 'something broke' }, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(42, FALLBACK)).toBe(FALLBACK);
  });
});
