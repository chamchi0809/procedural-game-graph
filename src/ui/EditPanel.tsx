import type { SpecEdit } from '../App';
import { addBranch, disconnect, insertAfter, movePiece, pieceRef, pieceTargets, removeLocation, setEntrance, setLock, setSlotCount } from '../core/edit';
import { GOAL, START } from '../core/locations';
import { MAX_SLOTS } from '../core/spec';
import { LOCK_KINDS, type DepGraph, type DepNode, type DepSpec, type LockKind } from '../core/types';
import { fmt, lockName, t, type TermKey } from '../terms';
import { nodeTitle } from './text';

const SLOT_TERM: Record<LockKind, TermKey> = { key: 'key', switch: 'switch', follower: 'follower', ability: 'activator', code: 'clue' };

export interface EditProps {
  spec: DepSpec;
  onEdit: (fn: SpecEdit) => void;
  onConnect: (from: string | null) => void;
  connecting: boolean;
}

function GateFields({ spec, L, name, onEdit }: { spec: DepSpec; L: string; name: (id: string) => string; onEdit: EditProps['onEdit'] }) {
  const g = spec.gates[L];
  if (!g) return null;
  return (
    <>
      <label className="ed-row">
        <span>관문</span>
        <select value={g.lock} onChange={(e) => onEdit((s) => setLock(s, L, e.target.value as LockKind))}>
          {LOCK_KINDS.map((k) => (
            <option key={k} value={k}>
              {lockName(k)}
            </option>
          ))}
        </select>
      </label>
      <div className="ed-row">
        <span>{t(SLOT_TERM[g.lock])} 수</span>
        <div className="seg">
          {Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={g.slots.length === n ? 'on' : ''}
              disabled={g.lock === 'key' && n > 1}
              title={g.lock === 'key' && n > 1 ? `${lockName('key')}에는 하나만 쓸 수 있습니다` : undefined}
              onClick={() => onEdit((s) => setSlotCount(s, L, n))}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {spec.parents[L].length > 1 && (
        <label className="ed-row" title={fmt('관문이 서 있는 선행 {location}. 나머지 선행 {location:은/는} 아이템 배치로 연결됩니다')}>
          <span>관문 위치</span>
          <select value={g.entrance} onChange={(e) => onEdit((s) => setEntrance(s, L, e.target.value))}>
            {spec.parents[L].map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** Editing controls for the selected node; only shown on the final snapshot. */
export function EditPanel({ node, graph, spec, onEdit, onConnect, connecting }: EditProps & { node: DepNode; graph: DepGraph }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => (byId.get(id) ? nodeTitle(byId.get(id)!) : id);

  if (spec.locs.includes(node.id)) {
    const L = node.id;
    return (
      <section className="edit-panel">
        <h4>편집</h4>
        <div className="ed-actions">
          {L !== GOAL && (
            <>
              <button className="btn" title={fmt('이 {location:과/와} 다음 {location} 사이에 새 {location:을/를} 끼워 넣습니다')} onClick={() => onEdit((s) => insertAfter(s, L))}>
                ＋ 뒤에 추가
              </button>
              <button className="btn" title={fmt('이 {location}에서 갈라지는 새 {location:을/를} 만듭니다')} onClick={() => onEdit((s) => addBranch(s, L))}>
                ⑂ 갈래 추가
              </button>
              <button className={`btn ${connecting ? 'on' : ''}`} title={fmt('다음에 클릭한 {location:이/가} 이 {location}에 의존하게 합니다')} onClick={() => onConnect(connecting ? null : L)}>
                → 연결…
              </button>
            </>
          )}
          {L !== START && L !== GOAL && (
            <button className="btn danger" title="삭제 (Delete)" onClick={() => onEdit((s) => removeLocation(s, L))}>
              삭제
            </button>
          )}
        </div>
        {L !== START && (
          <div className="ed-row">
            <span>{fmt('선행 {location}')}</span>
            <div className="ed-parents">
              {spec.parents[L].map((p) => (
                <span key={p} className="ed-parent">
                  {name(p)}
                  {spec.parents[L].length > 1 && (
                    <button title="연결 끊기" onClick={() => onEdit((s) => disconnect(s, p, L))}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
        <GateFields spec={spec} L={L} name={name} onEdit={onEdit} />
      </section>
    );
  }

  if (node.kind === 'gate' && node.to) {
    return (
      <section className="edit-panel">
        <h4>편집</h4>
        <GateFields spec={spec} L={node.to} name={name} onEdit={onEdit} />
      </section>
    );
  }

  if (!pieceRef(node.id)) return null;
  const targets = pieceTargets(spec, node.id);
  return (
    <section className="edit-panel">
      <h4>편집</h4>
      <label className="ed-row" title={fmt('의존성을 깨지 않는 {location}만 고를 수 있습니다')}>
        <span>{fmt('놓을 {location}')}</span>
        <select value={node.loc} onChange={(e) => onEdit((s) => movePiece(s, node.id, e.target.value))}>
          {targets.map((l) => (
            <option key={l} value={l}>
              {name(l)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
