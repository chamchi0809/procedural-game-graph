// Location-level progression DAG built with the graph rewrite rule from the article:
// pick an edge 1→2, insert A and B in parallel between them, and re-hang node 2's extra
// parent X and node 1's extra child Y onto A or B. In/out degree stays within 1..2.

import type { Rng } from './rng';

export interface LocDag {
  ids: string[];
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

export const START = 'start';
export const GOAL = 'goal';

export type RewriteStep = { title: string; detail: string; focus: string[] };

function cloneDag(dag: LocDag): LocDag {
  return {
    ids: [...dag.ids],
    parents: new Map([...dag.parents].map(([k, v]) => [k, [...v]])),
    children: new Map([...dag.children].map(([k, v]) => [k, [...v]])),
  };
}

function link(dag: LocDag, a: string, b: string) {
  dag.children.get(a)!.push(b);
  dag.parents.get(b)!.push(a);
}

function unlink(dag: LocDag, a: string, b: string) {
  dag.children.set(a, dag.children.get(a)!.filter((c) => c !== b));
  dag.parents.set(b, dag.parents.get(b)!.filter((p) => p !== a));
}

function addNode(dag: LocDag, id: string) {
  dag.ids.push(id);
  dag.parents.set(id, []);
  dag.children.set(id, []);
}

export function reaches(dag: LocDag, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...dag.children.get(n)!);
  }
  return false;
}

export function ancestorsOf(dag: LocDag, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...dag.parents.get(id)!];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...dag.parents.get(n)!);
  }
  return out;
}

/** Topological order, breaking ties by longest-path depth so labels read bottom-up. */
export function topoOrder(dag: LocDag): string[] {
  const depth = new Map<string, number>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const ps = dag.parents.get(id)!;
    const d = ps.length ? Math.max(...ps.map(visit)) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  dag.ids.forEach(visit);
  return [...dag.ids].sort((a, b) => depth.get(a)! - depth.get(b)! || dag.ids.indexOf(a) - dag.ids.indexOf(b));
}

/** `branching` is the chance each step uses the parallel rewrite instead of a plain edge split. */
export function generateLocationDag(
  count: number,
  branching: number,
  rng: Rng,
  onStep: (dag: LocDag, step: RewriteStep) => void,
): LocDag {
  const dag: LocDag = { ids: [], parents: new Map(), children: new Map() };
  addNode(dag, START);
  addNode(dag, GOAL);
  link(dag, START, GOAL);
  onStep(cloneDag(dag), { title: 'start → goal', detail: '가장 단순한 진행: start에서 goal까지 가는 하나의 의존성.', focus: [START, GOAL] });

  let serial = 0;
  const target = Math.max(2, count);
  while (dag.ids.length < target) {
    const edges: [string, string][] = [];
    for (const a of dag.ids) for (const b of dag.children.get(a)!) edges.push([a, b]);
    const [u, v] = rng.pick(edges);

    const lastOne = target - dag.ids.length === 1;
    // branching < 1 is checked first so branching = 1 consumes the rng exactly as before.
    if (lastOne || (branching < 1 && !rng.chance(branching))) {
      // A plain edge split keeps every degree unchanged.
      const c = `L${serial++}`;
      addNode(dag, c);
      unlink(dag, u, v);
      link(dag, u, c);
      link(dag, c, v);
      onStep(cloneDag(dag), { title: `간선 분할 ${u}→${v}`, detail: lastOne ? '남은 노드가 하나라 간선 사이에 노드 하나를 끼워 넣음.' : '복잡도 설정에 따라 갈림길 대신 간선 사이에 노드 하나를 끼워 넣음.', focus: [c] });
      continue;
    }

    const a = `L${serial++}`;
    const b = `L${serial++}`;
    addNode(dag, a);
    addNode(dag, b);
    const extraParents = dag.parents.get(v)!.filter((p) => p !== u);
    const extraChildren = dag.children.get(u)!.filter((c) => c !== v);
    unlink(dag, u, v);
    link(dag, u, a);
    link(dag, u, b);
    link(dag, a, v);
    link(dag, b, v);

    // Degrees are ≤2, so there is at most one X and one Y. If Y can reach X, putting both on
    // the same new node would close a cycle (A→Y→…→X→A), so they go to opposite nodes.
    const x = extraParents[0];
    const y = extraChildren[0];
    let xTarget = rng.chance(0.5) ? a : b;
    let yTarget = rng.chance(0.5) ? a : b;
    if (x && y && reaches(dag, y, x)) yTarget = xTarget === a ? b : a;
    const notes: string[] = [];
    if (x) {
      unlink(dag, x, v);
      link(dag, x, xTarget);
      notes.push(`추가 부모 ${x} → ${xTarget}`);
    } else xTarget = '';
    if (y) {
      unlink(dag, u, y);
      link(dag, yTarget, y);
      notes.push(`추가 자식 ${y} ← ${yTarget}`);
    } else yTarget = '';

    onStep(cloneDag(dag), {
      title: `재작성 ${u}→${v}`,
      detail: `${u}→${v} 사이에 병렬 노드 ${a}, ${b} 삽입.${notes.length ? ' ' + notes.join(', ') + '.' : ''}`,
      focus: [a, b, ...(x ? [x] : []), ...(y ? [y] : [])],
    });
  }
  return dag;
}
