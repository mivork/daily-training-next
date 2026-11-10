/* スライド式チュートリアルの位置計算（純粋関数）。
   スライドの枚数が変わっても、表示位置が範囲内に収まるようにここで寄せる。 */

/* スワイプと判断する横移動の最小距離（px）。これ未満の動きはタップとみなす。 */
export const TUTORIAL_SWIPE_THRESHOLD = 48;

/* スライド位置を 0 〜 count-1 の範囲に収める。枚数が不正な場合は 0。 */
export function clampSlideIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 0) return 0;
  const i = Math.trunc(index);
  if (i < 0) return 0;
  if (i > count - 1) return count - 1;
  return i;
}

/* 次のスライド位置。最終スライドではそのまま（進まない）。 */
export function nextSlideIndex(index: number, count: number): number {
  return clampSlideIndex(index + 1, count);
}

/* 前のスライド位置。先頭ではそのまま（戻らない）。 */
export function prevSlideIndex(index: number, count: number): number {
  return clampSlideIndex(index - 1, count);
}

/* 最終スライドかどうか。枚数が不正な場合は最終扱い（「はじめる」を出す側に倒す）。 */
export function isLastSlide(index: number, count: number): boolean {
  if (!Number.isFinite(count) || count <= 0) return true;
  return clampSlideIndex(index, count) >= count - 1;
}

/* 横スワイプの移動量（右方向が正）から、進む/戻る/何もしないを決める。
   左へ大きく動かしたら「次へ」、右へ大きく動かしたら「戻る」。 */
export function swipeDirection(
  deltaX: number,
  threshold: number = TUTORIAL_SWIPE_THRESHOLD,
): 'next' | 'prev' | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(threshold) || threshold <= 0) return null;
  if (deltaX <= -threshold) return 'next';
  if (deltaX >= threshold) return 'prev';
  return null;
}
