'use client';

import {
  ChartLine,
  MousePointerClick,
  Sparkles,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { useStore } from '../lib/store';
import { clampSlideIndex, isLastSlide, nextSlideIndex, prevSlideIndex, swipeDirection } from '../lib/tutorial';

interface TutorialSlide {
  icon: LucideIcon;
  title: string;
  text: string;
}

/* スライドは全5枚。文言は小学生〜大人向けに短く平易にする。 */
const SLIDES: TutorialSlide[] = [
  {
    icon: Sparkles,
    title: 'ようこそ！',
    text: '「毎日トレーニング」は、毎日の自重トレーニングを記録するアプリです。少しずつ続けるほど、グラフで成長が見えてきます。',
  },
  {
    icon: MousePointerClick,
    title: '記録はタップだけ',
    text: '「今日」画面に、次にやることが表示されます。セットが終わったら、ボタンを押すだけで記録できます。',
  },
  {
    icon: Zap,
    title: '忙しい日は短縮モード',
    text: '忙しい日は、切り替えひとつで1セットだけでも完了にできます。曜日ごとに自動で短くする設定もできます。',
  },
  {
    icon: ChartLine,
    title: '続けると見えてくる',
    text: 'マイページでは、グラフやカレンダー、種目ごとの記録が確認できます。続けた成果が目で見て分かります。',
  },
  {
    icon: Trophy,
    title: '競える＆自動保存',
    text: 'ランキングに参加すると、みんなと競えます。記録は自動でクラウドに保存されるので、別の端末でも続きから使えます。',
  },
];

interface TutorialProps {
  /* 最後まで見た/スキップしたときに呼ばれる。呼び出し側で「見た」記録を prefs に保存する */
  onClose: () => void;
}

/* スライド式チュートリアル（オンボーディング）。
   オーバーレイで背面の操作を塞ぎ、1枚ずつ切り替えて使い方を案内する。
   表示タイミング（初回自動表示・設定からの再表示）は AppShell 側で管理する。 */
export function Tutorial({ onClose }: TutorialProps) {
  const { announce } = useStore();
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  const count = SLIDES.length;
  const current = clampSlideIndex(index, count);
  const slide = SLIDES[current];
  const SlideIcon = slide.icon;
  const last = isLastSlide(current, count);

  const goTo = useCallback(
    (next: number) => {
      const clamped = clampSlideIndex(next, count);
      setIndex(clamped);
      announce(`チュートリアル ${clamped + 1}枚目（全${count}枚）: ${SLIDES[clamped].title}`);
    },
    [announce, count],
  );

  const goNext = useCallback(() => {
    goTo(nextSlideIndex(current, count));
  }, [goTo, current, count]);

  const goPrev = useCallback(() => {
    goTo(prevSlideIndex(current, count));
  }, [goTo, current, count]);

  /* 開いている間は背面のスクロールを止め、ダイアログにフォーカスを移す */
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  /* キーボード操作: 左右キーで移動、Esc で閉じる（スキップと同じ扱い） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  /* タッチスワイプ: 左へ拭くと次へ、右へ拭くと戻る */
  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX;
    if (typeof endX !== 'number') return;
    const direction = swipeDirection(endX - startX);
    if (direction === 'next') goNext();
    if (direction === 'prev') goPrev();
  };

  return (
    <div className="tutorial-overlay">
      <section
        className="card tutorial"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        ref={dialogRef}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <p className="tutorial__count">
          {current + 1} / {count}
        </p>

        <div className="tutorial__slide" key={current}>
          <div className="tutorial__icon-wrap">
            <SlideIcon className="tutorial__icon" aria-hidden="true" focusable="false" />
          </div>
          <h2 id="tutorial-title" className="tutorial__title">
            {slide.title}
          </h2>
          <p className="tutorial__text">{slide.text}</p>
        </div>

        <div className="tutorial__dots" role="group" aria-label="スライドの位置">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`tutorial__dot${i === current ? ' tutorial__dot--active' : ''}`}
              aria-label={`${i + 1}枚目を表示`}
              aria-current={i === current ? 'true' : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        <div className="tutorial__nav">
          {current === 0 ? (
            <button type="button" className="btn" onClick={onClose}>
              スキップ
            </button>
          ) : (
            <button type="button" className="btn" onClick={goPrev}>
              戻る
            </button>
          )}
          {last ? (
            <button type="button" className="btn btn--primary" onClick={onClose}>
              はじめる
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={goNext}>
              次へ
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
