'use client';

import type { User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_PREFS, DEFAULT_SETTINGS, SYNC_META_KEY } from './constants';
import { rankingNicknameOf, rankingValuesOf } from './logic';
import { clone } from './sanitize';
import {
  clearAllKeys,
  loadInitialData,
  persistAll,
  persistSlices,
  stashBackup,
} from './storage';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { validateImportData } from './transfer';
import type { AppData, CloudSnapshot, ImportResult } from './types';

interface SyncMeta {
  /* ローカルデータが最後に変わった時刻（ISO文字列）。クラウドとの新旧比較に使う */
  lastLocalChangeAt: string;
}

function loadSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncMeta>;
      return { lastLocalChangeAt: typeof parsed.lastLocalChangeAt === 'string' ? parsed.lastLocalChangeAt : '' };
    }
  } catch {
    /* 既定値で続行 */
  }
  return { lastLocalChangeAt: '' };
}

function saveSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    /* 同期メタが書けなくてもローカル動作は続ける */
  }
}

function snapshotOf(data: AppData): CloudSnapshot {
  return {
    exercises: data.exercises,
    records: data.records,
    settings: data.settings,
    profile: data.profile,
    rivals: data.rivals,
  };
}

const EMPTY_DATA: AppData = {
  exercises: [],
  records: {},
  settings: clone(DEFAULT_SETTINGS),
  profile: { image: '', bio: '' },
  rivals: [],
  prefs: clone(DEFAULT_PREFS),
};

export interface StoreValue {
  ready: boolean;
  data: AppData;
  saveFailed: boolean;
  /* データを部分更新する。localStorage へ保存し、ログイン中はクラウド同期も予約する */
  update: (patch: Partial<AppData>, opts?: { remote?: boolean }) => void;
  /* インポート検証済みデータを反映する（反映前に現在のデータを自動退避する） */
  applyImport: (result: Extract<ImportResult, { ok: true }>) => void;
  /* 全データ削除: ローカルを初期状態に戻す */
  deleteAll: () => void;
  /* トースト（保存しました等） */
  toast: { id: number; text: string } | null;
  showToast: (text?: string) => void;
  /* スクリーンリーダー向けの読み上げ */
  announcement: string;
  announce: (message: string) => void;
  /* Supabase（任意ログイン） */
  cloudConfigured: boolean;
  user: User | null;
  syncMessage: string;
  /* オンラインランキングの同期状態メッセージ */
  rankingMessage: string;
  signIn: (email: string, password: string) => Promise<{ error?: string; notice?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string; notice?: string }>;
  signOut: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore は AppProvider の中で使ってください');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [saveFailed, setSaveFailed] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [rankingMessage, setRankingMessage] = useState('');

  const dataRef = useRef<AppData>(EMPTY_DATA);
  const userRef = useRef<User | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconciledForRef = useRef<string>('');

  const showToast = useCallback((text?: string) => {
    setToast({ id: Date.now(), text: text ?? '保存しました' });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  /* オンラインランキングへの反映。参加オンなら自分の行を最新値で upsert し、
     オフなら自分の行を削除する（設定でオフにした直後・全データ削除時もここで消える）。
     ログアウト時は呼ばないので、行は残ったまま更新だけが止まる。 */
  const syncRanking = useCallback(async () => {
    const supabase = getSupabase();
    const currentUser = userRef.current;
    if (!supabase || !currentUser) return;
    const current = dataRef.current;
    if (current.settings.rankingOptIn) {
      const values = rankingValuesOf(current);
      const { error } = await supabase.from('dt_rankings').upsert(
        {
          user_id: currentUser.id,
          nickname: rankingNicknameOf(current),
          week_done: values.weekDone,
          streak: values.streak,
          total_days: values.totalDays,
          total_sets: values.totalSets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) {
        setRankingMessage('ランキングへの反映に失敗しました。通信環境を確認してください。');
      } else {
        setRankingMessage('');
      }
    } else {
      const { error } = await supabase.from('dt_rankings').delete().eq('user_id', currentUser.id);
      if (!error) setRankingMessage('');
    }
  }, []);

  /* クラウドへ現在のスナップショットを保存する（ランキングの反映も続けて行う） */
  const pushNow = useCallback(async () => {
    const supabase = getSupabase();
    const currentUser = userRef.current;
    if (!supabase || !currentUser) return;
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from('dt_snapshots').upsert(
      { user_id: currentUser.id, data: snapshotOf(dataRef.current), updated_at: updatedAt },
      { onConflict: 'user_id' },
    );
    if (error) {
      setSyncMessage('クラウドへの保存に失敗しました。通信環境を確認してください。');
    } else {
      setSyncMessage('クラウドと同期しました（' + updatedAt.slice(0, 10) + '）。');
    }
    await syncRanking();
  }, [syncRanking]);

  const schedulePush = useCallback(() => {
    if (!userRef.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow();
    }, 1200);
  }, [pushNow]);

  const update = useCallback(
    (patch: Partial<AppData>, opts?: { remote?: boolean }) => {
      const next = { ...dataRef.current, ...patch };
      dataRef.current = next;
      setData(next);
      const ok = persistSlices(next, Object.keys(patch) as (keyof AppData)[]);
      setSaveFailed(!ok);
      if (!opts?.remote) {
        const meta = loadSyncMeta();
        meta.lastLocalChangeAt = new Date().toISOString();
        saveSyncMeta(meta);
        schedulePush();
      }
    },
    [schedulePush],
  );

  const applyImport = useCallback(
    (result: Extract<ImportResult, { ok: true }>) => {
      stashBackup(dataRef.current);
      const d = result.data;
      const next: AppData = {
        ...dataRef.current,
        exercises: d.exercises,
        records: d.records,
        settings: {
          ...d.settings,
          /* 取り込んだ設定にカードIDが無ければ、今のIDを引き継ぐ */
          cardId: d.settings.cardId !== '' ? d.settings.cardId : dataRef.current.settings.cardId,
        },
        profile: d.profile !== null ? d.profile : dataRef.current.profile,
        rivals: d.rivals !== null ? d.rivals : dataRef.current.rivals,
      };
      dataRef.current = next;
      setData(next);
      const ok = persistAll(next);
      setSaveFailed(!ok);
      const meta = loadSyncMeta();
      meta.lastLocalChangeAt = new Date().toISOString();
      saveSyncMeta(meta);
      schedulePush();
    },
    [schedulePush],
  );

  const deleteAll = useCallback(() => {
    clearAllKeys();
    try {
      localStorage.removeItem(SYNC_META_KEY);
    } catch {
      /* 続行 */
    }
    const fresh = loadInitialData();
    dataRef.current = fresh;
    setData(fresh);
    const ok = persistAll(fresh);
    setSaveFailed(!ok);
    const meta = loadSyncMeta();
    meta.lastLocalChangeAt = new Date().toISOString();
    saveSyncMeta(meta);
    schedulePush();
  }, [schedulePush]);

  /* ログイン直後の突き合わせ: クラウドとローカルの updated 時刻を比べ、新しい方を採用する */
  const reconcile = useCallback(
    async (loginUser: User) => {
      const supabase = getSupabase();
      if (!supabase) return;
      if (reconciledForRef.current === loginUser.id) return;
      reconciledForRef.current = loginUser.id;
      setSyncMessage('クラウドのデータを確認しています…');
      const { data: row, error } = await supabase
        .from('dt_snapshots')
        .select('data, updated_at')
        .eq('user_id', loginUser.id)
        .maybeSingle();
      if (error) {
        setSyncMessage('クラウドのデータを確認できませんでした。ローカルのデータで続けます。');
        return;
      }
      const meta = loadSyncMeta();
      const cloudUpdatedAt = row && typeof row.updated_at === 'string' ? row.updated_at : '';
      if (row && (meta.lastLocalChangeAt === '' || cloudUpdatedAt > meta.lastLocalChangeAt)) {
        /* クラウドの方が新しい（またはローカル未使用）→ クラウドを採用 */
        const validated = validateImportData(row.data);
        if (validated.ok) {
          stashBackup(dataRef.current);
          const d = validated.data;
          const next: AppData = {
            ...dataRef.current,
            exercises: d.exercises,
            records: d.records,
            settings: {
              ...d.settings,
              cardId:
                d.settings.cardId !== '' ? d.settings.cardId : dataRef.current.settings.cardId,
            },
            profile: d.profile !== null ? d.profile : dataRef.current.profile,
            rivals: d.rivals !== null ? d.rivals : dataRef.current.rivals,
          };
          dataRef.current = next;
          setData(next);
          persistAll(next);
          const nextMeta = loadSyncMeta();
          nextMeta.lastLocalChangeAt = cloudUpdatedAt;
          saveSyncMeta(nextMeta);
          setSyncMessage('クラウドのデータ（' + cloudUpdatedAt.slice(0, 10) + '）を読み込みました。');
          /* 採用した設定に合わせてランキング側もそろえる */
          await syncRanking();
          return;
        }
        setSyncMessage('クラウドのデータ形式を確認できなかったため、ローカルのデータを保存します。');
      }
      /* ローカルの方が新しい、またはクラウドにまだ無い → ローカルを保存 */
      await pushNow();
    },
    [pushNow, syncRanking],
  );

  /* 初期化: ローカル読み込みと、Supabase のセッション復元 */
  useEffect(() => {
    const initial = loadInitialData();
    dataRef.current = initial;
    // localStorage はサーバー側に無いため、マウント後に読み込んで反映する（意図的なパターン）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(initial);
    persistAll(initial);
    setReady(true);

    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (cancelled) return;
      const sessionUser = sessionData.session?.user ?? null;
      userRef.current = sessionUser;
      setUser(sessionUser);
      if (sessionUser) void reconcile(sessionUser);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;
      userRef.current = sessionUser;
      setUser(sessionUser);
      if (event === 'SIGNED_OUT') {
        reconciledForRef.current = '';
        setSyncMessage('');
        setRankingMessage('');
      } else if (sessionUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        void reconcile(sessionUser);
      }
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [reconcile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return { error: 'クラウド連携が設定されていません。' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return {
        error:
          'ログインできませんでした。メールアドレスとパスワードを確認してください。登録直後の場合は、確認メール内のリンクを開いてからログインしてください。',
      };
    }
    return { notice: 'ログインしました。' };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return { error: 'クラウド連携が設定されていません。' };
    const { data: signUpData, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return { error: '登録できませんでした。メールアドレスの形式や、パスワード（6文字以上）を確認してください。' };
    }
    if (!signUpData.session) {
      /* Confirm email がオンのため、確認メールが届く前提の文言にする */
      return {
        notice:
          '確認メールを送信しました。メール内のリンクを開いて登録を完了してから、ログインしてください。',
      };
    }
    return { notice: '登録してログインしました。' };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    userRef.current = null;
    setUser(null);
    reconciledForRef.current = '';
    setSyncMessage('');
    setRankingMessage('');
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      data,
      saveFailed,
      update,
      applyImport,
      deleteAll,
      toast,
      showToast,
      announcement,
      announce,
      cloudConfigured: isSupabaseConfigured(),
      user,
      syncMessage,
      rankingMessage,
      signIn,
      signUp,
      signOut,
    }),
    [
      ready,
      data,
      saveFailed,
      update,
      applyImport,
      deleteAll,
      toast,
      showToast,
      announcement,
      announce,
      user,
      syncMessage,
      rankingMessage,
      signIn,
      signUp,
      signOut,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
