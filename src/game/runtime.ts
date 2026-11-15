// Pure game state for one generated level: movement + collision in 2D, progression rules,
// and per-node status so the dependency graph can light up as the player progresses.

import { Delaunay } from 'd3-delaunay';
import { GOAL, START } from '../core/locations';
import type { DepNode, Level, Seg, Vec2 } from '../core/types';
import { distToSeg } from '../core/world';
import { t } from '../terms';
import { clueText, j, nodeTitle, hintText } from '../ui/text';

export type NodeStatus = 'done' | 'available' | 'locked';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
  at: number;
}

export interface JournalEntry {
  id: string;
  kind: 'clue' | 'hint' | 'ability';
}

export interface Prompt {
  id: string;
  text: string;
  action: 'switch' | 'gate' | 'activator' | 'code' | 'none';
}

export interface FollowerState {
  id: string;
  x: number;
  y: number;
  mode: 'idle' | 'follow' | 'delivered';
  trailIndex: number;
}

const PLAYER_R = 0.35;
const PICKUP_R = 1.5;
const USE_R = 2.4;
const DELIVER_R = 3.6;
const SPEED = 5.2;

export class GameRuntime {
  readonly level: Level;
  readonly byId: Map<string, DepNode>;
  player: Vec2 & { yaw: number };
  region = 0;
  inventory = new Set<string>();
  done = new Set<string>([START]);
  openGates = new Set<string>();
  followers = new Map<string, FollowerState>();
  journal: JournalEntry[] = [];
  toasts: Toast[] = [];
  prompt: Prompt | null = null;
  won = false;
  wonAt = 0;
  elapsed = 0;
  steps = 0;
  /** Open UI requests (ability choice / code entry) that the React layer renders. */
  dialog: { type: 'activator' | 'code'; id: string } | null = null;

  private readonly delaunay: Delaunay<[number, number]>;
  private readonly hardDeps = new Map<string, string[]>();
  private readonly softDeps = new Map<string, string[]>();
  private readonly gateSegs = new Map<string, Seg>();
  private readonly blockers: { x: number; y: number; r: number }[];
  private readonly wallGrid = new Map<string, Seg[]>();
  private trail: Vec2[] = [];
  private toastId = 0;
  private listeners = new Set<() => void>();
  private rev = 0;
  private cellHint = 0;
  private dirty = false;

  constructor(level: Level) {
    this.level = level;
    this.byId = new Map(level.graph.nodes.map((n) => [n.id, n]));
    const w = level.world;
    this.player = { ...w.spawn, yaw: 0 };
    this.delaunay = Delaunay.from(w.cells.map((c) => [c.site.x, c.site.y] as [number, number]));
    for (const n of level.graph.nodes) {
      this.hardDeps.set(n.id, []);
      this.softDeps.set(n.id, []);
    }
    for (const e of level.graph.edges) {
      if (e.kind === 'path') continue;
      (e.kind === 'knowledge' ? this.softDeps : this.hardDeps).get(e.to)!.push(e.from);
    }
    for (const d of Object.values(w.doors)) {
      const ux = Math.cos(d.angle) * (d.width / 2 + 0.05);
      const uy = Math.sin(d.angle) * (d.width / 2 + 0.05);
      this.gateSegs.set(d.gate, { ax: d.cx - ux, ay: d.cy - uy, bx: d.cx + ux, by: d.cy + uy });
    }
    this.blockers = w.trees.filter((t) => t.blocking).map((t) => ({ x: t.x, y: t.y, r: t.r }));
    for (const s of w.walls) this.indexWall(s);
    for (const n of level.graph.nodes) {
      if (n.kind !== 'follower') continue;
      const p = w.objects[n.id];
      this.followers.set(n.id, { id: n.id, x: p.x, y: p.y, mode: 'idle', trailIndex: 0 });
    }
    // Start doesn't need visiting; its own region is entered at spawn.
    this.region = this.regionAt(this.player.x, this.player.y);
  }

  // ---- subscription (React useSyncExternalStore) ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRev = () => this.rev;
  private changed() {
    this.dirty = true;
  }
  /** Flushes change notifications once per frame. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.rev++;
    for (const l of this.listeners) l();
  }

  // ---- geometry ----

  private indexWall(s: Seg) {
    const G = 4;
    const x0 = Math.floor(Math.min(s.ax, s.bx) / G);
    const x1 = Math.floor(Math.max(s.ax, s.bx) / G);
    const y0 = Math.floor(Math.min(s.ay, s.by) / G);
    const y1 = Math.floor(Math.max(s.ay, s.by) / G);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const k = `${gx},${gy}`;
      const list = this.wallGrid.get(k);
      if (list) list.push(s);
      else this.wallGrid.set(k, [s]);
    }
  }

  private nearbyWalls(x: number, y: number): Seg[] {
    const G = 4;
    const gx = Math.floor(x / G);
    const gy = Math.floor(y / G);
    const out: Seg[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = this.wallGrid.get(`${gx + dx},${gy + dy}`);
      if (l) out.push(...l);
    }
    for (const [gate, s] of this.gateSegs) {
      if (this.openGates.has(gate)) continue;
      if (Math.abs((s.ax + s.bx) / 2 - x) < 6 && Math.abs((s.ay + s.by) / 2 - y) < 6) out.push(s);
    }
    return out;
  }

  regionAt(x: number, y: number): number {
    this.cellHint = this.delaunay.find(x, y, this.cellHint);
    return this.level.world.cells[this.cellHint].label;
  }

  cellAt(x: number, y: number): number {
    return this.delaunay.find(x, y);
  }

  /** Moves a circle by (dx, dy), sliding along walls, closed gates and blocking trees. */
  moveCircle(p: Vec2, dx: number, dy: number, r = PLAYER_R) {
    const len = Math.hypot(dx, dy);
    const sub = Math.max(1, Math.ceil(len / (r * 0.8)));
    for (let s = 0; s < sub; s++) {
      p.x += dx / sub;
      p.y += dy / sub;
      for (let it = 0; it < 3; it++) {
        let pushed = false;
        for (const w of this.nearbyWalls(p.x, p.y)) {
          const d = distToSeg(p.x, p.y, w);
          if (d >= r) continue;
          const vx = w.bx - w.ax;
          const vy = w.by - w.ay;
          const l2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((p.x - w.ax) * vx + (p.y - w.ay) * vy) / l2));
          let nx = p.x - (w.ax + vx * t);
          let ny = p.y - (w.ay + vy * t);
          const nl = Math.hypot(nx, ny);
          if (nl < 1e-6) {
            nx = -vy;
            ny = vx;
          }
          const k = (r - d + 1e-3) / (Math.hypot(nx, ny) || 1);
          p.x += nx * k;
          p.y += ny * k;
          pushed = true;
        }
        for (const b of this.blockers) {
          const ex = p.x - b.x;
          const ey = p.y - b.y;
          const d = Math.hypot(ex, ey);
          const min = r + b.r;
          if (d < min && d > 1e-6) {
            p.x += (ex / d) * (min - d);
            p.y += (ey / d) * (min - d);
            pushed = true;
          }
        }
        if (!pushed) break;
      }
    }
  }

  // ---- status ----

  status(id: string): NodeStatus {
    if (this.done.has(id)) return 'done';
    return this.hardDeps.get(id)!.every((d) => this.done.has(d)) ? 'available' : 'locked';
  }

  /** Knowledge prerequisites the player has not yet seen (soft deps). */
  missingKnowledge(id: string): string[] {
    return this.softDeps.get(id)!.filter((d) => !this.done.has(d));
  }

  objectPos(id: string): Vec2 {
    const c = this.followers.get(id);
    if (c) return c;
    return this.level.world.objects[id];
  }

  // ---- events ----

  toast(text: string, tone: Toast['tone'] = 'info') {
    this.toasts = [...this.toasts.slice(-4), { id: ++this.toastId, text, tone, at: performance.now() }];
    this.changed();
  }

  private complete(id: string) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.changed();
    // A remote gate may wait on any prerequisite, including entering its own location.
    this.checkRemoteGates();
  }

  private openGate(id: string, how: string) {
    if (this.openGates.has(id)) return;
    this.openGates.add(id);
    this.complete(id);
    const g = this.byId.get(id)!;
    this.toast(`${how} → ${j(nodeTitle(this.byId.get(g.to!)!), '으로/로')} 가는 길이 열렸다`, 'good');
  }

  private checkRemoteGates() {
    for (const g of this.level.graph.nodes) {
      if (g.kind !== 'gate' || this.openGates.has(g.id)) continue;
      const deps = this.hardDeps.get(g.id)!;
      if (g.lock === 'switch' && deps.every((d) => this.done.has(d))) this.openGate(g.id, `${j(t('switch'), '이/가')} 모두 작동해 ${j(nodeTitle(g), '이/가')} 열렸다`);
      if (g.lock === 'ability' && deps.every((d) => this.done.has(d))) this.openGate(g.id, `모든 ${j(t('activator'), '이/가')} 반응해 ${j(nodeTitle(g), '이/가')} 열렸다`);
      if (g.lock === 'follower') {
        const cs = deps.filter((d) => d.startsWith('follower:'));
        if (cs.every((c) => this.followers.get(c)!.mode === 'delivered')) this.openGate(g.id, `${j(t('follower'), '이/가')} 모두 도착해 ${j(nodeTitle(g), '이/가')} 열렸다`);
      }
    }
  }

  // ---- interactions ----

  /** Performs the prompted action (E key). */
  interact() {
    if (this.won) return;
    const p = this.prompt;
    if (!p) return;
    const n = this.byId.get(p.id)!;
    if (p.action === 'switch') {
      this.complete(n.id);
      this.toast(`${j(nodeTitle(n), '을/를')} 작동시켰다`, 'good');
      this.checkRemoteGates();
    } else if (p.action === 'gate' && n.lock === 'key') {
      if (this.inventory.has(`key:${n.to}`)) {
        this.inventory.delete(`key:${n.to}`);
        this.openGate(n.id, `${j(t('key') + ' ' + n.label, '으로/로')} ${j(nodeTitle(n), '을/를')} 열었다`);
      } else this.toast(`맞는 ${j(t('key'), '이/가')} 없다. 같은 무늬의 ${j(t('key'), '을/를')} 찾아보자`, 'bad');
    } else if (p.action === 'code') {
      this.dialog = { type: 'code', id: n.id };
      this.changed();
    } else if (p.action === 'activator') {
      if (!this.inventory.has('tool')) this.toast(`${t('activator')}에서 ${j(t('ability'), '을/를')} 쓰려면 ${j(t('tool'), '이/가')} 필요하다`, 'bad');
      else {
        this.dialog = { type: 'activator', id: n.id };
        this.changed();
      }
    } else if (p.action === 'none') {
      this.toast(p.text, 'info');
    }
  }

  closeDialog() {
    this.dialog = null;
    this.changed();
  }

  applyAbility(activatorId: string, abilityId: string) {
    const activator = this.byId.get(activatorId)!;
    this.dialog = null;
    if (activator.wants === abilityId) {
      this.complete(activatorId);
      this.toast(`${j(nodeTitle(activator), '이/가')} 반응했다`, 'good');
      this.checkRemoteGates();
    } else {
      this.toast(`${j(nodeTitle(activator), '이/가')} 아무 반응도 없다…`, 'bad');
      this.changed();
    }
  }

  submitCode(gateId: string, digits: number[]) {
    const g = this.byId.get(gateId)!;
    if (g.code && digits.join('') === g.code.join('')) {
      this.dialog = null;
      this.openGate(gateId, `${j(`암호 ${digits.join('')}`, '이/가')} 맞았다`);
      return true;
    }
    this.toast(`${j(nodeTitle(g), '이/가')} 열리지 않는다`, 'bad');
    return false;
  }

  knownAbilities(): DepNode[] {
    return [...this.inventory].filter((i) => i.startsWith('ability:')).map((i) => this.byId.get(i)!);
  }

  // ---- per-frame ----

  /** move: local (forward, right) in [-1,1]; yaw in radians (0 = facing +y in world). */
  update(dt: number, move: { f: number; r: number; sprint: boolean }, yaw: number) {
    this.player.yaw = yaw;
    if (!this.won) this.elapsed += dt;
    if (!this.won && !this.dialog) {
      const len = Math.hypot(move.f, move.r);
      if (len > 0.01) {
        const s = (SPEED * (move.sprint ? 1.8 : 1) * dt) / Math.max(1, len);
        const fx = Math.sin(yaw);
        const fy = Math.cos(yaw);
        // Right-hand side in a world where +x is east and +y is north (seen from above).
        const rx = Math.cos(yaw);
        const ry = -Math.sin(yaw);
        this.moveCircle(this.player, (fx * move.f + rx * move.r) * s, (fy * move.f + ry * move.r) * s);
        this.steps += len * dt;
      }
    }
    this.tick(dt);
  }

  /** Teleport-free movement towards a point (used by the autopilot). */
  steer(dt: number, target: Vec2, sprint: boolean) {
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-3) {
      const yaw = Math.atan2(dx, dy);
      let dyaw = yaw - this.player.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.player.yaw += dyaw * Math.min(1, dt * 10);
      const s = Math.min(d, SPEED * (sprint ? 1.8 : 1) * dt);
      this.moveCircle(this.player, (dx / d) * s, (dy / d) * s);
    }
    if (!this.won) this.elapsed += dt;
    this.tick(dt);
  }

  private tick(dt: number) {
    const w = this.level.world;
    const { x, y } = this.player;

    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 0.5) {
      this.trail.push({ x, y });
      if (this.trail.length > 400) {
        this.trail.splice(0, 100);
        for (const c of this.followers.values()) c.trailIndex = Math.max(0, c.trailIndex - 100);
      }
    }

    const r = this.regionAt(x, y);
    if (r !== this.region) {
      this.region = r;
      this.changed();
    }
    if (r >= 0) {
      const locId = w.locIds[r];
      if (!this.done.has(locId)) {
        this.complete(locId);
        const n = this.byId.get(locId)!;
        if (locId === GOAL) {
          this.won = true;
          this.wonAt = performance.now();
          this.toast(`${t('goal')}에 도달했다! 클리어!`, 'good');
        } else this.toast(`${nodeTitle(n)}에 들어왔다`, 'info');
      }
    }

    // Auto pickups
    for (const n of this.level.graph.nodes) {
      if (this.done.has(n.id)) continue;
      if (!['key', 'lure', 'tool', 'ability', 'clue', 'hint'].includes(n.kind)) continue;
      const p = w.objects[n.id];
      if (Math.hypot(p.x - x, p.y - y) > PICKUP_R) continue;
      this.complete(n.id);
      this.inventory.add(n.id);
      if (n.kind === 'key' || n.kind === 'lure') this.toast(`${j(nodeTitle(n), '을/를')} 얻었다`, 'good');
      if (n.kind === 'tool') this.toast(`${j(t('tool'), '을/를')} 얻었다! 이제 ${t('activator')}에서 ${j(t('ability'), '을/를')} 쓸 수 있다`, 'good');
      if (n.kind === 'ability') {
        this.toast(`${j(nodeTitle(n), '을/를')} 습득했다`, 'good');
        this.journal.push({ id: n.id, kind: 'ability' });
      }
      if (n.kind === 'clue') {
        this.toast(`${t('clue')} → ${clueText(n, this.byId)}`, 'good');
        this.journal.push({ id: n.id, kind: 'clue' });
      }
      if (n.kind === 'hint') {
        this.toast(`${t('hint')}: ${hintText(n, this.byId)}`, 'info');
        this.journal.push({ id: n.id, kind: 'hint' });
      }
    }

    // Followers: lured by their lure item, follow the player's trail, sit down at their gate.
    for (const c of this.followers.values()) {
      const n = this.byId.get(c.id)!;
      if (c.mode === 'idle') {
        if (Math.hypot(c.x - x, c.y - y) < 2.6 && n.wants && this.inventory.has(n.wants)) {
          this.inventory.delete(n.wants);
          c.mode = 'follow';
          c.trailIndex = Math.max(0, this.trail.length - 1);
          this.complete(c.id);
          this.toast(`${j(nodeTitle(n), '이/가')} 따라온다`, 'good');
        }
      } else if (c.mode === 'follow') {
        // Walk the player's breadcrumb trail (so doors are respected) until close enough.
        const followers = [...this.followers.values()].filter((o) => o.mode === 'follow');
        const myDoor = w.doors[n.gate!];
        const atMyDoor = Math.hypot(myDoor.cx - x, myDoor.cy - y) < 4.5;
        const keep = atMyDoor ? 0.4 : 1.1 + followers.indexOf(c) * 0.7;
        let budget = 8.5 * dt;
        while (budget > 0 && Math.hypot(x - c.x, y - c.y) > keep && c.trailIndex < this.trail.length) {
          const t = this.trail[c.trailIndex];
          const dx = t.x - c.x;
          const dy = t.y - c.y;
          const d = Math.hypot(dx, dy);
          if (d <= budget) {
            c.x = t.x;
            c.y = t.y;
            c.trailIndex++;
            budget -= d;
          } else {
            c.x += (dx / d) * budget;
            c.y += (dy / d) * budget;
            budget = 0;
          }
        }
        const door = w.doors[n.gate!];
        if (Math.hypot(door.cx - c.x, door.cy - c.y) < DELIVER_R) {
          c.mode = 'delivered';
          const off = this.level.graph.nodes.filter((m) => m.gate === n.gate && m.kind === 'follower').findIndex((m) => m.id === c.id);
          const side = this.sideOf(n.gate!);
          const ux = Math.cos(door.angle);
          const uy = Math.sin(door.angle);
          c.x = door.cx + side.x * 1.1 + ux * (off ? 1.8 : -1.8);
          c.y = door.cy + side.y * 1.1 + uy * (off ? 1.8 : -1.8);
          this.toast(`${j(nodeTitle(n), '이/가')} 관문 앞에 도착했다`, 'good');
          this.checkRemoteGates();
          this.changed();
        }
      }
    }

    // Key doors open on touch when the key is carried.
    for (const g of this.level.graph.nodes) {
      if (g.kind !== 'gate' || g.lock !== 'key' || this.openGates.has(g.id)) continue;
      const d = w.doors[g.id];
      if (Math.hypot(d.cx - x, d.cy - y) < 1.8 && this.inventory.has(`key:${g.to}`)) {
        this.inventory.delete(`key:${g.to}`);
        this.openGate(g.id, `${j(t('key') + ' ' + g.label, '으로/로')} ${j(nodeTitle(g), '을/를')} 열었다`);
      }
    }

    this.updatePrompt();
  }

  /** Unit vector from a door towards the side the gate stands in (its entrance location). */
  sideOf(gateId: string): Vec2 {
    const d = this.level.world.doors[gateId];
    const s = this.level.world.cells[d.cellFrom].site;
    const nx = -Math.sin(d.angle);
    const ny = Math.cos(d.angle);
    const dot = (s.x - d.cx) * nx + (s.y - d.cy) * ny;
    return dot >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
  }

  private updatePrompt() {
    const w = this.level.world;
    const { x, y } = this.player;
    let best: Prompt | null = null;
    let bestD = USE_R;
    const consider = (id: string, p: Vec2, prompt: Omit<Prompt, 'id'>, range = USE_R) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < range && d < bestD) {
        bestD = d;
        best = { id, ...prompt };
      }
    };
    for (const n of this.level.graph.nodes) {
      if (n.kind === 'switch' && !this.done.has(n.id)) consider(n.id, w.objects[n.id], { text: `${nodeTitle(n)} 작동`, action: 'switch' });
      if (n.kind === 'activator' && !this.done.has(n.id)) consider(n.id, w.objects[n.id], { text: `${nodeTitle(n)}에서 ${t('ability')} 사용`, action: 'activator' });
      if (n.kind === 'gate' && !this.openGates.has(n.id)) {
        const d = w.doors[n.id];
        const p = { x: d.cx, y: d.cy };
        if (n.lock === 'code') consider(n.id, p, { text: `${nodeTitle(n)}에 암호 입력`, action: 'code' }, 3);
        else if (n.lock === 'key') consider(n.id, p, { text: `${nodeTitle(n)}: 같은 무늬 ${t('key')} 필요`, action: 'gate' }, 3);
        else if (n.lock === 'switch') consider(n.id, p, { text: `${nodeTitle(n)}: 같은 무늬 ${j(t('switch'), '을/를')} 모두 작동시켜야 함`, action: 'none' }, 3);
        else if (n.lock === 'ability') consider(n.id, p, { text: `${nodeTitle(n)}: 같은 무늬 ${t('activator')}에서 ${j(t('ability'), '을/를')} 써야 함`, action: 'none' }, 3);
        else if (n.lock === 'follower') consider(n.id, p, { text: `${nodeTitle(n)}: 같은 무늬 ${j(t('follower'), '을/를')} 데려와야 함`, action: 'none' }, 3);
      }
      if (n.kind === 'follower') {
        const c = this.followers.get(n.id)!;
        if (c.mode === 'idle' && !(n.wants && this.inventory.has(n.wants))) consider(n.id, c, { text: `${nodeTitle(n)}: 맞는 ${j(t('lure'), '이/가')} 있으면 따라온다`, action: 'none' }, 2.6);
      }
    }
    const prev = this.prompt;
    if (prev?.id !== (best as Prompt | null)?.id || prev?.text !== (best as Prompt | null)?.text) {
      this.prompt = best;
      this.changed();
    }
  }

  /** Walkable path through the cell graph (honours closed gates); returns waypoints. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const w = this.level.world;
    const a = this.cellAt(from.x, from.y);
    const b = this.cellAt(to.x, to.y);
    if (a === b) return [to];
    const doorPairs = new Map<string, string>();
    for (const d of Object.values(w.doors)) doorPairs.set(`${Math.min(d.cellFrom, d.cellTo)}:${Math.max(d.cellFrom, d.cellTo)}`, d.gate);
    const treeCells = new Set(this.blockers.map((t) => this.cellAt(t.x, t.y)));
    const cost = new Float64Array(w.cells.length).fill(Infinity);
    const prev = new Int32Array(w.cells.length).fill(-1);
    cost[a] = 0;
    // Small graph (a few thousand cells): binary heap is overkill, a sorted frontier suffices.
    const open: number[] = [a];
    const inOpen = new Uint8Array(w.cells.length);
    inOpen[a] = 1;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
      const i = open[bi];
      open.splice(bi, 1);
      inOpen[i] = 0;
      if (i === b) break;
      const li = w.cells[i].label;
      for (const j of w.neighbors[i]) {
        const lj = w.cells[j].label;
        if (lj < 0) continue;
        if (li !== lj) {
          const gate = doorPairs.get(`${Math.min(i, j)}:${Math.max(i, j)}`);
          if (!gate || !this.openGates.has(gate)) continue;
        } else if (!this.edgeMid(i, j, 1.1)) continue;
        const si = w.cells[i].site;
        const sj = w.cells[j].site;
        const c = cost[i] + Math.hypot(si.x - sj.x, si.y - sj.y) + (treeCells.has(j) && j !== b ? 6 : 0);
        if (c < cost[j]) {
          cost[j] = c;
          prev[j] = i;
          if (!inOpen[j]) {
            open.push(j);
            inOpen[j] = 1;
          }
        }
      }
    }
    if (prev[b] < 0) return null;
    const cells: number[] = [];
    for (let c = b; c !== -1; c = prev[c]) cells.unshift(c);
    const pts: Vec2[] = [];
    for (let k = 1; k < cells.length; k++) {
      const m = this.edgeMid(cells[k - 1], cells[k], 0) ?? w.cells[cells[k]].site;
      pts.push(m);
      if (k < cells.length - 1 && !treeCells.has(cells[k])) pts.push(w.cells[cells[k]].site);
    }
    pts.push(to);
    return pts;
  }

  private edgeMid(i: number, j: number, minLen: number): Vec2 | null {
    const A = this.level.world.cells[i].poly;
    const B = this.level.world.cells[j].poly;
    const hits: [number, number][] = [];
    for (const p of A) for (const q of B) {
      if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6 && !hits.some((h) => h[0] === p[0] && h[1] === p[1])) hits.push(p);
    }
    if (hits.length < 2) return null;
    if (Math.hypot(hits[1][0] - hits[0][0], hits[1][1] - hits[0][1]) < minLen) return null;
    return { x: (hits[0][0] + hits[1][0]) / 2, y: (hits[0][1] + hits[1][1]) / 2 };
  }
}
