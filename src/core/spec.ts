// The dependency graph as an editable spec: location DAG, one gate per location and where each
// prerequisite lives. The random generator and the editor both produce specs; normalizeSpec
// repairs anything that would break solvability and buildDependency expands it into a DepGraph.

import { josa } from './josa';
import { GOAL, START, topoOrder, type LocDag } from './locations';
import { letter, locationColor } from './patterns';
import { hashString, type Rng } from './rng';
import { LOCK_KINDS, type DepEdge, type DepGraph, type DepNode, type DepSpec, type EdgeKind, type GateSpec, type GenParams, type LockKind, type Slot, type Snapshot } from './types';

export const MAX_PARENTS = 2;
export const MAX_SLOTS = 3;
export const hasAux = (lock: LockKind) => lock === 'follower' || lock === 'ability';

export function specDag(spec: DepSpec): LocDag {
  const children = new Map<string, string[]>(spec.locs.map((l) => [l, []]));
  for (const l of spec.locs) for (const p of spec.parents[l] ?? []) children.get(p)?.push(l);
  return { ids: [...spec.locs], parents: new Map(spec.locs.map((l) => [l, [...(spec.parents[l] ?? [])]])), children };
}

function walk(start: string, next: (id: string) => string[]): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...next(n));
  }
  return out;
}

export const ancestorsOrSelf = (spec: DepSpec, id: string) => walk(id, (n) => spec.parents[n] ?? []);

export function descendantsOrSelf(spec: DepSpec, id: string) {
  const dag = specDag(spec);
  return walk(id, (n) => dag.children.get(n) ?? []);
}

/** Locations reachable before `L`'s gate opens: its parents and everything above them. */
export function allowedLocs(spec: DepSpec, L: string): Set<string> {
  const out = new Set<string>();
  for (const p of spec.parents[L] ?? []) for (const a of ancestorsOrSelf(spec, p)) out.add(a);
  return out;
}

/** Slot fields that are hard prerequisites (hints are only information). */
export const hardLocs = (s: Slot) => (s.aux ? [s.loc, s.aux] : [s.loc]);

/** Does some hard prerequisite of `g` sit in `P` or below it? Otherwise the edge P→L is lost. */
export const covers = (spec: DepSpec, g: GateSpec, P: string) => g.slots.some((s) => hardLocs(s).some((x) => ancestorsOrSelf(spec, x).has(P)));

const codeFor = (id: string) => {
  const h = hashString(`code:${id}`);
  return [h % 10, Math.floor(h / 10) % 10, Math.floor(h / 100) % 10];
};

/** Repair a spec so it always builds into a solvable graph. Never mutates the input. */
export function normalizeSpec(input: DepSpec): DepSpec {
  const locs = [...new Set(input.locs)];
  if (!locs.includes(START)) locs.unshift(START);
  if (!locs.includes(GOAL)) locs.push(GOAL);
  const known = new Set(locs);

  const parents: Record<string, string[]> = {};
  for (const l of locs) {
    parents[l] = l === START ? [] : [...new Set(input.parents[l] ?? [])].filter((p) => known.has(p) && p !== l && p !== GOAL).slice(0, MAX_PARENTS);
  }
  // Drop edges until the location graph is acyclic.
  for (;;) {
    const indeg = new Map(locs.map((l) => [l, parents[l].length]));
    const queue = locs.filter((l) => indeg.get(l) === 0);
    const seen = new Set<string>();
    while (queue.length) {
      const n = queue.pop()!;
      seen.add(n);
      for (const c of locs) if (parents[c].includes(n) && indeg.set(c, indeg.get(c)! - 1).get(c) === 0) queue.push(c);
    }
    const stuck = locs.find((l) => !seen.has(l));
    if (!stuck) break;
    parents[stuck] = parents[stuck].filter((p) => seen.has(p));
  }
  for (const l of locs) if (l !== START && !parents[l].length) parents[l] = [START];

  const spec: DepSpec = { locs, parents, gates: {}, hints: !!input.hints };
  for (const L of locs) {
    if (L === START) continue;
    const src = input.gates[L];
    const lock: LockKind = src && LOCK_KINDS.includes(src.lock) ? src.lock : 'key';
    const entrance = src && parents[L].includes(src.entrance) ? src.entrance : parents[L][0];
    const allowed = allowedLocs(spec, L);
    const ok = (x: string | undefined, d: string) => (x && allowed.has(x) ? x : d);
    const raw = (src?.slots ?? []).slice(0, lock === 'key' ? 1 : MAX_SLOTS);
    if (!raw.length) raw.push({ loc: entrance });
    const slots = raw.map((s): Slot => {
      const loc = ok(s.loc, entrance);
      if (!hasAux(lock)) return { loc };
      const aux = ok(s.aux, loc);
      return { loc, aux, hint: ok(s.hint, aux) };
    });
    const g: GateSpec = { lock, entrance, slots };
    if (lock === 'code') g.code = src?.code?.length === 3 && src.code.every((d) => Number.isInteger(d) && d >= 0 && d <= 9) ? [...src.code] : codeFor(L);
    for (const P of parents[L]) if (P !== entrance && !covers(spec, g, P)) slots[0].loc = P;
    spec.gates[L] = g;
  }

  const abilityGates = locs.filter((l) => spec.gates[l]?.lock === 'ability');
  if (abilityGates.length) {
    const blocked = new Set(abilityGates.flatMap((l) => [...descendantsOrSelf(spec, l)]));
    spec.tool = input.tool && known.has(input.tool) && !blocked.has(input.tool) ? input.tool : START;
  }
  return spec;
}

/** Random spec over a generated location DAG: the article's injection step. */
export function randomSpec(dag: LocDag, order: string[], params: GenParams, rng: Rng): DepSpec {
  const parents = Object.fromEntries(dag.ids.map((l) => [l, [...dag.parents.get(l)!]]));
  const spec: DepSpec = { locs: [...dag.ids], parents, gates: {}, hints: params.hints };
  const lockUse = new Map<LockKind, number>();
  let lastLock: LockKind | null = null;
  const cx = params.complexity;

  for (const L of order) {
    if (L === START) continue;
    const ps = parents[L];
    const entrance = rng.pick(ps);

    // Hop distance upward from the gate's parents; remoteness favours far ancestors.
    const dist = new Map<string, number>();
    let frontier = [...ps];
    for (let d = 0; frontier.length; d++) {
      const next: string[] = [];
      for (const f of frontier) {
        if (dist.has(f)) continue;
        dist.set(f, d);
        next.push(...parents[f]);
      }
      frontier = next;
    }
    const avail = [...dist.keys()];
    const pickLoc = () => rng.weighted(avail, (q) => (dist.get(q)! === 0 ? 1 : params.remoteness * 0.9 * Math.pow(0.7, dist.get(q)! - 1)));
    const forced = ps.filter((p) => p !== entrance);
    const nextLoc = () => forced.shift() ?? pickLoc();

    const feasible = (params.mechanics.length ? params.mechanics : (['key'] as LockKind[])).filter(
      (m) => m !== 'ability' || !spec.tool || ps.some((p) => ancestorsOrSelf(spec, p).has(spec.tool!)),
    );
    const lock: LockKind = rng.weighted(feasible.length ? feasible : ['key'], (m) => (m === lastLock ? 0.35 : 1) / (1 + (lockUse.get(m) ?? 0) * 0.45));
    lockUse.set(lock, (lockUse.get(lock) ?? 0) + 1);
    lastLock = lock;

    const two = ps.length > 1;
    const g: GateSpec = { lock, entrance, slots: [] };
    if (lock === 'key') g.slots.push({ loc: nextLoc() });
    else if (lock === 'switch') {
      const n = two || rng.chance(0.3 * cx) ? 2 : 1;
      for (let i = 0; i < n; i++) g.slots.push({ loc: nextLoc() });
    } else if (lock === 'follower' || lock === 'ability') {
      if (lock === 'ability' && !spec.tool) spec.tool = pickLoc();
      const n = two || rng.chance((lock === 'follower' ? 0.4 : 0.35) * cx) ? 2 : 1;
      for (let i = 0; i < n; i++) g.slots.push({ loc: nextLoc(), aux: pickLoc(), hint: pickLoc() });
    } else {
      g.code = [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)];
      const max = 1 + Math.round(2 * cx);
      const n = two ? Math.max(2, rng.int(1, max)) : rng.int(1, max);
      for (let i = 0; i < n; i++) g.slots.push({ loc: nextLoc() });
    }
    spec.gates[L] = g;
  }
  return spec;
}

export interface DepBuild {
  spec: DepSpec;
  graph: DepGraph;
  order: string[];
  labels: Map<string, string>;
  colors: Record<string, string>;
  entrance: Record<string, string>;
  locParents: Record<string, string[]>;
  /** Inject-phase snapshots, without positions. */
  snapshots: Snapshot[];
}

export function locLabels(order: string[]) {
  const label = new Map<string, string>();
  let n = 1;
  for (const id of order) label.set(id, id === START ? '{start}' : id === GOAL ? '{goal}' : String(n++));
  return label;
}

/** Expand a normalized spec into the full dependency graph, one snapshot per gate. */
export function buildDependency(spec: DepSpec): DepBuild {
  const dag = specDag(spec);
  const order = topoOrder(dag);
  const label = locLabels(order);
  const colors: Record<string, string> = {};
  order.forEach((id, i) => (colors[id] = locationColor(i, id === START ? 'start' : id === GOAL ? 'goal' : 'location')));

  const nodes: DepNode[] = [];
  const edges: DepEdge[] = [];
  const entrance: Record<string, string> = {};
  const snapshots: Snapshot[] = [];
  const done = new Set<string>([START]);
  let sym = 0;
  let letters = 0;
  let step = 0;
  let toolPlaced = false;

  const addNode = (n: Omit<DepNode, 'step'>) => {
    const node = { ...n, step } as DepNode;
    nodes.push(node);
    return node;
  };
  const addEdge = (from: string, to: string, kind: EdgeKind) => edges.push({ id: `${kind}:${from}->${to}`, from, to, kind });
  const place = (n: Omit<DepNode, 'step'>, consumer?: [string, EdgeKind]) => {
    addNode(n);
    addEdge(n.loc, n.id, 'in');
    if (consumer) addEdge(n.id, consumer[0], consumer[1]);
    return n.id;
  };
  const newLetter = () => letter(letters++);
  // Snapshot text keeps term tokens; start/goal labels are tokens themselves.
  const locRef = (id: string, pair?: string) => {
    const l = label.get(id)!;
    if (l.startsWith('{')) return pair ? l.replace('}', `:${pair}}`) : l;
    return `{location} ${l}${pair ? josa(l, pair) : ''}`;
  };
  const snapshot = (title: string, detail: string, focus: string[]) => {
    const pathEdges: DepEdge[] = [];
    for (const l of order) if (!done.has(l)) for (const p of spec.parents[l]) pathEdges.push({ id: `path:${p}->${l}`, from: p, to: l, kind: 'path' });
    snapshots.push({ phase: 'inject', title, detail, focus, pos: {}, graph: { nodes: nodes.map((n) => ({ ...n })), edges: [...edges, ...pathEdges] } });
  };

  order.forEach((id, i) => addNode({ id, kind: id === START ? 'start' : id === GOAL ? 'goal' : 'location', loc: id, label: label.get(id)!, order: i }));
  snapshot('{location} DAG 완성', '이제 각 {location:으로/로} 들어가는 관문(장애물)과 그 관문을 여는 데 필요한 것들을 주입한다.', []);

  for (const L of order) {
    if (L === START) continue;
    step++;
    const g = spec.gates[L];
    const E = g.entrance;
    entrance[L] = E;
    const gateSym = sym++;
    const gateLetter = newLetter();
    const gateId = `gate:${L}`;
    const gate = addNode({ id: gateId, kind: 'gate', loc: E, label: gateLetter, sym: gateSym, lock: g.lock, from: E, to: L, gate: gateId });
    addEdge(E, gateId, 'in');
    addEdge(gateId, L, 'unlock');
    const focus: string[] = [L, gateId];
    const many = g.slots.length > 1;
    let detail = '';

    if (g.lock === 'key') {
      const loc = g.slots[0].loc;
      focus.push(place({ id: `key:${L}`, kind: 'key', loc, label: gateLetter, sym: gateSym, gate: gateId }, [gateId, 'item']));
      detail = `{key} ${gateLetter}${josa(gateLetter, '은/는')} ${locRef(loc)}에 숨김. 관문은 ${locRef(E, '과/와')} 맞닿아 있지만 {key:은/는} 멀리 있을 수 있다.`;
    } else if (g.lock === 'switch') {
      g.slots.forEach((s, i) => focus.push(place({ id: `switch:${L}:${i}`, kind: 'switch', loc: s.loc, label: `${gateLetter}${many ? i + 1 : ''}`, sym: gateSym, gate: gateId }, [gateId, 'item'])));
      detail = `{switch} ${g.slots.length}개(${g.slots.map((s) => locRef(s.loc)).join(', ')})를 모두 작동시키면 원격으로 {gate.switch:이/가} 열린다.`;
    } else if (g.lock === 'follower') {
      const ls: string[] = [];
      g.slots.forEach((s, i) => {
        const cLetter = newLetter();
        const fLetter = newLetter();
        ls.push(cLetter);
        const followerId = `follower:${L}:${i}`;
        const lureId = `lure:${L}:${i}`;
        place({ id: followerId, kind: 'follower', loc: s.loc, label: cLetter, sym: sym++, gate: gateId, wants: lureId }, [gateId, 'item']);
        place({ id: lureId, kind: 'lure', loc: s.aux!, label: fLetter, sym: sym++, gate: gateId }, [followerId, 'item']);
        focus.push(followerId, lureId);
        if (spec.hints) focus.push(place({ id: `hint:${followerId}`, kind: 'hint', loc: s.hint!, label: `${fLetter}→${cLetter}`, gate: gateId, hintA: lureId, hintB: followerId }, [followerId, 'knowledge']));
      });
      gate.label = ls.join(' ');
      detail = `{follower} ${ls.join(', ')}${josa(ls[ls.length - 1], '을/를')} 맞는 {lure:으로/로} 유인해 관문까지 데려가야 한다. (A로 B를 유인해 C까지 데려가 D를 연다.)`;
    } else if (g.lock === 'ability') {
      if (!toolPlaced) {
        toolPlaced = true;
        focus.push(place({ id: 'tool', kind: 'tool', loc: spec.tool!, label: '' }));
      }
      const ls: string[] = [];
      g.slots.forEach((s, i) => {
        const sLetter = newLetter();
        const aLetter = newLetter();
        ls.push(sLetter);
        const activatorId = `activator:${L}:${i}`;
        const abilityId = `ability:${L}:${i}`;
        place({ id: activatorId, kind: 'activator', loc: s.loc, label: sLetter, sym: sym++, gate: gateId, wants: abilityId }, [gateId, 'item']);
        addEdge('tool', activatorId, 'item');
        place({ id: abilityId, kind: 'ability', loc: s.aux!, label: aLetter, sym: sym++, gate: gateId }, [activatorId, 'item']);
        focus.push(activatorId, abilityId);
        if (spec.hints) focus.push(place({ id: `hint:${activatorId}`, kind: 'hint', loc: s.hint!, label: `${aLetter}→${sLetter}`, gate: gateId, hintA: abilityId, hintB: activatorId }, [activatorId, 'knowledge']));
      });
      gate.label = ls.join(' ');
      detail = `{activator} ${ls.join(', ')}에서 맞는 {ability:을/를} 사용하면 멀리 있는 {gate.ability:이/가} 열린다.`;
    } else {
      gate.code = [...g.code!];
      const n = g.slots.length;
      g.slots.forEach((s, i) => {
        const reveals = [0, 1, 2].filter((p) => p % n === i);
        focus.push(place({ id: `clue:${L}:${i}`, kind: 'clue', loc: s.loc, label: reveals.map((p) => `${p + 1}`).join(''), sym: gateSym, gate: gateId, reveals }, [gateId, 'item']));
      });
      detail = `세 자리 암호를 {clue} ${n}개에 나눠 숨김. 기억하거나 수첩에서 확인해야 한다.`;
    }
    done.add(L);
    snapshot(`{gate.${g.lock}} → ${locRef(L)}`, detail, focus);
  }

  const locParents = Object.fromEntries(order.map((l) => [l, [...spec.parents[l]]]));
  return { spec, graph: { nodes, edges }, order, labels: label, colors, entrance, locParents, snapshots };
}
