# 毎日トレーニング（Next.js版）

毎日続ける自重トレーニングのための、記録用Webアプリです。バニラ版（HTML/CSS/JS）の機能を、Next.js（App Router）+ TypeScript + React で作り直したものです。

小学生・学生・大学生・大人まで、誰でも使えます。アカウント登録は不要で、ブラウザで開くだけで使えます。ログイン（任意）をすると、記録をクラウドに保存して別の端末とそろえられます。

## 動かし方

```bash
npm install
npm run dev      # 開発サーバー（http://localhost:3000）
npm run build    # 本番ビルド
npm run start    # 本番サーバー
npm test         # ロジックのテスト（vitest）
npm run lint     # ESLint
```

## 機能（バニラ版と同等）

- 4ビュー（今日／メニュー／マイページ／設定）、スマホでは下部固定ナビ
- データ駆動の種目管理（追加・編集・削除・ドラッグ並び替え・テンプレート・まとめて編集）
- セット記録（部分完了・すべて完了・種目完了・取り消し）、種目ごとの進捗表示
- 短縮モードと曜日設定・トレーニング曜日設定、今日の状態の理由表示
- 記録のスナップショットと過去編集（履歴・カレンダーから）、カレンダー
- 期間比較（週／月／年）、月別グラフ、種目別累計、累計、週目標と今週の進捗
- Museのアドバイス（記録からルールで選ぶ。外部送信なし）
- プロフィール（画像・自己紹介）、友達対戦カード（書き出し／読み込み、最大5人）
- JSON書き出し／読み込み、引き継ぎコード（Base64）、インポート前の自動退避
- ダークモード、夕日テーマ、初回ガイドとライトプリセット、種目スキップ、保存トースト
- 今日の結果を共有

詳しい使い方は、バニラ版の README（`~/workspace/daily-training/README.md`）と同じです。

## データについて

- 基本はバニラ版と同じく、このブラウザの中（localStorage）にだけ保存されます。
- localStorage のキーと書き出しJSONの形式はバニラ版と互換です（`dailyTraining.exercises.v1` など）。バニラ版で書き出したJSONを、そのままこの版で読み込めます。
- ログイン中は、種目・記録・設定・プロフィール・友達のカードが Supabase にも保存されます（次節）。画面の好み（prefs: 案内の表示状態・マイページの期間選択・最終書き出し日）は端末ローカルのままです。

## Supabase の準備（任意ログイン・クラウド同期）

環境変数が無い場合は「ローカルのみモード」で完全に動作します。使う場合は、Supabase プロジェクトを用意して次を行ってください。

### 1. テーブルと RLS ポリシー

Supabase の SQL Editor で実行します。

```sql
create table if not exists public.dt_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dt_snapshots enable row level security;

create policy "dt_snapshots_select_own" on public.dt_snapshots
  for select using (auth.uid() = user_id);
create policy "dt_snapshots_insert_own" on public.dt_snapshots
  for insert with check (auth.uid() = user_id);
create policy "dt_snapshots_update_own" on public.dt_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dt_snapshots_delete_own" on public.dt_snapshots
  for delete using (auth.uid() = user_id);
```

アプリは `dt_snapshots` に、ユーザーごとのスナップショット（exercises / records / settings / profile / rivals をまとめた JSON）を1行だけ保存します。

### 2. Auth の設定

- Authentication で Email プロバイダを有効にします。
- 「Confirm email」はオンの前提でUI文言を書いています（新規登録時に確認メールが届き、リンクを開いてからログインする流れ）。

### 3. 環境変数

`.env.example` を `.env.local` にコピーして、プロジェクトの値を入れます（`.env.local` は git 管理外です）。

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

### 同期の方針

- ログイン時に、クラウド側とローカル側の更新時刻を比べて、新しい方を採用します。
- ログイン中の変更は、少し間を置いて（デバウンスして）自動でクラウドへ保存します。
- ログアウトしても、この端末のデータはそのまま残ります。

## ファイル構成

- `app/` — ルートレイアウト（メタデータ・テーマ初期化）とページ、`globals.css`（夕日テーマのCSS変数＋バニラ版CSSの移植）
- `components/` — 画面部品（AppShell / TodayView / MenuView / MyPageView / SettingsView / RecordEditForm / Collapse）
- `lib/types.ts` — 型定義
- `lib/constants.ts` — 定数（ストレージキー、シード種目、テンプレート、アドバイス文言）
- `lib/dates.ts` — 日付ユーティリティ
- `lib/sanitize.ts` — 入力データの検証・整形
- `lib/logic.ts` — 統計計算（日次集計・連続日数・期間比較）とアドバイス選択
- `lib/transfer.ts` — 書き出し／インポート検証と引き継ぎコード（Base64）
- `lib/storage.ts` — localStorage の読み書き・退避
- `lib/supabase.ts` — Supabase クライアント（環境変数が無い場合は null）
- `lib/store.tsx` — 全体状態（Context）とクラウド同期
- `lib/files.ts` — ファイルダウンロード・画像処理
- `tests/logic.test.ts` — ロジックのテスト（vitest）
- `public/manifest.webmanifest` / `public/icon.svg` — ホーム画面に追加したときの名前とアイコン

外部フォントは使っていません。CSS は Tailwind を使わず、CSS変数（夕日テーマ）とプレーンなCSSファイルで管理しています。

## アイコンについて

アプリアイコン（`public/icon.svg`）には、Lucide の dumbbell アイコンを利用しています。

- 出典: [Lucide](https://lucide.dev/)（lucide-static v1.70.0 の `icons/dumbbell.svg`）
- ライセンス: ISC License（アイコンファイルの先頭にもライセンス表記があります）
