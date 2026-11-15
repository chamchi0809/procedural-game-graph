// Layered (Sugiyama-style) layout for the dependency graph: Start at the bottom, Goal on top,
// like the diagrams in the article.

import { Graph, layout } from '@dagrejs/dagre';
import { isLocationKind } from '../core/generate';
import type { DepGraph, DepNode, Vec2 } from '../core/types';

export const LOC_SIZE = 64;
export const OBJ_SIZE = 50;

export const nodeSize = (n: DepNode) => (isLocationKind(n.kind) ? LOC_SIZE : OBJ_SIZE);

export function layeredLayout(graph: DepGraph): Record<string, Vec2> {
  const g = new Graph({ multigraph: false });
  g.setGraph({ rankdir: 'BT', nodesep: 22, ranksep: 38, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) {
    const s = nodeSize(n);
    g.setNode(n.id, { width: s, height: s + 14 });
  }
  for (const e of graph.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue;
    // Soft and long-range edges shouldn't pull ranks around as much as structural ones.
    const weight = e.kind === 'knowledge' ? 0.3 : e.kind === 'item' ? 1 : 2;
    g.setEdge(e.from, e.to, { weight, minlen: 1 });
  }
  layout(g);
  const out: Record<string, Vec2> = {};
  for (const id of g.nodes()) {
    const n = g.node(id);
    out[id] = { x: n.x, y: n.y };
  }
  return out;
}

/** Spatial positions (metres, y up) to screen pixels (y down). */
export const SPATIAL_SCALE = 9;
export function spatialToScreen(p: Vec2): Vec2 {
  return { x: p.x * SPATIAL_SCALE, y: -p.y * SPATIAL_SCALE };
}
