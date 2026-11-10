'use client';

import { CalendarCheck, Dumbbell, Settings, Trophy, User, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './AuthGate';
import { MenuView } from './MenuView';
import { MyPageView } from './MyPageView';
import { RankingView } from './RankingView';
import { SettingsView } from './SettingsView';
import { TodayView } from './TodayView';
import { Tutorial } from './Tutorial';
import { VIEW_NAMES, type ViewName } from '../lib/constants';
import { useStore } from '../lib/store';

const NAV_ITEMS: { name: ViewName; label: string; icon: LucideIcon }[] = [
  { name: 'today', label: '今日', icon: CalendarCheck },
  { name: 'menu', label: 'メニュー', icon: Dumbbell },
  { name: 'ranking', label: 'ランキング', icon: Trophy },
  { name: 'mypage', label: 'マイページ', icon: User },
  { name: 'settings', label: '設定', icon: Settings },
];

export function AppShell() {
  const {
    ready,
    authReady,
    cloudConfigured,
    user,
    passwordRecovery,
    data,
    saveFailed,
    toast,
    announcement,
    update,
    announce,
  } = useStore();
  const [view, setView] = useState<ViewName>('today');
  const [editRequest, setEditRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [systemDark, setSystemDark] = useState(false);
  /* スライド式チュートリアル: 設定からの再表示リクエスト。
     初回の自動表示は prefs.tutorialSeen から導出する（下の showTutorial） */
  const [tutorialRequested, setTutorialRequested] = useState(false);

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

  const navButton = (item: (typeof NAV_ITEMS)[number], idPrefix: string) => {
    const Icon = item.icon;
    return (
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
        <Icon className="view-nav__icon" aria-hidden="true" focusable="false" />
        <span>{item.label}</span>
      </button>
    );
  };

  /* ログイン必須の出し分け:
     - データ読み込みとセッション確認が終わるまでは「読み込み中…」だけを出す
       （ログイン済みの人にゲート画面が一瞬見えるチラつきを防ぐ）
     - 未ログイン / パスワード再設定中 / クラウド未設定 のときはゲート画面だけを出す
     - それ以外（ログイン済み）のときだけアプリ本体を出す */
  const gateState: 'loading' | 'gate' | 'app' =
    !ready || !authReady
      ? 'loading'
      : passwordRecovery || !cloudConfigured || !user
        ? 'gate'
        : 'app';

  /* チュートリアルの表示条件: ログインして本体が出ているときに限る。
     - 初回（prefs.tutorialSeen が false）: 自動で開く
     - 設定の「チュートリアルを見る」: tutorialRequested で開く
     閉じたら「見た」扱いにして prefs へ保存し、次回からは自動で開かない。 */
  const showTutorial =
    gateState === 'app' && (tutorialRequested || !data.prefs.tutorialSeen);
  const closeTutorial = useCallback(() => {
    setTutorialRequested(false);
    if (!data.prefs.tutorialSeen) {
      update({ prefs: { ...data.prefs, tutorialSeen: true } });
    }
  }, [data.prefs, update]);

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

      {gateState === 'loading' ? (
        <main>
          <p className="empty-message">読み込み中…</p>
        </main>
      ) : gateState === 'gate' ? (
        <main>
          <AuthGate />
        </main>
      ) : (
        <>
          <nav className="view-nav view-nav--top" aria-label="画面の切り替え">
            {NAV_ITEMS.map((item) => navButton(item, 'nav'))}
          </nav>

          <main>
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
                onShowTutorial={() => setTutorialRequested(true)}
              />
            </div>
          </main>

          <nav className="view-nav view-nav--bottom" aria-label="画面の切り替え（下部）">
            {NAV_ITEMS.map((item) => navButton(item, 'nav-b'))}
          </nav>

          <footer className="app__footer">
            <p>データはこのブラウザの中（localStorage）とクラウドの両方に保存されます。</p>
            {user?.email && (
              <p>ログイン中: {user.email}（変更は自動でクラウドにも保存されます）</p>
            )}
          </footer>
        </>
      )}

      {showTutorial && <Tutorial onClose={closeTutorial} />}

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
