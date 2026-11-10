'use client';

import { useCallback, useEffect, useState } from 'react';
import { MenuView } from './MenuView';
import { MyPageView } from './MyPageView';
import { RankingView } from './RankingView';
import { SettingsView } from './SettingsView';
import { TodayView } from './TodayView';
import { VIEW_NAMES, type ViewName } from '../lib/constants';
import { useStore } from '../lib/store';

const NAV_ITEMS: { name: ViewName; label: string }[] = [
  { name: 'today', label: '今日' },
  { name: 'menu', label: 'メニュー' },
  { name: 'ranking', label: 'ランキング' },
  { name: 'mypage', label: 'マイページ' },
  { name: 'settings', label: '設定' },
];

export function AppShell() {
  const { ready, data, saveFailed, toast, announcement, update, announce } = useStore();
  const [view, setView] = useState<ViewName>('today');
  const [editRequest, setEditRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [systemDark, setSystemDark] = useState(false);

  /* テーマ: 設定に保存があればそれ、無ければ端末の prefers-color-scheme に従う */
  const resolvedTheme: 'light' | 'dark' =
    data.settings.theme === 'light' || data.settings.theme === 'dark'
      ? data.settings.theme
      : systemDark
        ? 'dark'
        : 'light';

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // 端末設定はマウント後にしか分からないため、ここで反映する（意図的なパターン）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  const showView = useCallback((next: ViewName) => {
    setView(next);
    try {
      history.replaceState(null, '', '#' + next);
    } catch {
      /* ハッシュ更新ができなくても表示は切り替える */
    }
  }, []);

  /* URLハッシュでの初期表示と、ハッシュ変更への追随（ビュー名のハッシュだけを扱う） */
  useEffect(() => {
    if (!ready) return;
    const initial = window.location.hash.replace('#', '');
    if ((VIEW_NAMES as readonly string[]).includes(initial) && initial !== 'today') {
      // URLハッシュはマウント後に読む（意図的なパターン）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(initial as ViewName);
    }
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if ((VIEW_NAMES as readonly string[]).includes(hash)) {
        setView(hash as ViewName);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [ready]);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    update({ settings: { ...data.settings, theme: next } });
    announce(next === 'dark' ? 'ダークモードにしました' : 'ライトモードにしました');
  }, [resolvedTheme, data.settings, update, announce]);

  const onEditExercise = useCallback(
    (exerciseId: string) => {
      setEditRequest({ id: exerciseId, nonce: Date.now() });
      showView('menu');
    },
    [showView],
  );

  const navButton = (item: (typeof NAV_ITEMS)[number], idPrefix: string) => (
    <button
      key={item.name}
      type="button"
      id={`${idPrefix}-${item.name}`}
      className={`view-nav__btn${view === item.name ? ' view-nav__btn--active' : ''}`}
      aria-current={view === item.name ? 'page' : undefined}
      onClick={() => {
        showView(item.name);
        announce(`${item.label}の画面を表示しました`);
      }}
    >
      {item.label}
    </button>
  );

  return (
    <div className="app">
      <header className="app__header">
        <h1>毎日トレーニング</h1>
        <p className="app__subtitle">自重トレーニングを毎日少しずつ。やったらセットをタップして記録します。</p>
        <button
          type="button"
          className="btn btn--small theme-toggle"
          aria-pressed={resolvedTheme === 'dark'}
          onClick={toggleTheme}
        >
          {resolvedTheme === 'dark' ? 'ライトモードにする' : 'ダークモードにする'}
        </button>
      </header>

      {saveFailed && (
        <p className="save-warning" role="alert">
          保存に失敗しました。ブラウザの空き容量が不足している可能性があります。大事な記録は、「設定」画面の「データ」からエクスポートしてバックアップしてください。
        </p>
      )}

      <nav className="view-nav view-nav--top" aria-label="画面の切り替え">
        {NAV_ITEMS.map((item) => navButton(item, 'nav'))}
      </nav>

      <main>
        {!ready ? (
          <p className="empty-message">読み込み中…</p>
        ) : (
          <>
            <div hidden={view !== 'today'}>
              <TodayView key={`today-${resetNonce}`} showView={showView} onEditExercise={onEditExercise} />
            </div>
            <div hidden={view !== 'menu'}>
              <MenuView key={`menu-${resetNonce}`} editRequest={editRequest} />
            </div>
            <div hidden={view !== 'ranking'}>
              <RankingView
                key={`ranking-${resetNonce}`}
                active={view === 'ranking'}
                showView={showView}
              />
            </div>
            <div hidden={view !== 'mypage'}>
              <MyPageView key={`mypage-${resetNonce}`} />
            </div>
            <div hidden={view !== 'settings'}>
              <SettingsView
                key={`settings-${resetNonce}`}
                showView={showView}
                resolvedTheme={resolvedTheme}
                onToggleTheme={toggleTheme}
                onResetAll={() => setResetNonce((n) => n + 1)}
              />
            </div>
          </>
        )}
      </main>

      <nav className="view-nav view-nav--bottom" aria-label="画面の切り替え（下部）">
        {NAV_ITEMS.map((item) => navButton(item, 'nav-b'))}
      </nav>

      <footer className="app__footer">
        <p>データはこのブラウザの中（localStorage）に保存されます。ログインした場合は、クラウドにも保存されます。</p>
      </footer>

      {toast && (
        <p className="toast" role="status" key={toast.id}>
          {toast.text}
        </p>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
