'use client';

import { useState } from 'react';
import { formatDateJa } from '../lib/dates';
import { isTrainingDay, refreshSnapshot, writeSnapshot } from '../lib/logic';
import { clone, toInt } from '../lib/sanitize';
import { useStore } from '../lib/store';
import type { DayRecord, DayStats } from '../lib/types';

interface RecordEditFormProps {
  dateKey: string;
  date: Date;
  stats: DayStats;
  /* 保存が終わったあとの後処理（閉じる・再描画など）は呼び出し側が決める */
  onAfterSave: () => void;
  onCancel: () => void;
}

/* 記録編集フォーム: その日のスナップショットをもとに、各種目の完了セット数を変更できる。
   スキップした種目は入力欄にせず注記だけ出す。履歴とカレンダーで共用する。 */
export function RecordEditForm({ dateKey, date, stats, onAfterSave, onCancel }: RecordEditFormProps) {
  const { data, update, showToast, announce } = useStore();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    stats.entries.forEach((entry) => {
      if (entry.target > 0 && !entry.skipped) init[entry.id] = String(entry.done);
    });
    return init;
  });

  const save = () => {
    const core = { exercises: data.exercises, records: data.records, settings: data.settings };
    const records = { ...data.records };
    let record: DayRecord | null = records[dateKey] ? clone(records[dateKey]) : null;
    if (!record) {
      /* 記録が無い日に付け足す場合は、その日の種別を固定して新規作成する */
      record = {
        done: {},
        short: stats.short,
        dayType: isTrainingDay(core, date) ? 'training' : 'rest',
      };
      writeSnapshot(core, record);
    }
    if (typeof record.done !== 'object' || record.done === null) record.done = {};
    refreshSnapshot(core, record);
    Object.keys(values).forEach((id) => {
      const entry = stats.entries.find((e) => e.id === id);
      const target = entry ? entry.target : 0;
      record!.done[id] = toInt(values[id], 0, 0, target);
    });
    records[dateKey] = record;
    update({ records });
    showToast();
    announce(`${formatDateJa(date)}の記録を保存しました`);
    onAfterSave();
  };

  return (
    <div className="history-edit">
      {stats.entries
        .filter((entry) => entry.target > 0)
        .map((entry) => (
          <div className="history-edit__row" key={entry.id}>
            <span className="history-edit__name">{entry.name}</span>
            {entry.skipped ? (
              <span>スキップ中（この画面では変更できません）</span>
            ) : (
              <>
                <input
                  type="number"
                  min={0}
                  max={entry.target}
                  value={values[entry.id] ?? '0'}
                  aria-label={`${entry.name}の完了セット数（目標${entry.target}セット）`}
                  onChange={(e) => setValues((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                />
                <span>/ {entry.target}セット</span>
              </>
            )}
          </div>
        ))}
      <div className="data-actions__row">
        <button type="button" className="btn btn--primary btn--small" onClick={save}>
          保存
        </button>
        <button type="button" className="btn btn--small" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
