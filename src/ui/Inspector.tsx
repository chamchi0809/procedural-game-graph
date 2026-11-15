import type { DepGraph, DepNode } from '../core/types';
import type { GameRuntime } from '../game/runtime';
import { iconUrl, nodeIcons } from '../icons';
import { EditPanel, type EditProps } from './EditPanel';
import { describe, EDGE_LABEL, kindName, nodeTitle } from './text';

const STATUS_LABEL = { done: '완료', available: '지금 가능', locked: '잠김' } as const;

interface Props {
  graph: DepGraph;
  id: string;
  colors: Record<string, string>;
  runtime: GameRuntime | null;
  tracked: string | null;
  canTrack: boolean;
  onSelect: (id: string | null) => void;
  onTrack: (id: string | null) => void;
  edit: EditProps | null;
}

export function Inspector({ graph, id, colors, runtime, tracked, canTrack, onSelect, onTrack, edit }: Props) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const n = byId.get(id);
  if (!n) return null;
  const icons = nodeIcons(n);
  const icon = icons.inner ?? icons.reward;
  const deps = graph.edges.filter((e) => e.to === id);
  const dependents = graph.edges.filter((e) => e.from === id);
  const status = runtime?.status(id);
  const missing = runtime && status !== 'done' ? runtime.missingKnowledge(id) : [];

  const Ref = ({ node, kind }: { node: DepNode; kind: string }) => (
    <button className={`ref ${runtime?.done.has(node.id) ? 'ref-done' : ''}`} onClick={() => onSelect(node.id)} title={EDGE_LABEL[kind as keyof typeof EDGE_LABEL]}>
      <i className={`edge-swatch e-${kind}`} />
      {nodeTitle(node)}
    </button>
  );

  return (
    <aside className="inspector" aria-label="노드 정보">
      <div className="insp-head" style={{ ['--loc' as string]: colors[n.loc] }}>
        {icon && <img src={iconUrl(icon.kind, icon.sym, icon.text)} alt="" />}
        <div>
          <div className="insp-kind">{kindName(n)}</div>
          <div className="insp-title">{nodeTitle(n)}</div>
        </div>
        <button className="icon-btn close" onClick={() => onSelect(null)} title="닫기 (Esc)">✕</button>
      </div>
      {status && <div className={`insp-status st-${status}`}>{STATUS_LABEL[status]}</div>}
      <p className="insp-desc">{describe(n, byId)}</p>
      {missing.length > 0 && (
        <p className="insp-note">아직 못 본 정보: {missing.map((m) => nodeTitle(byId.get(m)!)).join(', ')}</p>
      )}
      {deps.length > 0 && (
        <section>
          <h4>필요한 것 ({deps.length})</h4>
          <div className="refs">{deps.map((e) => <Ref key={e.id} node={byId.get(e.from)!} kind={e.kind} />)}</div>
        </section>
      )}
      {dependents.length > 0 && (
        <section>
          <h4>이것이 여는 것 ({dependents.length})</h4>
          <div className="refs">{dependents.map((e) => <Ref key={e.id} node={byId.get(e.to)!} kind={e.kind} />)}</div>
        </section>
      )}
      {canTrack && (
        <button className={`btn wide ${tracked === id ? 'on' : ''}`} onClick={() => onTrack(tracked === id ? null : id)}>
          {tracked === id ? '추적 해제' : '📍 3D 월드에서 추적'}
        </button>
      )}
      {edit && <EditPanel node={n} graph={graph} {...edit} />}
    </aside>
  );
}
