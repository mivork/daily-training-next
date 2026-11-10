import {
  BODY_DATA_MAX_DAYS,
  BODY_RANGES,
  FILE_LIMITS,
  PROFILE_IMAGE_MAX_LENGTH,
  SCHEMA_VERSION,
} from './constants';
import { isValidDateKey } from './dates';
import {
  clone,
  isPlainObject,
  sanitizeBodyData,
  sanitizeCard,
  sanitizeExercise,
  sanitizeProfile,
  sanitizeSettings,
} from './sanitize';
import type { AppData, BodyField, ImportResult, RecordsMap } from './types';

/* 書き出しJSONの中身。ファイル書き出しと引き継ぎコードで共用する。 */
export function buildExportPayload(data: AppData, exportedAt: string) {
  return {
    app: 'daily-training',
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    exercises: data.exercises,
    records: data.records,
    settings: data.settings,
    profile: data.profile,
    rivals: data.rivals,
    bodyData: data.bodyData,
  };
}

/* インポートするデータ全体を、読み込む前に検証する。
   問題があれば { ok: false, error: 理由 } を返し、その場合は読み込まない。
   問題がなければ整形済みのデータ { ok: true, data } を返す。
   整形には sanitize 系を使うが、検証はそれより厳しく「型が違う・範囲外」を落とす。 */
export function validateImportData(parsed: unknown): ImportResult {
  const fail = (error: string): ImportResult => ({ ok: false, error });

  if (!isPlainObject(parsed)) {
    return fail('データの形式が違います（JSONのオブジェクトではありません）。');
  }
  if (parsed.schemaVersion !== undefined) {
    if (typeof parsed.schemaVersion !== 'number' || !Number.isFinite(parsed.schemaVersion)) {
      return fail('schemaVersion の形式が違います。');
    }
    if (parsed.schemaVersion > SCHEMA_VERSION) {
      return fail(
        `このファイルは新しい形式（schemaVersion ${parsed.schemaVersion}）で作られています。このアプリ（schemaVersion ${SCHEMA_VERSION}）では読み込めません。`,
      );
    }
  }

  /* exercises: 配列で、各要素に名前と数値があること */
  if (!Array.isArray(parsed.exercises)) {
    return fail('exercises が配列ではありません。');
  }
  if (parsed.exercises.length > FILE_LIMITS.exercisesMax) {
    return fail(`種目が多すぎます（最大${FILE_LIMITS.exercisesMax}件）。`);
  }
  for (let i = 0; i < parsed.exercises.length; i++) {
    const rawEx: unknown = parsed.exercises[i];
    if (!isPlainObject(rawEx)) return fail(`種目 ${i + 1} 件目の形式が違います。`);
    if (typeof rawEx.name !== 'string' || rawEx.name.trim() === '') {
      return fail(`種目 ${i + 1} 件目に名前がありません。`);
    }
    if (typeof rawEx.amount !== 'number' || !Number.isFinite(rawEx.amount)) {
      return fail(`種目「${rawEx.name}」の数値が正しくありません。`);
    }
    if (rawEx.unit !== undefined && rawEx.unit !== '回' && rawEx.unit !== '秒') {
      return fail(`種目「${rawEx.name}」の単位が正しくありません。`);
    }
    if (rawEx.sets !== undefined && (typeof rawEx.sets !== 'number' || !Number.isFinite(rawEx.sets))) {
      return fail(`種目「${rawEx.name}」のセット数が正しくありません。`);
    }
    if (rawEx.note !== undefined && typeof rawEx.note !== 'string') {
      return fail(`種目「${rawEx.name}」のメモの形式が違います。`);
    }
    if (rawEx.id !== undefined && typeof rawEx.id !== 'string') {
      return fail(`種目「${rawEx.name}」のIDの形式が違います。`);
    }
  }

  /* records: 日付キーのオブジェクトで、完了セット数が範囲内であること */
  if (!isPlainObject(parsed.records)) {
    return fail('records がオブジェクトではありません。');
  }
  const snapFields = ['targets', 'names', 'amounts', 'units'] as const;
  for (const key of Object.keys(parsed.records)) {
    if (!isValidDateKey(key)) {
      return fail(`記録の日付「${key}」の形式が正しくありません。`);
    }
    const rec: unknown = parsed.records[key];
    if (!isPlainObject(rec)) return fail(`${key} の記録の形式が違います。`);
    if (rec.done !== undefined) {
      if (!isPlainObject(rec.done)) return fail(`${key} の完了記録の形式が違います。`);
      for (const id of Object.keys(rec.done)) {
        const dv = rec.done[id];
        if (typeof dv !== 'number' || !Number.isFinite(dv) || dv < 0 || dv > 999 || Math.floor(dv) !== dv) {
          return fail(`${key} の完了セット数が範囲外です。`);
        }
      }
    }
    if (rec.short !== undefined && typeof rec.short !== 'boolean') {
      return fail(`${key} の短縮フラグの形式が違います。`);
    }
    if (rec.skipped !== undefined) {
      if (!isPlainObject(rec.skipped)) return fail(`${key} のスキップ記録の形式が違います。`);
      for (const id of Object.keys(rec.skipped)) {
        if (typeof rec.skipped[id] !== 'boolean') {
          return fail(`${key} のスキップ記録の形式が違います。`);
        }
      }
    }
    if (rec.dayType !== undefined && rec.dayType !== 'training' && rec.dayType !== 'rest') {
      return fail(`${key} の日種別の形式が違います。`);
    }
    for (const field of snapFields) {
      if (rec[field] !== undefined && !isPlainObject(rec[field])) {
        return fail(`${key} の ${field} の形式が違います。`);
      }
    }
  }

  /* settings / profile / rivals: 型の検証 */
  if (parsed.settings !== undefined && !isPlainObject(parsed.settings)) {
    return fail('settings の形式が違います。');
  }
  if (parsed.profile !== undefined) {
    if (!isPlainObject(parsed.profile)) return fail('profile の形式が違います。');
    if (
      parsed.profile.image !== undefined &&
      (typeof parsed.profile.image !== 'string' ||
        parsed.profile.image.length > PROFILE_IMAGE_MAX_LENGTH ||
        (parsed.profile.image !== '' && !parsed.profile.image.startsWith('data:image/')))
    ) {
      return fail('プロフィール画像の形式が正しくありません。');
    }
    if (parsed.profile.bio !== undefined && typeof parsed.profile.bio !== 'string') {
      return fail('紹介文の形式が違います。');
    }
  }
  if (parsed.rivals !== undefined) {
    if (!Array.isArray(parsed.rivals)) return fail('rivals の形式が違います。');
    if (parsed.rivals.length > FILE_LIMITS.rivalsMax) {
      return fail(`友達のカードが多すぎます（最大${FILE_LIMITS.rivalsMax}人）。`);
    }
    for (let v = 0; v < parsed.rivals.length; v++) {
      if (!sanitizeCard(parsed.rivals[v])) {
        return fail(`友達のカード ${v + 1} 件目の形式が正しくありません。`);
      }
    }
  }

  /* bodyData: 日付キーのオブジェクトで、各項目が範囲内の数値であること。
     旧形式の書き出しには無いので、その場合は検証を省く（＝今のものを保持）。 */
  if (parsed.bodyData !== undefined) {
    if (!isPlainObject(parsed.bodyData)) {
      return fail('からだデータの形式が違います。');
    }
    const bodyKeys = Object.keys(parsed.bodyData);
    if (bodyKeys.length > BODY_DATA_MAX_DAYS) {
      return fail(`からだデータが多すぎます（最大${BODY_DATA_MAX_DAYS}日分）。`);
    }
    for (const key of bodyKeys) {
      if (!isValidDateKey(key)) {
        return fail(`からだデータの日付「${key}」の形式が正しくありません。`);
      }
      const entry: unknown = parsed.bodyData[key];
      if (!isPlainObject(entry)) return fail(`${key} のからだデータの形式が違います。`);
      for (const field of Object.keys(BODY_RANGES) as BodyField[]) {
        const v = entry[field];
        if (v !== undefined) {
          const range = BODY_RANGES[field];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < range.min || v > range.max) {
            return fail(`${key} の${range.label}の値が範囲外です。`);
          }
        }
      }
    }
  }

  /* 検証を通ったので、sanitize で整形する */
  const exercises = parsed.exercises
    .map((raw) => sanitizeExercise(raw))
    .filter((ex): ex is NonNullable<typeof ex> => ex !== null);
  const rivals =
    parsed.rivals !== undefined
      ? parsed.rivals
          .map((raw) => sanitizeCard(raw))
          .filter((card): card is NonNullable<typeof card> => card !== null)
      : null;
  return {
    ok: true,
    data: {
      exercises,
      records: clone(parsed.records) as RecordsMap,
      settings: sanitizeSettings(parsed.settings),
      /* プロフィール・友達が無い旧形式の書き出しでは null（＝今のものを保持） */
      profile: parsed.profile !== undefined ? sanitizeProfile(parsed.profile) : null,
      rivals,
      /* からだデータが無い旧形式の書き出しでは null（＝今のものを保持） */
      bodyData: parsed.bodyData !== undefined ? sanitizeBodyData(parsed.bodyData) : null,
    },
  };
}

/* ===== 引き継ぎコード: JSON文字列を UTF-8 → Base64 に変換する =====
   btoa は日本語を直接扱えないため、UTF-8バイト列を経由する純粋な実装にする。 */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function utf8BytesOf(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

export function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET.charAt(b0 >> 2);
    out += BASE64_ALPHABET.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? BASE64_ALPHABET.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET.charAt(b2 & 0x3f) : '=';
  }
  return out;
}

export function base64ToBytes(code: string): number[] | null {
  const cleaned = String(code).replace(/\s+/g, '');
  if (cleaned === '' || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(cleaned.charAt(i));
    const c1 = BASE64_ALPHABET.indexOf(cleaned.charAt(i + 1));
    const pad2 = cleaned.charAt(i + 2) === '=';
    const pad3 = cleaned.charAt(i + 3) === '=';
    const c2 = pad2 ? 0 : BASE64_ALPHABET.indexOf(cleaned.charAt(i + 2));
    const c3 = pad3 ? 0 : BASE64_ALPHABET.indexOf(cleaned.charAt(i + 3));
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (!pad2) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (!pad3) bytes.push(((c2 & 0x03) << 6) | c3);
  }
  return bytes;
}

/* UTF-8バイト列を文字列に戻す。不正な並びがあれば null。 */
export function utf8StringOf(bytes: number[]): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b >= 0xc2 && b <= 0xdf && i + 1 < bytes.length && (bytes[i + 1] & 0xc0) === 0x80) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (
      b >= 0xe0 &&
      b <= 0xef &&
      i + 2 < bytes.length &&
      (bytes[i + 1] & 0xc0) === 0x80 &&
      (bytes[i + 2] & 0xc0) === 0x80
    ) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if (
      b >= 0xf0 &&
      b <= 0xf4 &&
      i + 3 < bytes.length &&
      (bytes[i + 1] & 0xc0) === 0x80 &&
      (bytes[i + 2] & 0xc0) === 0x80 &&
      (bytes[i + 3] & 0xc0) === 0x80
    ) {
      let cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

export function encodeTransferCode(jsonText: string): string {
  return bytesToBase64(utf8BytesOf(jsonText));
}

export function decodeTransferCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const bytes = base64ToBytes(code);
  if (bytes === null) return null;
  return utf8StringOf(bytes);
}
