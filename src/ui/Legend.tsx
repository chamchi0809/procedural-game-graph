import { useState } from 'react';
import { fmt, useTerms } from '../terms';
import { EDGE_LABEL } from './text';

export function Legend() {
  const [open, setOpen] = useState(false);
  useTerms();
  return (
    <div className={`legend ${open ? 'open' : ''}`}>
      <button className="legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        범례 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="legend-body">
          <div className="lg-row"><span className="lg-node loc" />큰 사각형 = 장소 (색 = 지역)</div>
          <div className="lg-row"><span className="lg-node obj" />작은 사각형 = 물건 · 관문</div>
          <div className="lg-row"><span className="lg-icon">⬚</span>안쪽 아이콘 = 장애물/매개체</div>
          <div className="lg-row"><span className="lg-icon">⬒</span>위쪽 테두리 아이콘 = 얻는 것</div>
          <div className="lg-row"><span className="lg-icon">▦</span>같은 색·무늬 = 서로 짝 ({fmt('{key}↔{gate.key}')})</div>
          <hr />
          {(Object.keys(EDGE_LABEL) as (keyof typeof EDGE_LABEL)[]).map((k) => (
            <div className="lg-row" key={k}>
              <svg width="34" height="10" className={`lg-edge e-${k}`}>
                <line x1="2" y1="5" x2="32" y2="5" />
              </svg>
              {EDGE_LABEL[k]}
            </div>
          ))}
          <hr />
          <div className="lg-row"><span className="lg-st st-done" />완료</div>
          <div className="lg-row"><span className="lg-st st-available" />지금 할 수 있음</div>
          <div className="lg-row"><span className="lg-st st-locked" />아직 잠김</div>
          <p className="lg-tip">노드에 마우스를 올리면 필요한 것(아래)과 그것이 여는 것(위)이 강조된다.</p>
        </div>
      )}
    </div>
  );
}
