export type LockKind = 'key' | 'switch' | 'follower' | 'ability' | 'code';

export type NodeKind =
  | 'start'
  | 'location'
  | 'goal'
  | 'gate'
  | 'key'
  | 'switch'
  | 'lure'
  | 'follower'
  | 'hint'
  | 'tool'
  | 'ability'
  | 'activator'
  | 'clue';

/**
 * Edge `from → to` means `to` depends on `from`.
 * - path: location-level DAG edge (only in rewrite-phase snapshots)
 * - in: object is physically inside the `from` location
 * - unlock: opening a gate grants access to a location
 * - item: a hard prerequisite (key, switch, follower, activator, clue…)
 * - knowledge: information that tells the player what to do (soft)
 */
export type EdgeKind = 'path' | 'in' | 'unlock' | 'item' | 'knowledge';

export interface DepNode {
  id: string;
  kind: NodeKind;
  /** Location the object physically sits in (a location's own id for locations). */
  loc: string;
  label: string;
  /** Visual identity pattern; shared by e.g. a key and its gate. */
  sym?: number;
  lock?: LockKind;
  /** Gate this object ultimately serves. */
  gate?: string;
  /** Gate: location it stands in and location it opens. */
  from?: string;
  to?: string;
  /** Hint: a → b (lure → follower, ability → activator). */
  hintA?: string;
  hintB?: string;
  /** Follower: lure that attracts it. Activator: ability it answers to. */
  wants?: string;
  /** Code gate: digits. Clue: which digit positions it reveals. */
  code?: number[];
  reveals?: number[];
  /** Location topological order. */
  order?: number;
  step: number;
}

export interface DepEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface DepGraph {
  nodes: DepNode[];
  edges: DepEdge[];
}

export type Vec2 = { x: number; y: number };

export interface Snapshot {
  phase: 'rewrite' | 'inject' | 'final';
  title: string;
  detail: string;
  graph: DepGraph;
  focus: string[];
  pos: Record<string, Vec2>;
}

export interface GenParams {
  seed: string;
  locations: number;
  mechanics: LockKind[];
  /** 0..1 probability of hiding prerequisites in more distant ancestor locations. */
  remoteness: number;
  /** 0..1: 0 = linear chain of locations with one item per gate, 1 = full branching rewrite. */
  complexity: number;
  hints: boolean;
}

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Cell {
  site: Vec2;
  poly: [number, number][];
  /** Index into World.locIds, or -1 for impassable forest. */
  label: number;
}

export interface Door {
  gate: string;
  from: string;
  to: string;
  cx: number;
  cy: number;
  /** Direction along the wall. */
  angle: number;
  width: number;
  cellFrom: number;
  cellTo: number;
}

export interface Tree {
  x: number;
  y: number;
  r: number;
  scale: number;
  blocking: boolean;
}

export interface World {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cells: Cell[];
  neighbors: number[][];
  locIds: string[];
  walls: Seg[];
  doors: Record<string, Door>;
  objects: Record<string, Vec2>;
  trees: Tree[];
  spawn: Vec2;
  cellSize: number;
}

/** Where one prerequisite set lives. follower: loc = follower, aux = lure. ability: loc = activator, aux = ability. */
export interface Slot {
  loc: string;
  aux?: string;
  hint?: string;
}

export interface GateSpec {
  lock: LockKind;
  /** Parent location the gate stands in. */
  entrance: string;
  slots: Slot[];
  code?: number[];
}

/** Editable description of a dependency graph; buildDependency expands it into nodes and edges. */
export interface DepSpec {
  locs: string[];
  parents: Record<string, string[]>;
  gates: Record<string, GateSpec>;
  /** Location of the shared ability tool, when any gate uses ability. */
  tool?: string;
  hints: boolean;
}

/** Hand-placed spatial positions. `fixed` ids don't move during relaxation. */
export interface SpatialLayout {
  pos: Record<string, Vec2>;
  fixed: string[];
}

export interface Level {
  params: GenParams;
  spec: DepSpec;
  /** True when the dependency graph came from the editor rather than the generator. */
  edited: boolean;
  spatialSeed: string;
  graph: DepGraph;
  snapshots: Snapshot[];
  locations: string[];
  locParents: Record<string, string[]>;
  entrance: Record<string, string>;
  colors: Record<string, string>;
  spatial: Record<string, Vec2>;
  world: World;
  solution: string[];
  attempts: number;
  stats: { nodes: number; edges: number; branching: number; maxDepth: number; ms: number };
}

export const LOCK_KINDS: LockKind[] = ['key', 'switch', 'follower', 'ability', 'code'];
