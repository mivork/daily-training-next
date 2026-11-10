import { describe, expect, it } from 'vitest';
import { sanitizePrefs } from '../lib/sanitize';
import {
  TUTORIAL_SWIPE_THRESHOLD,
  clampSlideIndex,
  isLastSlide,
  nextSlideIndex,
  prevSlideIndex,
  swipeDirection,
} from '../lib/tutorial';

describe('clampSlideIndex', () => {
  it('範囲内の位置はそのまま返す', () => {
    expect(clampSlideIndex(0, 5)).toBe(0);
    expect(clampSlideIndex(2, 5)).toBe(2);
    expect(clampSlideIndex(4, 5)).toBe(4);
  });

  it('範囲外は端に寄せる', () => {
    expect(clampSlideIndex(-1, 5)).toBe(0);
    expect(clampSlideIndex(5, 5)).toBe(4);
    expect(clampSlideIndex(100, 5)).toBe(4);
  });

  it('小数は切り捨て、不正な入力は 0', () => {
    expect(clampSlideIndex(2.9, 5)).toBe(2);
    expect(clampSlideIndex(Number.NaN, 5)).toBe(0);
    expect(clampSlideIndex(1, 0)).toBe(0);
    expect(clampSlideIndex(1, -3)).toBe(0);
  });
});

describe('nextSlideIndex / prevSlideIndex', () => {
  it('次へ・戻るで1つずつ動く', () => {
    expect(nextSlideIndex(0, 5)).toBe(1);
    expect(nextSlideIndex(3, 5)).toBe(4);
    expect(prevSlideIndex(3, 5)).toBe(2);
    expect(prevSlideIndex(1, 5)).toBe(0);
  });

  it('端では進まない・戻らない', () => {
    expect(nextSlideIndex(4, 5)).toBe(4);
    expect(prevSlideIndex(0, 5)).toBe(0);
  });
});

describe('isLastSlide', () => {
  it('最終スライドだけ true', () => {
    expect(isLastSlide(4, 5)).toBe(true);
    expect(isLastSlide(3, 5)).toBe(false);
    expect(isLastSlide(0, 5)).toBe(false);
  });

  it('範囲外の位置は最終扱いに寄せる', () => {
    expect(isLastSlide(9, 5)).toBe(true);
    expect(isLastSlide(0, 1)).toBe(true);
  });
});

describe('swipeDirection', () => {
  it('左への大きな動きは next、右への大きな動きは prev', () => {
    expect(swipeDirection(-TUTORIAL_SWIPE_THRESHOLD)).toBe('next');
    expect(swipeDirection(-200)).toBe('next');
    expect(swipeDirection(TUTORIAL_SWIPE_THRESHOLD)).toBe('prev');
    expect(swipeDirection(200)).toBe('prev');
  });

  it('しきい値未満の動きと不正な入力は null', () => {
    expect(swipeDirection(0)).toBeNull();
    expect(swipeDirection(-(TUTORIAL_SWIPE_THRESHOLD - 1))).toBeNull();
    expect(swipeDirection(TUTORIAL_SWIPE_THRESHOLD - 1)).toBeNull();
    expect(swipeDirection(Number.NaN)).toBeNull();
  });

  it('しきい値を指定できる', () => {
    expect(swipeDirection(-10, 10)).toBe('next');
    expect(swipeDirection(-9, 10)).toBeNull();
    expect(swipeDirection(-100, 0)).toBeNull();
  });
});

describe('sanitizePrefs の tutorialSeen', () => {
  it('項目が無い旧データでは false（未表示）になる', () => {
    expect(sanitizePrefs({}).tutorialSeen).toBe(false);
    expect(sanitizePrefs(null).tutorialSeen).toBe(false);
  });

  it('true のときだけ true になる', () => {
    expect(sanitizePrefs({ tutorialSeen: true }).tutorialSeen).toBe(true);
    expect(sanitizePrefs({ tutorialSeen: 'yes' }).tutorialSeen).toBe(false);
    expect(sanitizePrefs({ tutorialSeen: 1 }).tutorialSeen).toBe(false);
  });
});
