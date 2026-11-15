import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
  type Edge,
  type Node,
  type NodeHandle,
  type NodeProps,
} from '@xyflow/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { isLocationKind } from '../core/generate';
import { symStyle } from '../core/patterns';
import type { DepGraph, DepNode, Level, Snapshot, Vec2 } from '../core/types';
import type { GameRuntime, NodeStatus } from '../game/runtime';
import { iconUrl, nodeIcons } from '../icons';
import { fmt, useTerms, type Terms } from '../terms';
import { nodeTitle, shortLabel } from '../ui/text';
import { layeredLayout, nodeSize, SPATIAL_SCALE, spatialToScreen } from './layout';

export type GraphMode = 'dep' | 'spatial';

type CardData = {
  node: DepNode;
  color: string;
  status: NodeStatus | null;
  focus: boolean;
  related: 'self' | 'up' | 'down' | 'dim' | null;
  selected: boolean;
  tracked: boolean;
  spatial: boolean;
  pinned: boolean;
  /** Only here so a rename re-renders the memoised card. */
  terms: Terms;
};
type CardNode = Node<CardData, 'card'>;

// Start/goal names are user-chosen and may be long; shrink to fit the fixed-size card.
function LocLabel({ text }: { text: string }) {
  const n = [...text].length;
  return (
    <span className="loc-label" title={text} style={n > 4 ? { fontSize: Math.max(8, Math.floor(56 / n)) } : undefined}>
      {text}
    </span>
  );
}

const NodeCard = memo(function NodeCard({ data }: NodeProps<CardNode>) {
  const { node, color, status, focus, related, selected, tracked, spatial, pinned } = data;
  const icons = nodeIcons(node);
  const loc = isLocationKind(node.kind);
  const size = nodeSize(node);
  const cls = [
    'card',
    loc ? 'card-loc' : 'card-obj',
    node.kind === 'gate' ? 'card-gate' : '',
    status ? `st-${status}` : '',
    focus ? 'focus' : '',
    related ? `rel-${related}` : '',
    selected ? 'selected' : '',
    tracked ? 'tracked' : '',
  ].join(' ');
  const handle = spatial ? 'h-center' : '';
  return (
    <div className={cls} style={{ width: size, height: size, ['--loc' as string]: color }} title={nodeTitle(node)}>
      <Handle type="target" position={spatial ? Position.Top : Position.Bottom} className={handle} isConnectable={false} />
      <Handle type="source" position={Position.Top} className={handle} isConnectable={false} />
      {icons.reward && <img className="reward" src={iconUrl(icons.reward.kind, icons.reward.sym, icons.reward.text)} alt="" draggable={false} />}
      {icons.inner && <img className="inner" src={iconUrl(icons.inner.kind, icons.inner.sym, icons.inner.text)} alt="" draggable={false} />}
      {loc && <LocLabel text={shortLabel(node)} />}
      {!loc && <span className="obj-label">{node.label}</span>}
      {status === 'done' && <span className="badge-done">✓</span>}
      {pinned && <span className="badge-pin" title="고정됨">📌</span>}
    </div>
  );
});

const nodeTypes = { card: NodeCard };

// Mirrors the Handle layout in NodeCard. xyflow drops `measured` on every rebuilt node, hiding it (and
// its edges) until re-measured and excluding it from fitView, so sizes and handles are supplied up front.
function cardHandles(s: number, spatial: boolean): NodeHandle[] {
  const h = 2;
  const at = (type: 'source' | 'target', position: Position, x: number, y: number): NodeHandle => ({ type, position, x: x - h / 2, y: y - h / 2, width: h, height: h });
  if (spatial) return [at('target', Position.Top, s / 2, s / 2), at('source', Position.Top, s / 2, s / 2)];
  return [at('target', Position.Bottom, s / 2, s), at('source', Position.Top, s / 2, 0)];
}

function edgeStyle(kind: string, color: string, dim: boolean, hot: boolean): Partial<Edge> {
  const base: React.CSSProperties = { opacity: dim ? 0.12 : 1, transition: 'opacity 150ms' };
  const marker = (c: string) => ({ type: MarkerType.ArrowClosed, color: c, width: 14, height: 14 });
  switch (kind) {
    case 'path':
      return { style: { ...base, stroke: '#9a9286', strokeWidth: 2, strokeDasharray: '6 4' }, markerEnd: marker('#9a9286') };
    case 'in':
      return { style: { ...base, stroke: hot ? '#3a332b' : '#b5ac9f', strokeWidth: 1.2 } };
    case 'unlock':
      return { style: { ...base, stroke: '#3a332b', strokeWidth: 3 }, markerEnd: marker('#3a332b') };
    case 'item':
      return { style: { ...base, stroke: color, strokeWidth: hot ? 3 : 2, strokeDasharray: '7 4' }, markerEnd: marker(color) };
    default:
      return { style: { ...base, stroke: '#4c8ed9', strokeWidth: 1.6, strokeDasharray: '2 4' }, markerEnd: marker('#4c8ed9') };
  }
}

function relatives(graph: DepGraph, id: string) {
  const up = new Set<string>();
  const down = new Set<string>();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of graph.edges) {
    (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from);
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
  }
  const walk = (start: string, map: Map<string, string[]>, out: Set<string>) => {
    const stack = [start];
    while (stack.length) for (const n of map.get(stack.pop()!) ?? []) if (!out.has(n)) {
      out.add(n);
      stack.push(n);
    }
  };
  walk(id, parents, up);
  walk(id, children, down);
  return { up, down };
}

interface Props {
  level: Level;
  snapshot: Snapshot;
  isFinal: boolean;
  mode: GraphMode;
  runtime: GameRuntime | null;
  rev: number;
  showStatus: boolean;
  selected: string | null;
  tracked: string | null;
  pinned?: string[];
  /** Location waiting for a second click to become its child's parent. */
  connectFrom: string | null;
  onSelect: (id: string | null) => void;
  onConnectTo: (id: string | null) => void;
  /** World coordinates of the dropped node's center. */
  onMoveNode: (id: string, to: Vec2) => void;
}

function Inner(props: Props) {
  const { level, snapshot, isFinal, mode, runtime, showStatus, selected, tracked, connectFrom, onSelect, onConnectTo, onMoveNode } = props;
  const [hover, setHover] = useState<string | null>(null);
  // Delay clearing so sweeping across gaps between nodes doesn't flash the whole graph.
  const leaveTimer = useRef(0);
  const enter = (id: string) => {
    clearTimeout(leaveTimer.current);
    setHover(id);
  };
  const leave = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHover(null), 120);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const flow = useReactFlow();
  const graph = snapshot.graph;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const hasSpatial = Object.keys(snapshot.pos).length > 0;
  const spatial = mode === 'spatial' && hasSpatial;
  const draggable = spatial && isFinal;
  const pinned = useMemo(() => new Set(props.pinned), [props.pinned]);
  // Screen-space offset of the node being dragged; a location drags its contents along.
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const positions = useMemo<Record<string, Vec2>>(() => {
    if (spatial) {
      const out: Record<string, Vec2> = {};
      // Final snapshot: show where things actually ended up in the playable world.
      const src = isFinal ? { ...snapshot.pos, ...level.world.objects } : snapshot.pos;
      for (const n of graph.nodes) if (src[n.id]) out[n.id] = spatialToScreen(src[n.id]);
      return out;
    }
    return layeredLayout(graph);
  }, [graph, spatial, isFinal, snapshot.pos, level.world.objects]);

  const rel = useMemo(() => {
    const id = hover ?? selected;
    return id && byId.has(id) ? { id, ...relatives(graph, id) } : null;
  }, [hover, selected, graph, byId]);

  const focus = useMemo(() => new Set(snapshot.focus), [snapshot.focus]);
  const terms = useTerms();

  const nodes: CardNode[] = useMemo(
    () =>
      graph.nodes
        .filter((n) => positions[n.id])
        .map((n) => {
          const s = nodeSize(n);
          const moved = drag && (n.id === drag.id || (n.loc === drag.id && n.kind !== 'gate'));
          const p = moved ? { x: positions[n.id].x + drag.dx, y: positions[n.id].y + drag.dy } : positions[n.id];
          const related = rel ? (rel.id === n.id ? 'self' : rel.up.has(n.id) ? 'up' : rel.down.has(n.id) ? 'down' : 'dim') : null;
          return {
            id: n.id,
            type: 'card',
            position: { x: p.x - s / 2, y: p.y - s / 2 },
            width: s,
            height: s,
            measured: { width: s, height: s },
            handles: cardHandles(s, spatial),
            draggable: draggable && n.kind !== 'gate',
            data: {
              node: n,
              color: level.colors[n.loc] ?? '#eee',
              status: showStatus && runtime && isFinal ? runtime.status(n.id) : null,
              focus: focus.has(n.id),
              related,
              selected: selected === n.id,
              tracked: tracked === n.id,
              spatial,
              pinned: draggable && pinned.has(n.id),
              terms,
            },
            zIndex: isLocationKind(n.kind) ? 1 : 2,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, positions, rel, focus, selected, tracked, showStatus, runtime, isFinal, props.rev, level.colors, spatial, terms, drag, draggable, pinned],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges
        .filter((e) => positions[e.from] && positions[e.to])
        .filter((e) => !(spatial && e.kind === 'knowledge'))
        .map((e) => {
          const gate = byId.get(e.to)?.kind === 'gate' ? byId.get(e.to) : byId.get(byId.get(e.from)?.gate ?? '');
          const color = gate?.sym !== undefined ? symStyle(gate.sym).base.replace(/(\d+)%\)$/, (_, l) => `${Math.min(Number(l), 46)}%)`) : '#c77d2c';
          const hot = !!rel && (rel.id === e.to || rel.id === e.from || (rel.up.has(e.from) && (rel.up.has(e.to) || rel.id === e.to)) || (rel.down.has(e.to) && (rel.down.has(e.from) || rel.id === e.from)));
          return {
            id: e.id,
            source: e.from,
            target: e.to,
            type: spatial ? 'straight' : 'default',
            zIndex: 0,
            ...edgeStyle(e.kind, color, !!rel && !hot, hot),
          };
        }),
    [graph, positions, byId, rel, spatial],
  );

  const fitKey = `${level.params.seed}|${level.spatialSeed}|${level.params.locations}|${mode}|${spatial}|${snapshot.phase === 'rewrite' ? 'r' : 'i'}`;
  const lastFit = useRef('');
  useEffect(() => {
    const first = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    const t = setTimeout(() => flow.fitView({ padding: 0.12, maxZoom: 1.1, duration: first ? 0 : 250 }), 30);
    return () => clearTimeout(t);
  }, [fitKey, graph.nodes.length, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => {
        if (!connectFrom) return onSelect(n.id === selected ? null : n.id);
        const node = byId.get(n.id);
        if (node && isLocationKind(node.kind)) onConnectTo(n.id);
      }}
      onPaneClick={() => (connectFrom ? onConnectTo(null) : onSelect(null))}
      onNodeDrag={(_, n) => {
        const s = nodeSize(byId.get(n.id)!);
        const p = positions[n.id];
        setDrag({ id: n.id, dx: n.position.x + s / 2 - p.x, dy: n.position.y + s / 2 - p.y });
      }}
      onNodeDragStop={(_, n) => {
        setDrag(null);
        const s = nodeSize(byId.get(n.id)!);
        const cx = n.position.x + s / 2;
        const cy = n.position.y + s / 2;
        const p = positions[n.id];
        if (Math.hypot(cx - p.x, cy - p.y) > 2) onMoveNode(n.id, { x: cx / SPATIAL_SCALE, y: -cy / SPATIAL_SCALE });
      }}
      nodeDragThreshold={4}
      onNodeMouseEnter={(_, n) => enter(n.id)}
      onNodeMouseLeave={leave}
      nodesDraggable={draggable}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.1}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      className={`flow flow-${mode} ${connectFrom ? 'connecting' : ''}`}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cfc7b8" />
      <Controls showInteractive={false} position="bottom-right" />
      {spatial && isFinal && <WorldUnderlay level={level} />}
      {spatial && isFinal && runtime && <PlayerMarker runtime={runtime} />}
      {connectFrom && (
        <div className="flow-note connect-note">
          <b>{byId.get(connectFrom) ? nodeTitle(byId.get(connectFrom)!) : connectFrom}</b> {fmt('다음에 올 {location:을/를} 클릭하세요')} · Esc 취소
        </div>
      )}
      {mode === 'spatial' && !hasSpatial && <div className="flow-note">재작성 단계에는 아직 공간 배치가 없어서 계층 레이아웃으로 보여준다. 타임라인을 주입 단계로 옮겨보자.</div>}
    </ReactFlow>
  );
}

/** The final Voronoi world drawn under the spatial graph. */
function WorldUnderlay({ level }: { level: Level }) {
  const url = useMemo(() => {
    const w = level.world;
    const S = SPATIAL_SCALE;
    const { minX, minY, maxX, maxY } = w.bounds;
    const c = document.createElement('canvas');
    c.width = Math.ceil((maxX - minX) * S);
    c.height = Math.ceil((maxY - minY) * S);
    const ctx = c.getContext('2d')!;
    const tx = (x: number) => (x - minX) * S;
    const ty = (y: number) => (maxY - y) * S;
    for (const cell of w.cells) {
      if (cell.label < 0 || cell.poly.length < 3) continue;
      ctx.fillStyle = level.colors[w.locIds[cell.label]];
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      cell.poly.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(70,60,50,0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of w.walls) {
      ctx.moveTo(tx(s.ax), ty(s.ay));
      ctx.lineTo(tx(s.bx), ty(s.by));
    }
    ctx.stroke();
    return { src: c.toDataURL(), left: minX * S, top: -maxY * S, width: c.width, height: c.height };
  }, [level]);
  return (
    <ViewportPortal>
      <img className="world-underlay" src={url.src} style={{ left: url.left, top: url.top, width: url.width, height: url.height }} alt="" draggable={false} />
    </ViewportPortal>
  );
}

function PlayerMarker({ runtime }: { runtime: GameRuntime }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = spatialToScreen(runtime.player);
      if (ref.current) ref.current.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${runtime.player.yaw}rad)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  return (
    <ViewportPortal>
      <div ref={ref} className="player-marker" />
    </ViewportPortal>
  );
}

export function GraphView(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
