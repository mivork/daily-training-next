'use client';

import { useState, type ReactNode } from 'react';

interface CollapseProps {
  title: string;
  headingTag?: 'h2' | 'h3';
  titleClassName?: string;
  children: ReactNode;
}

/* 折りたたみUI: 見出しボタン（aria-expanded）と本文を対応づける。
   初期状態は閉。開閉状態はセッション内のみで、保存はしない。 */
export function Collapse({ title, headingTag = 'h3', titleClassName, children }: CollapseProps) {
  const [open, setOpen] = useState(false);
  const Head = headingTag;
  return (
    <>
      <Head className={`collapse-head${titleClassName ? ' ' + titleClassName : ''}`}>
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{title}</span>
          <span className="collapse-toggle__icon" aria-hidden="true">
            ▸
          </span>
        </button>
      </Head>
      {open ? <div className="collapse-body">{children}</div> : null}
    </>
  );
}
