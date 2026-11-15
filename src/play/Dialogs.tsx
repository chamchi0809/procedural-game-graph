import { useEffect, useRef, useState } from 'react';
import type { GameRuntime } from '../game/runtime';
import { iconUrl } from '../icons';
import { t, useTerms } from '../terms';
import { hintText, clueText, j, nodeTitle } from '../ui/text';
import { playChime } from './sound';

export function ActivatorDialog({ runtime, id }: { runtime: GameRuntime; id: string }) {
  useTerms();
  const activator = runtime.byId.get(id)!;
  const abilities = runtime.knownAbilities();
  const hints = runtime.journal.filter((j) => j.kind === 'hint' && runtime.byId.get(j.id)?.hintB === id);

  const play = (abilityId: string) => {
    playChime(runtime.byId.get(abilityId)!.sym!);
    runtime.applyAbility(id, abilityId);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < abilities.length) {
        e.preventDefault();
        play(abilities[i].id);
      } else if (e.key === 'Escape') runtime.closeDialog();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  return (
    <div className="dialog" role="dialog" aria-label={t('activator')}>
      <div className="dlg-head">
        <img src={iconUrl('activator', activator.sym)} alt="" />
        <div>
          <b>{nodeTitle(activator)}</b>
          <span>어떤 {j(t('ability'), '을/를')} 사용할까?</span>
        </div>
      </div>
      {abilities.length === 0 ? (
        <p className="dlg-empty">아직 습득한 {j(t('ability'), '이/가')} 없다. 먼저 {j(t('ability'), '을/를')} 찾아보자.</p>
      ) : (
        <div className="ability-list">
          {abilities.map((s, i) => (
            <button key={s.id} className="ability" onClick={() => play(s.id)}>
              <kbd>{i + 1}</kbd>
              <img src={iconUrl('ability', s.sym)} alt="" />
              {nodeTitle(s)}
            </button>
          ))}
        </div>
      )}
      {hints.map((h) => (
        <p key={h.id} className="dlg-hint">💡 {hintText(runtime.byId.get(h.id)!, runtime.byId)}</p>
      ))}
      <button className="btn wide" onClick={() => runtime.closeDialog()}>닫기 (Esc)</button>
    </div>
  );
}

export function CodeDialog({ runtime, id }: { runtime: GameRuntime; id: string }) {
  useTerms();
  const gate = runtime.byId.get(id)!;
  // Ref-backed so several keystrokes within one frame each see the latest value.
  const st = useRef({ digits: [0, 0, 0], slot: 0 });
  const [, render] = useState(0);
  const { digits, slot } = st.current;
  const update = (next: Partial<typeof st.current>) => {
    st.current = { ...st.current, ...next };
    render((r) => r + 1);
  };
  const setSlot = (i: number) => update({ slot: Math.max(0, Math.min(2, i)) });
  const [shake, setShake] = useState(0);
  const clues = runtime.journal.filter((j) => j.kind === 'clue' && runtime.byId.get(j.id)?.gate === id);

  const set = (i: number, v: number) => update({ digits: st.current.digits.map((x, j) => (j === i ? (v + 10) % 10 : x)) });
  const submit = () => {
    if (!runtime.submitCode(id, st.current.digits)) setShake((s) => s + 1);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      e.stopPropagation();
      const { digits: d, slot: s } = st.current;
      if (/^[0-9]$/.test(e.key)) {
        set(s, Number(e.key));
        setSlot(s + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'w') set(s, d[s] + 1);
      else if (e.key === 'ArrowDown' || e.key === 's') set(s, d[s] - 1);
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'Backspace') setSlot(s - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd') setSlot(s + 1);
      else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') runtime.closeDialog();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  return (
    <div className="dialog" role="dialog" aria-label={t('gate.code')}>
      <div className="dlg-head">
        <img src={iconUrl('dial', gate.sym)} alt="" />
        <div>
          <b>{nodeTitle(gate)}</b>
          <span>숫자 키 또는 ↑↓ 로 입력, Enter</span>
        </div>
      </div>
      <div className="dials" key={shake} data-shake={shake > 0}>
        {digits.map((d, i) => (
          <div key={i} className={`dial ${slot === i ? 'on' : ''}`} onClick={() => setSlot(i)}>
            <button onClick={() => set(i, d + 1)} aria-label="올리기">▲</button>
            <span>{d}</span>
            <button onClick={() => set(i, d - 1)} aria-label="내리기">▼</button>
          </div>
        ))}
      </div>
      {clues.length ? (
        clues.map((c) => <p key={c.id} className="dlg-hint">🔢 {clueText(runtime.byId.get(c.id)!, runtime.byId)}</p>)
      ) : (
        <p className="dlg-empty">아직 이 관문의 {j(t('clue'), '을/를')} 찾지 못했다. 같은 무늬의 {j(t('clue'), '을/를')} 찾아보자.</p>
      )}
      <div className="row">
        <button className="btn" onClick={() => runtime.closeDialog()}>닫기</button>
        <button className="btn primary" onClick={submit}>열기 (Enter)</button>
      </div>
    </div>
  );
}
