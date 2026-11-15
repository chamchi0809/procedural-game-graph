import { generateLocationDag, GOAL, START, topoOrder, type LocDag } from './locations';
import { makeRng } from './rng';
import { placeInitial, relaxSpatial } from './spatial';
import { buildDependency, normalizeSpec, randomSpec, specDag, type DepBuild } from './spec';
import type { DepGraph, DepNode, DepSpec, GenParams, Level, Snapshot, SpatialLayout, Vec2, World } from './types';
import { buildWorld, WorldBuildError } from './world';

export const DEFAULT_PARAMS: GenParams = {
  seed: 'mossy-garden-512',
  locations: 8,
  mechanics: ['key', 'switch', 'follower', 'ability', 'code'],
  remoteness: 0.45,
  complexity: 0.5,
  hints: true,
};

export function isLocationKind(kind: DepNode['kind']) {
  return kind === 'start' || kind === 'goal' || kind === 'location';
}

/** Greedy playthrough: always take the nearest action whose prerequisites are done. */
export function solve(graph: DepGraph, objects: Record<string, Vec2>) {
  const deps = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) if (e.kind !== 'path') deps.get(e.to)!.push(e.from);
  const done = new Set<string>([START]);
  const order = [START];
  let at = objects[START] ?? { x: 0, y: 0 };
  let choiceSum = 0;
  let choiceSteps = 0;
  while (done.size < graph.nodes.length) {
    const ready = graph.nodes.filter((n) => !done.has(n.id) && deps.get(n.id)!.every((d) => done.has(d)));
    if (!ready.length) break;
    const meaningful = ready.filter((n) => !isLocationKind(n.kind));
    if (meaningful.length) {
      choiceSum += meaningful.length;
      choiceSteps++;
    }
    const cost = (n: DepNode) => {
      if (isLocationKind(n.kind)) return -1;
      const p = objects[n.id] ?? at;
      return Math.hypot(p.x - at.x, p.y - at.y);
    };
    const next = ready.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    done.add(next.id);
    order.push(next.id);
    if (!isLocationKind(next.kind)) at = objects[next.id] ?? at;
  }
  return { order, complete: done.has(GOAL) && done.size === graph.nodes.length, branching: choiceSteps ? choiceSum / choiceSteps : 0 };
}

function longestPath(dag: LocDag): number {
  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const cs = dag.children.get(id)!;
    const v = cs.length ? 1 + Math.max(...cs.map(visit)) : 0;
    memo.set(id, v);
    return v;
  };
  return visit(START);
}

export interface Dependency extends DepBuild {
  edited: boolean;
  depth: number;
}

/** Random dependency graph: location rewrite, then mechanic injection. */
export function generateDependency(params: GenParams): Dependency {
  const rng = makeRng(params.seed);
  const rewriteSnaps: { dag: LocDag; title: string; detail: string; focus: string[] }[] = [];
  const dag = generateLocationDag(params.locations, params.complexity, rng.fork('dag'), (d, s) => rewriteSnaps.push({ dag: d, ...s }));
  const spec = normalizeSpec(randomSpec(dag, topoOrder(dag), params, rng.fork('inject')));
  const built = buildDependency(spec);

  const label = built.labels;
  const rename = (text: string) => text.replace(/\bL\d+\b/g, (m) => label.get(m) ?? m).replace(/\bstart\b/g, '{start}').replace(/\bgoal\b/g, '{goal}');
  const rewrite: Snapshot[] = rewriteSnaps.map((s) => {
    const ord = topoOrder(s.dag);
    return {
      phase: 'rewrite',
      title: rename(s.title),
      detail: rename(s.detail),
      focus: s.focus,
      pos: {},
      graph: {
        nodes: ord.map((id) => ({ id, kind: id === START ? 'start' : id === GOAL ? 'goal' : 'location', loc: id, label: label.get(id)!, step: 0 })),
        edges: ord.flatMap((id) => s.dag.children.get(id)!.map((c) => ({ id: `path:${id}->${c}`, from: id, to: c, kind: 'path' as const }))),
      },
    };
  });
  return { ...built, snapshots: [...rewrite, ...built.snapshots], edited: false, depth: longestPath(dag) };
}

/** Dependency graph from a hand-edited spec. */
export function dependencyFromSpec(spec: DepSpec): Dependency {
  const built = buildDependency(normalizeSpec(spec));
  if (!solve(built.graph, {}).complete) throw new Error('의존성 그래프에 순환이 있어 끝까지 풀 수 없습니다');
  return { ...built, edited: true, depth: longestPath(specDag(built.spec)) };
}

export interface SpatialResult {
  spatial: Record<string, Vec2>;
  world: World;
  solution: string[];
  branching: number;
  attempts: number;
}

/** Lay out a dependency graph in space and build its world. `layout` positions are kept as a starting point. */
export function generateSpatial(dep: Dependency, seed: string, layout: SpatialLayout | null = null): SpatialResult {
  const fixed = new Set(layout?.fixed ?? []);
  let lastError: unknown;
  for (let i = 0; i < 24; i++) {
    try {
      const rng = makeRng(i === 0 ? seed : `${seed}#${i}`);
      const initial = placeInitial(dep.graph, dep.order, dep.entrance, rng.fork('place'), layout?.pos);
      const spatial = relaxSpatial(dep.graph, initial, dep.entrance, fixed);
      const world = buildWorld(dep.graph, spatial, dep.order, rng.fork('world'));
      const solved = solve(dep.graph, world.objects);
      if (!solved.complete) throw new WorldBuildError('unsolvable');
      return { spatial, world, solution: solved.order, branching: solved.branching, attempts: i + 1 };
    } catch (e) {
      if (!(e instanceof WorldBuildError)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export function assembleLevel(params: GenParams, dep: Dependency, spatialSeed: string, sp: SpatialResult, ms: number): Level {
  const pick = (graph: DepGraph) => Object.fromEntries(graph.nodes.filter((n) => sp.spatial[n.id]).map((n) => [n.id, sp.spatial[n.id]]));
  const snapshots: Snapshot[] = dep.snapshots.map((s) => (s.phase === 'inject' ? { ...s, pos: pick(s.graph) } : s));
  snapshots.push({
    phase: 'final',
    title: '완성: 공간 이완 + 보로노이 월드',
    detail: '공간 그래프를 이완(가까운 것만 서로 밀어냄)한 뒤 보로노이 셀을 만들고, 다른 {location}에 속한 셀 사이에 벽을, 문 위치에는 통로를 냈다.',
    focus: [],
    graph: dep.graph,
    pos: sp.spatial,
  });
  return {
    params,
    spec: dep.spec,
    edited: dep.edited,
    spatialSeed,
    graph: dep.graph,
    snapshots,
    locations: dep.order,
    locParents: dep.locParents,
    entrance: dep.entrance,
    colors: dep.colors,
    spatial: sp.spatial,
    world: sp.world,
    solution: sp.solution,
    attempts: sp.attempts,
    stats: { nodes: dep.graph.nodes.length, edges: dep.graph.edges.length, branching: sp.branching, maxDepth: dep.depth, ms },
  };
}

export function generateLevel(params: GenParams, spatialSeed = params.seed): Level {
  const t0 = performance.now();
  const dep = generateDependency(params);
  return assembleLevel(params, dep, spatialSeed, generateSpatial(dep, spatialSeed), performance.now() - t0);
}
