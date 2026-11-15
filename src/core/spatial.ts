// Relaxation of the spatial graph. Repulsion is short-ranged: distant parts of the graph
// don't need to push each other away, which keeps the layout compact and curvy.

import { START } from './locations';
import type { Rng } from './rng';
import type { DepGraph, Vec2 } from './types';

const LOC_SPACING = 26;

/**
 * Initial positions grown along the entrance tree: each location next to the one its gate stands
 * in, objects around their location. Ids already in `keep` stay where they are.
 */
export function placeInitial(graph: DepGraph, order: string[], entrance: Record<string, string>, rng: Rng, keep: Record<string, Vec2> = {}): Record<string, Vec2> {
  const pos: Record<string, Vec2> = {};
  const locSet = new Set(order);
  for (const id of order) if (keep[id]) pos[id] = { ...keep[id] };
  if (!pos[START]) pos[START] = { x: 0, y: 0 };

  for (const L of order) {
    if (pos[L]) continue;
    const origin = pos[entrance[L]] ?? pos[START];
    const others = order.filter((l) => pos[l]).map((l) => pos[l]);
    let best = { p: origin, score: -Infinity };
    for (let k = 0; k < 28; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = LOC_SPACING * rng.range(0.9, 1.15);
      const p = { x: origin.x + Math.cos(a) * d, y: origin.y + Math.sin(a) * d };
      const clearance = Math.min(80, ...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
      const score = clearance + Math.hypot(p.x, p.y) * 0.08 + rng.range(0, 3);
      if (score > best.score) best = { p, score };
    }
    pos[L] = best.p;
  }

  for (const n of graph.nodes) {
    if (locSet.has(n.id) || n.kind === 'gate') continue;
    if (keep[n.id]) {
      pos[n.id] = { ...keep[n.id] };
      continue;
    }
    const c = pos[n.loc];
    const siblings = graph.nodes.filter((m) => m.loc === n.loc && m.id !== n.loc && pos[m.id]).map((m) => pos[m.id]);
    const otherLocs = order.filter((l) => l !== n.loc).map((l) => pos[l]);
    let best = { p: { x: c.x + 3, y: c.y }, score: -Infinity };
    for (let k = 0; k < 24; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(3.5, 9);
      const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      const nearestOther = Math.min(99, ...otherLocs.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
      const spread = Math.min(8, ...siblings.map((s) => Math.hypot(s.x - p.x, s.y - p.y)));
      const score = spread * 1.5 + Math.min(0, nearestOther - r * 1.6) * 3 + rng.range(0, 1);
      if (score > best.score) best = { p, score };
    }
    pos[n.id] = best.p;
  }

  for (const g of graph.nodes) if (g.kind === 'gate') pos[g.id] = { x: (pos[g.from!].x + pos[g.to!].x) / 2, y: (pos[g.from!].y + pos[g.to!].y) / 2 };
  return pos;
}

export function relaxSpatial(
  graph: DepGraph,
  start: Record<string, Vec2>,
  entrance: Record<string, string>,
  fixed: ReadonlySet<string> = new Set(),
  iterations = 260,
): Record<string, Vec2> {
  const pos: Record<string, Vec2> = Object.fromEntries(Object.entries(start).map(([k, v]) => [k, { ...v }]));
  const isLoc = (k: string) => {
    const n = graph.nodes.find((x) => x.id === k);
    return !!n && (n.kind === 'start' || n.kind === 'goal' || n.kind === 'location');
  };
  const nodeLoc = new Map(graph.nodes.map((n) => [n.id, n.loc]));
  const locs = graph.nodes.filter((n) => isLoc(n.id)).map((n) => n.id);
  const objects = graph.nodes.filter((n) => !isLoc(n.id) && n.kind !== 'gate').map((n) => n.id);
  const gates = graph.nodes.filter((n) => n.kind === 'gate');

  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    const step = 0.35 * t + 0.05;
    const force = new Map<string, Vec2>();
    const add = (k: string, x: number, y: number) => {
      const f = force.get(k) ?? { x: 0, y: 0 };
      f.x += x;
      f.y += y;
      force.set(k, f);
    };

    // Location ↔ location: short-ranged repulsion, spring to the entrance neighbour.
    for (let i = 0; i < locs.length; i++) {
      for (let j = i + 1; j < locs.length; j++) {
        const a = pos[locs[i]];
        const b = pos[locs[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const range = 34;
        if (d < range) {
          const f = ((range - d) / range) * 6;
          add(locs[i], (-dx / d) * f, (-dy / d) * f);
          add(locs[j], (dx / d) * f, (dy / d) * f);
        }
      }
    }
    for (const [l, e] of Object.entries(entrance)) {
      const a = pos[e];
      const b = pos[l];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 24) * 0.12;
      add(e, (dx / d) * f, (dy / d) * f);
      add(l, (-dx / d) * f, (-dy / d) * f);
    }

    // Objects: spring to their own location, repel siblings, avoid other locations.
    for (const o of objects) {
      const p = pos[o];
      const home = pos[nodeLoc.get(o)!];
      const dx = home.x - p.x;
      const dy = home.y - p.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 5.5) * 0.18;
      add(o, (dx / d) * f, (dy / d) * f);
      if (d < 3) add(o, (-dx / d) * (3 - d), (-dy / d) * (3 - d));
      for (const l of locs) {
        if (l === nodeLoc.get(o)) continue;
        const q = pos[l];
        const ex = p.x - q.x;
        const ey = p.y - q.y;
        const e = Math.hypot(ex, ey) || 0.01;
        if (e < 15) add(o, (ex / e) * (15 - e) * 0.5, (ey / e) * (15 - e) * 0.5);
      }
    }
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        const a = pos[objects[i]];
        const b = pos[objects[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < 4.5) {
          const f = (4.5 - d) * 0.6;
          add(objects[i], (-dx / d) * f, (-dy / d) * f);
          add(objects[j], (dx / d) * f, (dy / d) * f);
        }
      }
    }

    for (const [k, f] of force) {
      if (fixed.has(k)) continue;
      const m = Math.hypot(f.x, f.y);
      const cap = 3;
      const s = m > cap ? cap / m : 1;
      pos[k].x += f.x * s * step;
      pos[k].y += f.y * s * step;
    }
    // Keep the start location anchored at the origin, unless the user pinned things in place.
    const s0 = pos[START];
    if (!fixed.size && s0 && (s0.x || s0.y)) {
      const ox = s0.x;
      const oy = s0.y;
      for (const k of Object.keys(pos)) {
        pos[k].x -= ox;
        pos[k].y -= oy;
      }
    }
  }
  for (const g of gates) {
    const a = pos[g.from!];
    const b = pos[g.to!];
    pos[g.id] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return pos;
}
