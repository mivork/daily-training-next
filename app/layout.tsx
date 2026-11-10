import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '毎日トレーニング',
  description: '毎日続ける自重トレーニングの記録アプリ。種目は自由に追加・編集できます。',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#c2410c',
};

/* 初回表示時のテーマちらつき防止: 保存済みテーマ（無ければ端末設定）を
   描画前に data-theme へ反映する小さなスクリプト。 */
const themeInitScript = `(function(){try{var s={};try{s=JSON.parse(localStorage.getItem('dailyTraining.settings.v1')||'{}');}catch(e){}var t=(s&&(s.theme==='dark'||s.theme==='light'))?s.theme:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
