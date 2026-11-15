import { useEffect, useState } from 'react';
import type { Snapshot } from '../core/types';
import { fmt, useTerms } from '../terms';

const PHASE_LABEL: Record<Snapshot['phase'], string> = { rewrite: '1 · 장소 재작성', inject: '2 · 메커니즘 주입', final: '3 · 완성' };

interface Props {
  snapshots: Snapshot[];
  index: number;
  onIndex: (i: number) => void;
}

export function Timeline({ snapshots, index, onIndex }: Props) {
  useTerms();
  const [playing, setPlaying] = useState(false);
  const last = snapshots.length - 1;
  const snap = snapshots[index];

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => onIndex(index + 1), snap.phase === 'rewrite' ? 650 : 900);
    return () => clearTimeout(t);
  }, [playing, index, last, onIndex, snap.phase]);

  const firstOf = (phase: Snapshot['phase']) => snapshots.findIndex((s) => s.phase === phase);

  return (
    <div className="timeline">
      <div className="tl-controls">
        <button
          className="icon-btn"
          title={playing ? '일시정지' : '생성 과정 재생'}
          onClick={() => {
            if (!playing && index >= last) onIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" title="이전 단계 (,)" disabled={index <= 0} onClick={() => onIndex(index - 1)}>‹</button>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          aria-label="생성 단계"
          onChange={(e) => {
            setPlaying(false);
            onIndex(Number(e.target.value));
          }}
        />
        <button className="icon-btn" title="다음 단계 (.)" disabled={index >= last} onClick={() => onIndex(index + 1)}>›</button>
        <span className="tl-count">
          {index + 1}/{snapshots.length}
        </span>
      </div>
      <div className="tl-phases">
        {(['rewrite', 'inject', 'final'] as const).map((p) => {
          const at = firstOf(p);
          if (at < 0) return null;
          return (
            <button key={p} className={`phase ${snap.phase === p ? 'on' : ''}`} onClick={() => onIndex(p === 'final' ? last : at)}>
              {PHASE_LABEL[p]}
            </button>
          );
        })}
      </div>
      <div className="tl-text">
        <b>{fmt(snap.title)}</b>
        <span>{fmt(snap.detail)}</span>
      </div>
    </div>
  );
}
