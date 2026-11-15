// Autopilot: plays the level by following the solver's order, proving it is completable.

import { isLocationKind } from '../core/generate';
import type { Vec2 } from '../core/types';
import type { GameRuntime } from './runtime';

export class Autopilot {
  private index = 0;
  private path: Vec2[] | null = null;
  private target: string | null = null;
  private stuck = 0;
  private lastPos: Vec2 = { x: 0, y: 0 };
  current: string | null = null;

  constructor(private readonly rt: GameRuntime) {}

  /** Returns false once nothing is left to do. */
  step(dt: number, sprint = true): boolean {
    const rt = this.rt;
    if (rt.won) return false;
    const order = rt.level.solution;
    while (this.index < order.length && this.isDone(order[this.index])) this.index++;
    if (this.index >= order.length) return false;
    const id = order[this.index];
    this.current = id;
    const n = rt.byId.get(id)!;

    if (this.target !== id || !this.path) {
      this.target = id;
      this.path = rt.findPath(rt.player, this.goalPoint(id));
      if (!this.path) {
        this.index++;
        return true;
      }
    }

    const wp = this.path[0];
    const near = Math.hypot(wp.x - rt.player.x, wp.y - rt.player.y);
    if (near < (this.path.length === 1 ? 0.45 : 0.6)) {
      this.path.shift();
      if (!this.path.length) {
        this.act(id);
        this.path = null;
        // Objects that need an action finish here; the rest complete on proximity.
        if (!this.isDone(id) && !isLocationKind(n.kind)) this.path = [this.goalPoint(id)];
      }
      rt.steer(dt, rt.player, sprint);
      return true;
    }
    rt.steer(dt, wp, sprint);

    if (Math.hypot(rt.player.x - this.lastPos.x, rt.player.y - this.lastPos.y) < 0.02) {
      if (++this.stuck > 40) {
        this.stuck = 0;
        this.path = null;
      }
    } else this.stuck = 0;
    this.lastPos = { x: rt.player.x, y: rt.player.y };
    return true;
  }

  private isDone(id: string) {
    const rt = this.rt;
    const n = rt.byId.get(id)!;
    if (n.kind === 'gate' && n.lock === 'follower') return rt.openGates.has(id);
    return rt.done.has(id);
  }

  private goalPoint(id: string): Vec2 {
    const rt = this.rt;
    const n = rt.byId.get(id)!;
    const w = rt.level.world;
    if (n.kind === 'gate') {
      const d = w.doors[id];
      const s = rt.sideOf(id);
      return { x: d.cx + s.x * 1.2, y: d.cy + s.y * 1.2 };
    }
    if (isLocationKind(n.kind)) return w.objects[id];
    const p = rt.objectPos(id);
    // Stand next to interactables rather than on them.
    if (n.kind === 'switch' || n.kind === 'activator') {
      const dx = rt.player.x - p.x;
      const dy = rt.player.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * 1.1, y: p.y + (dy / d) * 1.1 };
    }
    return { x: p.x, y: p.y };
  }

  private act(id: string) {
    const rt = this.rt;
    const n = rt.byId.get(id)!;
    if (n.kind === 'switch' || (n.kind === 'gate' && n.lock === 'key')) {
      if (rt.prompt?.id === id) rt.interact();
    } else if (n.kind === 'activator' && n.wants) {
      rt.applyAbility(id, n.wants);
    } else if (n.kind === 'gate' && n.lock === 'code' && n.code) {
      rt.submitCode(id, n.code);
    }
  }
}
