'use client';

import { useEffect, useRef, useState } from 'react';
import { EXERCISE_TEMPLATES } from '../lib/constants';
import { dateKeyOf, todayDate } from '../lib/dates';
import { clone, sanitizeExercise, toInt } from '../lib/sanitize';
import { useStore } from '../lib/store';
import type { Exercise } from '../lib/types';

interface MenuViewProps {
  /* 今日画面の「編集」から渡される、開きたい種目の指定 */
  editRequest: { id: string; nonce: number } | null;
}

interface BulkValues {
  amount: string;
  unit: string;
  sets: string;
}

export function MenuView({ editRequest }: MenuViewProps) {
  const { data, update, showToast, announce } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateStatus, setTemplateStatus] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkValues, setBulkValues] = useState<Record<string, BulkValues>>({});
  const [lastDeleted, setLastDeleted] = useState<{ exercise: Exercise; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  /* 追加フォーム */
  const [addName, setAddName] = useState('');
  const [addAmount, setAddAmount] = useState('20');
  const [addUnit, setAddUnit] = useState('回');
  const [addSets, setAddSets] = useState('2');
  const [addNote, setAddNote] = useState('');

  /* 今日画面からの編集リクエスト */
  useEffect(() => {
    if (!editRequest) return;
    // 親（今日画面）からの「この種目を編集」要求に応答する（意図的なパターン）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingId(editRequest.id);
    setBulkMode(false);
    const t = setTimeout(() => {
      const input = document.getElementById(`edit-field-${editRequest.id}-1`);
      if (input) {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input.focus();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [editRequest]);

  const scrollToRow = (exerciseId: string) => {
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector(`[data-exercise-id="${exerciseId}"]`);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  };

  /* 種目の編集を保存したとき、今日の記録（スナップショット）がすでにあれば、
     今日の目標にも反映するか確認する。反映しても完了済みセット数は変えない。 */
  const reflectEditsToToday = (changes: Exercise[]) => {
    const key = dateKeyOf(todayDate());
    const record = data.records[key];
    if (!record || !record.targets || typeof record.targets !== 'object') return;
    const applicable = changes.filter((c) => typeof record.targets![c.id] === 'number');
    if (applicable.length === 0) return;
    if (
      !window.confirm(
        '今日の記録がすでにあります。変更を今日の目標にも反映しますか？\n（「キャンセル（いいえ）」なら、明日の目標から反映されます。完了済みのセット数は変わりません）',
      )
    ) {
      return;
    }
    const nextRecord = clone(record);
    if (!nextRecord.amounts || typeof nextRecord.amounts !== 'object') nextRecord.amounts = {};
    if (!nextRecord.units || typeof nextRecord.units !== 'object') nextRecord.units = {};
    if (!nextRecord.names || typeof nextRecord.names !== 'object') nextRecord.names = {};
    if (!nextRecord.targets || typeof nextRecord.targets !== 'object') nextRecord.targets = {};
    applicable.forEach((c) => {
      nextRecord.targets![c.id] = c.sets;
      nextRecord.amounts![c.id] = c.amount;
      nextRecord.units![c.id] = c.unit;
      nextRecord.names![c.id] = c.name;
    });
    update({ records: { ...data.records, [key]: nextRecord } });
  };

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (name === '') return;
    const ex = sanitizeExercise({
      name,
      amount: addAmount,
      unit: addUnit,
      sets: addSets,
      note: addNote.trim(),
    });
    if (!ex) return;
    update({ exercises: [...data.exercises, ex] });
    setAddName('');
    setAddAmount('20');
    setAddUnit('回');
    setAddSets('2');
    setAddNote('');
    showToast();
    announce(`${ex.name}を追加しました`);
    scrollToRow(ex.id);
  };

  const addFromTemplate = (tplIndex: number) => {
    const tpl = EXERCISE_TEMPLATES[tplIndex];
    if (!tpl) return;
    if (data.exercises.some((ex) => ex.name === tpl.name)) {
      setTemplateStatus(`「${tpl.name}」はすでに追加されています。`);
      announce(`${tpl.name}はすでに追加されています`);
      return;
    }
    const ex = sanitizeExercise(clone(tpl));
    if (!ex) return;
    update({ exercises: [...data.exercises, ex] });
    setTemplateStatus(`「${tpl.name}」を追加しました。`);
    announce(`${tpl.name}を追加しました`);
    showToast();
    scrollToRow(ex.id);
  };

  const moveExercise = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= data.exercises.length) return;
    const exercises = [...data.exercises];
    const tmp = exercises[index];
    exercises[index] = exercises[next];
    exercises[next] = tmp;
    update({ exercises });
    showToast();
  };

  const deleteExercise = (ex: Exercise, index: number) => {
    if (
      !window.confirm(
        `「${ex.name}」を削除しますか？\n過去の記録は残りますが、今日以降のメニューからは消えます。`,
      )
    ) {
      return;
    }
    const exercises = [...data.exercises];
    exercises.splice(index, 1);
    if (editingId === ex.id) setEditingId(null);
    update({ exercises });
    setLastDeleted({ exercise: ex, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastDeleted(null), 8000);
    showToast();
    announce(`${ex.name}を削除しました`);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    const exercises = [...data.exercises];
    exercises.splice(Math.min(lastDeleted.index, exercises.length), 0, lastDeleted.exercise);
    setLastDeleted(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    update({ exercises });
    showToast();
    announce(`${lastDeleted.exercise.name}を元に戻しました`);
  };

  const startBulk = () => {
    const values: Record<string, BulkValues> = {};
    data.exercises.forEach((ex) => {
      values[ex.id] = { amount: String(ex.amount), unit: ex.unit, sets: String(ex.sets) };
    });
    setBulkValues(values);
    setBulkMode(true);
    setEditingId(null);
    announce('まとめて編集モードにしました');
  };

  const saveBulk = () => {
    const changes: Exercise[] = [];
    const exercises = data.exercises.map((ex) => {
      const v = bulkValues[ex.id];
      if (!v) return ex;
      const amount = toInt(v.amount, ex.amount, 1, 999);
      const unit = v.unit === '秒' ? ('秒' as const) : ('回' as const);
      const sets = toInt(v.sets, ex.sets, 1, 10);
      if (amount !== ex.amount || unit !== ex.unit || sets !== ex.sets) {
        const changed = { ...ex, amount, unit, sets };
        changes.push(changed);
        return changed;
      }
      return ex;
    });
    setBulkMode(false);
    update({ exercises });
    if (changes.length > 0) reflectEditsToToday(changes);
    showToast();
    announce('まとめて保存しました');
  };

  /* ドラッグ並び替え: ハンドルのポインター操作（マウス・タッチ両方）で行を動かし、
     離した位置で確定する。 */
  const onHandlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (bulkMode || editingId) return;
    if (typeof event.button === 'number' && event.button > 0) return;
    const handle = event.currentTarget;
    const li = handle.closest('li');
    const list = listRef.current;
    if (!li || !list) return;
    event.preventDefault();
    const rows = Array.from(list.children) as HTMLElement[];
    const startY = event.clientY;
    let targetIndex = index;
    li.classList.add('manage-row--dragging');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 捕捉できなくても続行 */
    }
    const onMove = (ev: PointerEvent) => {
      (li as HTMLElement).style.transform = `translateY(${ev.clientY - startY}px)`;
      let count = 0;
      rows.forEach((row) => {
        if (row === li) return;
        const rect = row.getBoundingClientRect();
        if (ev.clientY > rect.top + rect.height / 2) count += 1;
      });
      targetIndex = count;
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      li.classList.remove('manage-row--dragging');
      (li as HTMLElement).style.transform = '';
      if (targetIndex !== index) {
        const exercises = [...data.exercises];
        const item = exercises.splice(index, 1)[0];
        exercises.splice(targetIndex, 0, item);
        update({ exercises });
        showToast();
        announce(`${item.name}を移動しました`);
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <section className="card" aria-labelledby="manage-heading">
      <h2 id="manage-heading">種目の管理</h2>
      <p className="settings-hint">
        「編集」から名前・メモも含めて変更できます。変更は明日の目標から反映されます。今日の記録がすでにある場合は、保存するときに「今日の目標にも反映するか」を確認します（過去の記録は変わりません）。
      </p>

      <h3 className="manage-subheading">種目を追加</h3>
      <form onSubmit={submitAdd}>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="add-name">
              名前
            </label>
            <input
              type="text"
              id="add-name"
              required
              maxLength={40}
              placeholder="例: スクワット"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="add-amount">
              1セットの回数・時間
            </label>
            <input
              type="number"
              id="add-amount"
              required
              min={1}
              max={999}
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="add-unit">
              単位（回数・秒数）
            </label>
            <select id="add-unit" value={addUnit} onChange={(e) => setAddUnit(e.target.value)}>
              <option value="回">回</option>
              <option value="秒">秒</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="add-sets">
              セット数（何回繰り返すか）
            </label>
            <input
              type="number"
              id="add-sets"
              required
              min={1}
              max={10}
              value={addSets}
              onChange={(e) => setAddSets(e.target.value)}
            />
          </div>
          <div className="field field--wide">
            <label className="field__label" htmlFor="add-note">
              メモ（任意）
            </label>
            <input
              type="text"
              id="add-note"
              maxLength={80}
              placeholder="フォームの注意など"
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
            />
          </div>
        </div>
        <p className="settings-hint">
          例: {addName.trim() || '種目'} {addAmount || '0'}
          {addUnit} × {addSets || '0'}セット
        </p>
        <button type="submit" className="btn btn--primary">
          種目を追加
        </button>
      </form>

      <h3 className="manage-subheading">テンプレートから追加</h3>
      <p className="settings-hint">よく使う種目を1タップで追加できます。すでにある種目は追加できません。</p>
      <ul className="template-list">
        {EXERCISE_TEMPLATES.map((tpl, tplIndex) => {
          const exists = data.exercises.some((ex) => ex.name === tpl.name);
          return (
            <li className="template-row" key={tpl.name}>
              <div>
                <span className="template-row__name">{tpl.name}</span>
                <span className="template-row__spec">
                  {' '}
                  {tpl.amount}
                  {tpl.unit} × {tpl.sets}セット{tpl.note ? `（${tpl.note}）` : ''}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--small"
                disabled={exists}
                onClick={() => addFromTemplate(tplIndex)}
              >
                {exists ? '追加済み' : '追加'}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="data-status" role="status">
        {templateStatus}
      </p>

      <h3 className="manage-subheading">いまの種目</h3>
      <div className="data-actions__row bulk-controls">
        {!bulkMode ? (
          <button type="button" className="btn btn--small" onClick={startBulk}>
            まとめて編集
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--small" onClick={saveBulk}>
              まとめて保存
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                setBulkMode(false);
                announce('まとめて編集をやめました');
              }}
            >
              キャンセル
            </button>
          </>
        )}
      </div>
      <p className="settings-hint">
        「まとめて編集」では、全種目の回数・単位・セット数を一覧のまま一度に変えられます。並び替えは、行の左端のハンドルをドラッグするか、「上へ／下へ」ボタンで変えられます。
      </p>

      {lastDeleted && (
        <div className="undo-bar">
          <span>「{lastDeleted.exercise.name}」を削除しました。</span>
          <button type="button" className="btn btn--small" onClick={undoDelete}>
            元に戻す
          </button>
        </div>
      )}

      <ul className="manage-list" ref={listRef}>
        {data.exercises.map((ex, index) => (
          <li className="manage-row" key={ex.id} data-exercise-id={ex.id}>
            {bulkMode ? (
              <>
                <p className="manage-row__name">{ex.name}</p>
                <div className="manage-row__bulk">
                  <div className="field">
                    <label className="field__label" htmlFor={`bulk-field-${ex.id}-amount`}>
                      1セットの回数・時間
                    </label>
                    <input
                      type="number"
                      id={`bulk-field-${ex.id}-amount`}
                      min={1}
                      max={999}
                      value={bulkValues[ex.id]?.amount ?? String(ex.amount)}
                      onChange={(e) =>
                        setBulkValues((prev) => ({
                          ...prev,
                          [ex.id]: { ...(prev[ex.id] ?? { unit: ex.unit, sets: String(ex.sets) }), amount: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`bulk-field-${ex.id}-unit`}>
                      単位（回数・秒数）
                    </label>
                    <select
                      id={`bulk-field-${ex.id}-unit`}
                      value={bulkValues[ex.id]?.unit ?? ex.unit}
                      onChange={(e) =>
                        setBulkValues((prev) => ({
                          ...prev,
                          [ex.id]: { ...(prev[ex.id] ?? { amount: String(ex.amount), sets: String(ex.sets) }), unit: e.target.value },
                        }))
                      }
                    >
                      <option value="回">回</option>
                      <option value="秒">秒</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`bulk-field-${ex.id}-sets`}>
                      セット数（何回繰り返すか）
                    </label>
                    <input
                      type="number"
                      id={`bulk-field-${ex.id}-sets`}
                      min={1}
                      max={10}
                      value={bulkValues[ex.id]?.sets ?? String(ex.sets)}
                      onChange={(e) =>
                        setBulkValues((prev) => ({
                          ...prev,
                          [ex.id]: { ...(prev[ex.id] ?? { amount: String(ex.amount), unit: ex.unit }), sets: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="manage-row__head">
                  {editingId !== ex.id && (
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`${ex.name}をドラッグで並び替え`}
                      onPointerDown={(e) => onHandlePointerDown(e, index)}
                    >
                      ⠿
                    </button>
                  )}
                  <p className="manage-row__name">{ex.name}</p>
                </div>
                {editingId === ex.id ? (
                  <ExerciseEditForm
                    exercise={ex}
                    onCancel={() => setEditingId(null)}
                    onSave={(cleaned) => {
                      const changed =
                        cleaned.name !== ex.name ||
                        cleaned.amount !== ex.amount ||
                        cleaned.unit !== ex.unit ||
                        cleaned.sets !== ex.sets;
                      const exercises = [...data.exercises];
                      exercises[index] = cleaned;
                      setEditingId(null);
                      update({ exercises });
                      if (changed) reflectEditsToToday([cleaned]);
                      showToast();
                      announce(`${cleaned.name}を保存しました`);
                    }}
                  />
                ) : (
                  <p className="manage-row__summary">
                    {ex.amount}
                    {ex.unit} × {ex.sets}セット{ex.note ? `（${ex.note}）` : ''}
                  </p>
                )}
                <div className="manage-row__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={index === 0}
                    aria-label={`${ex.name}を上へ移動`}
                    onClick={() => moveExercise(index, -1)}
                  >
                    ↑ 上へ
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={index === data.exercises.length - 1}
                    aria-label={`${ex.name}を下へ移動`}
                    onClick={() => moveExercise(index, 1)}
                  >
                    ↓ 下へ
                  </button>
                  {editingId !== ex.id && (
                    <button
                      type="button"
                      className="btn btn--small"
                      aria-label={`${ex.name}を編集`}
                      onClick={() => setEditingId(ex.id)}
                    >
                      編集
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--small btn--danger manage-row__delete"
                    aria-label={`${ex.name}を削除`}
                    onClick={() => deleteExercise(ex, index)}
                  >
                    削除
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 種目の編集フォーム: 名前・数値・単位・セット数・メモをまとめて編集し、
   保存／キャンセルで確定する。 */
function ExerciseEditForm({
  exercise,
  onSave,
  onCancel,
}: {
  exercise: Exercise;
  onSave: (cleaned: Exercise) => void;
  onCancel: () => void;
}) {
  const { announce } = useStore();
  const [name, setName] = useState(exercise.name);
  const [amount, setAmount] = useState(String(exercise.amount));
  const [unit, setUnit] = useState<string>(exercise.unit);
  const [sets, setSets] = useState(String(exercise.sets));
  const [note, setNote] = useState(exercise.note);
  const fid = (seq: number) => `edit-field-${exercise.id}-${seq}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeExercise({
      id: exercise.id,
      name,
      amount,
      unit,
      sets,
      note: note.trim(),
    });
    if (!cleaned) {
      announce('名前を入力してください');
      return;
    }
    onSave(cleaned);
  };

  return (
    <form className="edit-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor={fid(1)}>
            名前
          </label>
          <input type="text" id={fid(1)} required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid(2)}>
            1セットの回数・時間
          </label>
          <input type="number" id={fid(2)} min={1} max={999} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid(3)}>
            単位（回数・秒数）
          </label>
          <select id={fid(3)} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="回">回</option>
            <option value="秒">秒</option>
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid(4)}>
            セット数（何回繰り返すか）
          </label>
          <input type="number" id={fid(4)} min={1} max={10} required value={sets} onChange={(e) => setSets(e.target.value)} />
        </div>
        <div className="field field--wide">
          <label className="field__label" htmlFor={fid(5)}>
            メモ（任意）
          </label>
          <input type="text" id={fid(5)} maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <p className="settings-hint">
        例: {name.trim() || '種目'} {amount || '0'}
        {unit} × {sets || '0'}セット
      </p>
      <div className="data-actions__row">
        <button type="submit" className="btn btn--primary btn--small">
          保存
        </button>
        <button type="button" className="btn btn--small" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
