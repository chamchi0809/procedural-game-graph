// Editing operations on a dependency spec. Each returns a new normalized spec or throws an
// EditError whose message is shown to the user.

import { GOAL, START } from './locations';
import { allowedLocs, ancestorsOrSelf, covers, descendantsOrSelf, hasAux, MAX_PARENTS, MAX_SLOTS, normalizeSpec, specDag } from './spec';
import type { DepSpec, LockKind, Slot } from './types';

export class EditError extends Error {}

const clone = (s: DepSpec): DepSpec => structuredClone(s);

function newLocId(spec: DepSpec) {
  const n = Math.max(-1, ...spec.locs.map((l) => Number(l.match(/^L(\d+)$/)?.[1] ?? -1)));
  return `L${n + 1}`;
}

export function blankSpec(hints: boolean): DepSpec {
  return normalizeSpec({ locs: [START, GOAL], parents: { [GOAL]: [START] }, gates: { [GOAL]: { lock: 'key', entrance: START, slots: [{ loc: START }] } }, hints });
}

/** New location right after `L`; `L`'s children now hang off the new one. */
export function insertAfter(spec: DepSpec, L: string): { spec: DepSpec; id: string } {
  if (L === GOAL) throw new EditError('목표 뒤에는 장소를 둘 수 없습니다');
  const s = clone(spec);
  const X = newLocId(s);
  for (const c of s.locs) {
    if (!s.parents[c].includes(L)) continue;
    s.parents[c] = s.parents[c].map((p) => (p === L ? X : p));
    if (s.gates[c].entrance === L) s.gates[c].entrance = X;
  }
  s.locs.push(X);
  s.parents[X] = [L];
  s.gates[X] = { lock: 'key', entrance: L, slots: [{ loc: L }] };
  return { spec: normalizeSpec(s), id: X };
}

/** New location branching off `L` and rejoining at one of `L`'s children when it has room. */
export function addBranch(spec: DepSpec, L: string): { spec: DepSpec; id: string } {
  if (L === GOAL) throw new EditError('목표에서는 갈래를 낼 수 없습니다');
  const s = clone(spec);
  const X = newLocId(s);
  s.locs.push(X);
  s.parents[X] = [L];
  s.gates[X] = { lock: 'key', entrance: L, slots: [{ loc: L }] };
  const join = s.locs.find((c) => s.parents[c].includes(L) && s.parents[c].length < MAX_PARENTS);
  if (join) s.parents[join].push(X);
  return { spec: normalizeSpec(s), id: X };
}

/** Make `B` depend on `A`. */
export function connect(spec: DepSpec, A: string, B: string): DepSpec {
  if (A === B) throw new EditError('같은 장소끼리는 연결할 수 없습니다');
  if (B === START) throw new EditError('시작 장소 앞에는 아무것도 둘 수 없습니다');
  if (A === GOAL) throw new EditError('목표 뒤에는 아무것도 둘 수 없습니다');
  if (spec.parents[B].includes(A)) throw new EditError('이미 연결되어 있습니다');
  if (spec.parents[B].length >= MAX_PARENTS) throw new EditError(`한 장소의 선행 장소는 최대 ${MAX_PARENTS}개입니다`);
  if (ancestorsOrSelf(spec, A).has(B)) throw new EditError('순환이 생겨서 연결할 수 없습니다');
  const s = clone(spec);
  s.parents[B].push(A);
  return normalizeSpec(s);
}

export function disconnect(spec: DepSpec, A: string, B: string): DepSpec {
  if (spec.parents[B].length <= 1) throw new EditError('마지막 선행 장소는 끊을 수 없습니다. 먼저 다른 장소를 연결하세요');
  const s = clone(spec);
  s.parents[B] = s.parents[B].filter((p) => p !== A);
  return normalizeSpec(s);
}

/** Remove `L`, handing its children to its own parents. */
export function removeLocation(spec: DepSpec, L: string): DepSpec {
  if (L === START || L === GOAL) throw new EditError('시작과 목표는 지울 수 없습니다');
  const s = clone(spec);
  const up = s.parents[L];
  for (const c of s.locs) {
    if (!s.parents[c].includes(L)) continue;
    s.parents[c] = [...new Set(s.parents[c].flatMap((p) => (p === L ? up : [p])))].slice(0, MAX_PARENTS);
    if (s.gates[c].entrance === L) s.gates[c].entrance = s.parents[c][0];
  }
  s.locs = s.locs.filter((l) => l !== L);
  delete s.parents[L];
  delete s.gates[L];
  return normalizeSpec(s);
}

export function setLock(spec: DepSpec, L: string, lock: LockKind): DepSpec {
  const s = clone(spec);
  const g = s.gates[L];
  g.lock = lock;
  g.slots = g.slots.map((x) => ({ loc: x.loc, aux: x.aux ?? x.loc, hint: x.hint ?? x.aux ?? x.loc }));
  return normalizeSpec(s);
}

export function setSlotCount(spec: DepSpec, L: string, n: number): DepSpec {
  const s = clone(spec);
  const g = s.gates[L];
  const count = Math.max(1, Math.min(g.lock === 'key' ? 1 : MAX_SLOTS, n));
  while (g.slots.length < count) g.slots.push({ ...g.slots[g.slots.length - 1] });
  g.slots = g.slots.slice(0, count);
  return normalizeSpec(s);
}

export function setEntrance(spec: DepSpec, L: string, P: string): DepSpec {
  if (!spec.parents[L].includes(P)) throw new EditError('관문은 선행 장소 중 한 곳에만 둘 수 있습니다');
  const s = clone(spec);
  s.gates[L].entrance = P;
  return normalizeSpec(s);
}

export function setHints(spec: DepSpec, hints: boolean): DepSpec {
  return { ...spec, hints };
}

type PieceRef = { tool: true } | { tool?: false; gate: string; index: number; field: keyof Slot };

/** Which spec field a graph node's location comes from. */
export function pieceRef(id: string): PieceRef | null {
  if (id === 'tool') return { tool: true };
  const hint = id.match(/^hint:(follower|activator):([^:]+):(\d+)$/);
  if (hint) return { gate: hint[2], index: Number(hint[3]), field: 'hint' };
  const m = id.match(/^(key|switch|clue|follower|lure|activator|ability):([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { gate: m[2], index: Number(m[3] ?? 0), field: m[1] === 'lure' || m[1] === 'ability' ? 'aux' : 'loc' };
}

/** Locations a piece may move to without creating a cycle or dropping a location dependency. */
export function pieceTargets(spec: DepSpec, id: string): string[] {
  const ref = pieceRef(id);
  if (!ref) return [];
  if (ref.tool) {
    const blocked = new Set(spec.locs.filter((l) => spec.gates[l]?.lock === 'ability').flatMap((l) => [...descendantsOrSelf(spec, l)]));
    return spec.locs.filter((l) => !blocked.has(l));
  }
  const L = ref.gate;
  const g = spec.gates[L];
  let allowed = [...allowedLocs(spec, L)];
  if (ref.field !== 'hint') {
    // If this piece is the only thing tying L to a second parent, it must stay below that parent.
    for (const P of spec.parents[L]) {
      if (P === g.entrance) continue;
      const without = { ...g, slots: g.slots.map((s, i) => (i === ref.index ? { ...s, [ref.field]: g.entrance } : s)) };
      if (!covers(spec, without, P)) allowed = allowed.filter((x) => ancestorsOrSelf(spec, x).has(P));
    }
  }
  const order = specDag(spec).ids;
  return order.filter((l) => allowed.includes(l));
}

export function movePiece(spec: DepSpec, id: string, loc: string): DepSpec {
  if (!pieceTargets(spec, id).includes(loc)) throw new EditError('그 장소로는 옮길 수 없습니다 (의존성이 깨집니다)');
  const ref = pieceRef(id)!;
  const s = clone(spec);
  if (ref.tool) s.tool = loc;
  else {
    const slot = s.gates[ref.gate].slots[ref.index];
    slot[ref.field] = loc;
    if (!hasAux(s.gates[ref.gate].lock)) delete slot.aux;
  }
  return normalizeSpec(s);
}
