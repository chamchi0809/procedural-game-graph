// Turns the spatial graph into a walkable world, following the article: Voronoi cells around
// the laid-out positions, and walls wherever neighbouring cells belong to different locations.
// Each gate becomes an opening in the wall between its two locations.

import { Delaunay } from 'd3-delaunay';
import type { Rng } from './rng';
import type { Cell, DepGraph, Door, Seg, Tree, Vec2, World } from './types';

export const CELL = 3.6;
const CUTOFF = 11.5;
export const DOOR_WIDTH = 2.4;

export class WorldBuildError extends Error {}

function sharedEdge(a: [number, number][], b: [number, number][]): [Vec2, Vec2] | null {
  const hits: Vec2[] = [];
  for (const p of a) {
    for (const q of b) {
      if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6) {
        if (!hits.some((h) => Math.abs(h.x - p[0]) < 1e-6 && Math.abs(h.y - p[1]) < 1e-6)) hits.push({ x: p[0], y: p[1] });
      }
    }
  }
  return hits.length >= 2 ? [hits[0], hits[1]] : null;
}

export function distToSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2));
  return Math.hypot(px - (s.ax + dx * t), py - (s.ay + dy * t));
}

export function buildWorld(graph: DepGraph, pos: Record<string, Vec2>, locIds: string[], rng: Rng): World {
  const locIndex = new Map(locIds.map((id, i) => [id, i]));
  const isLoc = (kind: string) => kind === 'start' || kind === 'goal' || kind === 'location';

  type Anchor = { x: number; y: number; label: number };
  const anchors: Anchor[] = [];
  for (const id of locIds) {
    const c = pos[id];
    const label = locIndex.get(id)!;
    anchors.push({ ...c, label });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      anchors.push({ x: c.x + Math.cos(a) * 6.5, y: c.y + Math.sin(a) * 6.5, label });
    }
  }
  for (const n of graph.nodes) {
    if (isLoc(n.kind) || n.kind === 'gate') continue;
    anchors.push({ ...pos[n.id], label: locIndex.get(n.loc)! });
  }

  const margin = CUTOFF + CELL * 3;
  const minX = Math.min(...anchors.map((a) => a.x)) - margin;
  const minY = Math.min(...anchors.map((a) => a.y)) - margin;
  const maxX = Math.max(...anchors.map((a) => a.x)) + margin;
  const maxY = Math.max(...anchors.map((a) => a.y)) + margin;

  const sites: [number, number][] = [];
  for (let y = minY + CELL / 2; y < maxY; y += CELL) {
    for (let x = minX + CELL / 2; x < maxX; x += CELL) {
      sites.push([x + rng.range(-0.38, 0.38) * CELL, y + rng.range(-0.38, 0.38) * CELL]);
    }
  }
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([minX, minY, maxX, maxY]);

  const labels = sites.map(([x, y]) => {
    let best = -1;
    let bestD = CUTOFF;
    for (const a of anchors) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bestD) {
        bestD = d;
        best = a.label;
      }
    }
    return best;
  });
  const neighbors = sites.map((_, i) => [...delaunay.neighbors(i)]);

  // Keep only the connected component holding each location's centre; strays become forest.
  const mainCell: number[] = [];
  locIds.forEach((id, li) => {
    const c = pos[id];
    let seed = delaunay.find(c.x, c.y);
    if (labels[seed] !== li) {
      let best = -1;
      let bestD = Infinity;
      labels.forEach((l, i) => {
        if (l !== li) return;
        const d = Math.hypot(sites[i][0] - c.x, sites[i][1] - c.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) throw new WorldBuildError(`location ${id} has no cells`);
      seed = best;
    }
    const comp = new Set<number>([seed]);
    const stack = [seed];
    while (stack.length) {
      const i = stack.pop()!;
      for (const j of neighbors[i]) {
        if (labels[j] === li && !comp.has(j)) {
          comp.add(j);
          stack.push(j);
        }
      }
    }
    labels.forEach((l, i) => {
      if (l === li && !comp.has(i)) labels[i] = -1;
    });
    if (comp.size < 10) throw new WorldBuildError(`location ${id} too small`);
    mainCell[li] = seed;
  });

  const cells: Cell[] = sites.map((s, i) => ({
    site: { x: s[0], y: s[1] },
    poly: (voronoi.cellPolygon(i) ?? []).map((p) => [p[0], p[1]] as [number, number]),
    label: labels[i],
  }));

  // Doors: the shared wall edge between the two locations nearest the gate's spatial position.
  const doors: Record<string, Door> = {};
  for (const g of graph.nodes.filter((n) => n.kind === 'gate')) {
    const fi = locIndex.get(g.from!)!;
    const ti = locIndex.get(g.to!)!;
    const target = pos[g.id];
    let best: Door | null = null;
    let bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (labels[i] !== fi) continue;
      for (const j of neighbors[i]) {
        if (labels[j] !== ti) continue;
        const e = sharedEdge(cells[i].poly, cells[j].poly);
        if (!e) continue;
        const len = Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
        if (len < DOOR_WIDTH + 0.5) continue;
        const cx = (e[0].x + e[1].x) / 2;
        const cy = (e[0].y + e[1].y) / 2;
        const d = Math.hypot(cx - target.x, cy - target.y);
        if (d < bestD) {
          bestD = d;
          best = { gate: g.id, from: g.from!, to: g.to!, cx, cy, angle: Math.atan2(e[1].y - e[0].y, e[1].x - e[0].x), width: DOOR_WIDTH, cellFrom: i, cellTo: j };
        }
      }
    }
    if (!best) throw new WorldBuildError(`no shared wall for ${g.id}`);
    doors[g.id] = best;
  }
  const doorByPair = new Map<string, Door>();
  for (const d of Object.values(doors)) doorByPair.set(`${Math.min(d.cellFrom, d.cellTo)}:${Math.max(d.cellFrom, d.cellTo)}`, d);

  const walls: Seg[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (const j of neighbors[i]) {
      if (j <= i || labels[i] === labels[j]) continue;
      const e = sharedEdge(cells[i].poly, cells[j].poly);
      if (!e) continue;
      const door = doorByPair.get(`${i}:${j}`);
      if (!door) {
        walls.push({ ax: e[0].x, ay: e[0].y, bx: e[1].x, by: e[1].y });
        continue;
      }
      const len = Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
      const ux = (e[1].x - e[0].x) / len;
      const uy = (e[1].y - e[0].y) / len;
      const t0 = len / 2 - door.width / 2;
      const t1 = len / 2 + door.width / 2;
      walls.push({ ax: e[0].x, ay: e[0].y, bx: e[0].x + ux * t0, by: e[0].y + uy * t0 });
      walls.push({ ax: e[0].x + ux * t1, ay: e[0].y + uy * t1, bx: e[1].x, by: e[1].y });
      door.angle = Math.atan2(uy, ux);
    }
  }

  // Final object positions: inside their location's walkable area, clear of doors and walls.
  const objects: Record<string, Vec2> = {};
  const placed: Vec2[] = [];
  const doorList = Object.values(doors);
  const clear = (p: Vec2, minObj: number) =>
    placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minObj) &&
    doorList.every((d) => Math.hypot(d.cx - p.x, d.cy - p.y) >= 3.6) &&
    walls.every((w) => distToSeg(p.x, p.y, w) >= 1.3);
  const settle = (id: string, li: number, want: Vec2, minObj: number) => {
    const cell = delaunay.find(want.x, want.y);
    if (labels[cell] === li && clear(want, minObj)) {
      objects[id] = { ...want };
      placed.push(objects[id]);
      return;
    }
    const candidates = cells
      .map((c, i) => ({ i, d: Math.hypot(c.site.x - want.x, c.site.y - want.y) }))
      .filter((c) => labels[c.i] === li)
      .sort((a, b) => a.d - b.d);
    for (const relax of [minObj, minObj * 0.7, 1.2]) {
      for (const c of candidates) {
        const p = cells[c.i].site;
        if (clear(p, relax)) {
          objects[id] = { ...p };
          placed.push(objects[id]);
          return;
        }
      }
    }
    throw new WorldBuildError(`no room for ${id}`);
  };
  locIds.forEach((id, li) => settle(id, li, pos[id], 3));
  for (const n of graph.nodes) {
    if (isLoc(n.kind) || n.kind === 'gate') continue;
    settle(n.id, locIndex.get(n.loc)!, pos[n.id], 2.6);
  }
  for (const d of doorList) objects[d.gate] = { x: d.cx, y: d.cy };

  // Forest fills the void near the garden; a few blocking trees grow inside locations.
  const trees: Tree[] = [];
  const hop = new Array(cells.length).fill(Infinity);
  const queue: number[] = [];
  labels.forEach((l, i) => {
    if (l >= 0) {
      hop[i] = 0;
      queue.push(i);
    }
  });
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    for (const j of neighbors[i]) {
      if (hop[j] === Infinity) {
        hop[j] = hop[i] + 1;
        queue.push(j);
      }
    }
  }
  cells.forEach((c, i) => {
    if (c.label >= 0) {
      if (!rng.chance(0.07)) return;
      const p = { x: c.site.x + rng.range(-0.6, 0.6), y: c.site.y + rng.range(-0.6, 0.6) };
      const free =
        placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 3.4) &&
        doorList.every((d) => Math.hypot(d.cx - p.x, d.cy - p.y) > 4.5) &&
        walls.every((w) => distToSeg(p.x, p.y, w) > 2.2);
      if (free) trees.push({ ...p, r: 0.55, scale: rng.range(0.85, 1.25), blocking: true });
      return;
    }
    if (hop[i] > 4) return;
    const count = hop[i] <= 2 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      trees.push({ x: c.site.x + rng.range(-1.2, 1.2), y: c.site.y + rng.range(-1.2, 1.2), r: 0.6, scale: rng.range(0.9, 1.5), blocking: false });
    }
  });

  const s = objects[locIds[0]];
  let spawn = { x: s.x + 2, y: s.y + 0.5 };
  if (walls.some((w) => distToSeg(spawn.x, spawn.y, w) < 1)) spawn = { x: s.x, y: s.y + 1.6 };

  return { bounds: { minX, minY, maxX, maxY }, cells, neighbors, locIds, walls, doors, objects, trees, spawn, cellSize: CELL };
}
