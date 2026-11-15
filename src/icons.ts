// Canvas-drawn iconography shared by the graph (as data URLs) and the 3D world (as textures).
// Patterned fills carry identity: a key and its gate share the same pattern.

import { symStyle, type PatternKind } from './core/patterns';
import type { DepNode } from './core/types';

export type IconKind =
  | 'flag'
  | 'goal'
  | 'door'
  | 'barrier'
  | 'followdoor'
  | 'seal'
  | 'dial'
  | 'key'
  | 'switch'
  | 'bolt'
  | 'lure'
  | 'follower'
  | 'info'
  | 'tool'
  | 'ability'
  | 'activator'
  | 'tablet'
  | 'spark';

const INK = '#1d1b19';
const cache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

function applyPattern(ctx: CanvasRenderingContext2D, kind: PatternKind, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  switch (kind) {
    case 'stripes':
      for (let i = -64; i < 128; i += 12) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 64, 64);
        ctx.stroke();
      }
      break;
    case 'dots':
      for (let y = 4; y < 64; y += 11) for (let x = (y / 11) % 2 ? 9 : 4; x < 64; x += 11) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'zigzag':
      for (let y = 6; y < 64; y += 12) {
        ctx.beginPath();
        for (let x = 0; x <= 64; x += 8) ctx.lineTo(x, y + ((x / 8) % 2 ? 4 : -4));
        ctx.stroke();
      }
      break;
    case 'checker':
      for (let y = 0; y < 64; y += 9) for (let x = (y / 9) % 2 ? 9 : 0; x < 64; x += 18) ctx.fillRect(x, y, 9, 9);
      break;
    case 'diamonds':
      for (let y = 0; y < 72; y += 14) for (let x = (y / 14) % 2 ? 7 : 0; x < 72; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.fill();
      }
      break;
    case 'waves':
      for (let y = 4; y < 70; y += 11) {
        ctx.beginPath();
        for (let x = 0; x <= 64; x += 2) ctx.lineTo(x, y + Math.sin(x / 5) * 3);
        ctx.stroke();
      }
      break;
    case 'cross':
      ctx.lineWidth = 3;
      for (let i = -64; i < 128; i += 14) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 64, 64);
        ctx.moveTo(i + 64, 0);
        ctx.lineTo(i, 64);
        ctx.stroke();
      }
      break;
    case 'rings':
      ctx.lineWidth = 3;
      for (let r = 4; r < 60; r += 9) {
        ctx.beginPath();
        ctx.arc(32, 32, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

/** Fills `path` with the sym's identity pattern (or a flat color) and inks the outline. */
function fillShape(ctx: CanvasRenderingContext2D, path: Path2D, sym: number | undefined, flat = '#f4f1ea', lw = 3.2) {
  if (sym === undefined) {
    ctx.fillStyle = flat;
    ctx.fill(path);
  } else {
    const st = symStyle(sym);
    ctx.fillStyle = st.base;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    applyPattern(ctx, st.pattern, st.accent);
    ctx.restore();
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

function archPath(x: number, y: number, w: number, h: number) {
  const p = new Path2D();
  p.moveTo(x, y + h);
  p.lineTo(x, y + w / 2);
  p.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  p.lineTo(x + w, y + h);
  p.closePath();
  return p;
}

function blobPath(cx: number, cy: number, r: number) {
  const p = new Path2D();
  p.moveTo(cx - r, cy + r * 0.55);
  p.bezierCurveTo(cx - r * 1.1, cy - r * 0.6, cx - r * 0.5, cy - r, cx, cy - r);
  p.bezierCurveTo(cx + r * 0.5, cy - r, cx + r * 1.1, cy - r * 0.6, cx + r, cy + r * 0.55);
  p.quadraticCurveTo(cx, cy + r * 0.95, cx - r, cy + r * 0.55);
  p.closePath();
  return p;
}

function blobEyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy, r * 0.13, r * 0.19, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.35, cy, r * 0.13, r * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
}

function starPath(cx: number, cy: number, r: number, inner: number) {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const d = i % 2 ? inner : r;
    if (i) p.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    else p.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  p.closePath();
  return p;
}

function drawBase(ctx: CanvasRenderingContext2D, kind: IconKind, sym: number | undefined, text?: string) {
  switch (kind) {
    case 'flag':
    case 'goal': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(18, 8);
      ctx.lineTo(18, 58);
      ctx.stroke();
      const f = new Path2D();
      f.moveTo(20, 9);
      f.lineTo(52, 18);
      f.lineTo(20, 30);
      f.closePath();
      fillShape(ctx, f, sym, kind === 'goal' ? '#ffc93c' : '#7cc77f');
      if (kind === 'goal') {
        const star = new Path2D();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 4.5 : 10;
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          star.lineTo(44 + Math.cos(a) * r, 46 + Math.sin(a) * r);
        }
        star.closePath();
        fillShape(ctx, star, undefined, '#ffe27a', 2.5);
      }
      break;
    }
    case 'door':
    case 'followdoor':
    case 'seal':
    case 'dial': {
      const arch = archPath(12, 8, 40, 50);
      fillShape(ctx, arch, sym, '#c9b9a6');
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(32, 9);
      ctx.lineTo(32, 58);
      ctx.stroke();
      const badge = (draw: () => void) => {
        ctx.fillStyle = '#fbf8f1';
        ctx.beginPath();
        ctx.arc(32, 38, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.stroke();
        draw();
      };
      if (kind === 'followdoor') badge(() => {
        fillShape(ctx, blobPath(32, 38, 7), undefined, '#f4f1ea', 2);
        blobEyes(ctx, 32, 38, 7);
      });
      if (kind === 'seal') badge(() => fillShape(ctx, starPath(32, 38, 8, 3), undefined, INK, 1));
      if (kind === 'dial') badge(() => {
        ctx.beginPath();
        ctx.moveTo(32, 38);
        ctx.lineTo(37, 31);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.fillStyle = INK;
          ctx.fillRect(32 + Math.cos(a) * 8 - 1, 38 + Math.sin(a) * 8 - 1, 2, 2);
        }
      });
      break;
    }
    case 'barrier': {
      ctx.fillStyle = '#8b8378';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      for (const x of [9, 47]) {
        ctx.fillRect(x, 8, 8, 50);
        ctx.strokeRect(x, 8, 8, 50);
      }
      const b = new Path2D();
      b.moveTo(36, 12);
      b.lineTo(24, 34);
      b.lineTo(32, 34);
      b.lineTo(27, 54);
      b.lineTo(41, 29);
      b.lineTo(33, 29);
      b.closePath();
      fillShape(ctx, b, sym, '#7fe7ff');
      break;
    }
    case 'key': {
      const k = new Path2D();
      k.arc(20, 20, 13, 0, Math.PI * 2);
      k.moveTo(28, 28);
      k.lineTo(54, 54);
      k.lineTo(49, 59);
      k.lineTo(45, 55);
      k.lineTo(41, 59);
      k.lineTo(36, 54);
      k.lineTo(39, 50);
      k.lineTo(23, 34);
      k.closePath();
      fillShape(ctx, k, sym, '#f2d36b');
      ctx.fillStyle = '#fbf8f1';
      ctx.beginPath();
      ctx.arc(18, 18, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
      break;
    }
    case 'switch': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(32, 46);
      ctx.lineTo(46, 14);
      ctx.stroke();
      const knob = new Path2D();
      knob.arc(46, 14, 7, 0, Math.PI * 2);
      fillShape(ctx, knob, sym, '#ff7b6b');
      const base = new Path2D();
      base.roundRect(12, 44, 40, 14, 4);
      fillShape(ctx, base, undefined, '#a69c8f');
      break;
    }
    case 'bolt': {
      const b = new Path2D();
      b.moveTo(38, 4);
      b.lineTo(16, 36);
      b.lineTo(30, 36);
      b.lineTo(24, 60);
      b.lineTo(48, 26);
      b.lineTo(34, 26);
      b.closePath();
      fillShape(ctx, b, sym, '#ffe066');
      break;
    }
    case 'lure': {
      const g = new Path2D();
      g.moveTo(32, 6);
      g.bezierCurveTo(40, 20, 52, 30, 52, 40);
      g.arc(32, 40, 20, 0, Math.PI);
      g.bezierCurveTo(12, 30, 24, 20, 32, 6);
      g.closePath();
      fillShape(ctx, g, sym, '#ff6b6b');
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(25, 38, 4, 7, -0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'follower': {
      fillShape(ctx, blobPath(32, 34, 24), sym, '#f4f1ea');
      ctx.fillStyle = '#fbf8f1';
      ctx.beginPath();
      ctx.ellipse(32, 36, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      blobEyes(ctx, 32, 35, 24);
      break;
    }
    case 'info': {
      const r = new Path2D();
      r.roundRect(10, 8, 44, 48, 6);
      fillShape(ctx, r, sym, '#fbf8f1');
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(32, 19, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(28, 27, 8, 22);
      ctx.fillRect(25, 46, 14, 4);
      break;
    }
    case 'tool': {
      const hex = new Path2D();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        if (i) hex.lineTo(32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25);
        else hex.moveTo(32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25);
      }
      hex.closePath();
      fillShape(ctx, hex, sym, '#8fa3b8');
      const core = new Path2D();
      core.arc(32, 32, 9, 0, Math.PI * 2);
      fillShape(ctx, core, undefined, '#ffe27a', 2.5);
      break;
    }
    case 'ability': {
      fillShape(ctx, starPath(32, 32, 27, 9), sym, '#9d8cff', 2.6);
      break;
    }
    case 'activator': {
      const orb = new Path2D();
      orb.arc(32, 20, 12, 0, Math.PI * 2);
      fillShape(ctx, orb, sym, '#b8f2ff');
      const p = new Path2D();
      p.moveTo(18, 36);
      p.lineTo(46, 36);
      p.lineTo(42, 46);
      p.lineTo(48, 58);
      p.lineTo(16, 58);
      p.lineTo(22, 46);
      p.closePath();
      fillShape(ctx, p, undefined, '#c9b9a6');
      break;
    }
    case 'tablet': {
      const t = new Path2D();
      t.moveTo(12, 58);
      t.lineTo(12, 20);
      t.quadraticCurveTo(12, 6, 32, 6);
      t.quadraticCurveTo(52, 6, 52, 20);
      t.lineTo(52, 58);
      t.closePath();
      fillShape(ctx, t, undefined, '#cfc6b8');
      if (sym !== undefined) {
        const band = new Path2D();
        band.rect(12, 46, 40, 8);
        fillShape(ctx, band, sym, undefined, 2);
      }
      ctx.fillStyle = INK;
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text ?? '#', 32, 29);
      break;
    }
    case 'spark': {
      const s = new Path2D();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 9 : 26;
        const a = (i / 16) * Math.PI * 2;
        s.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      s.closePath();
      fillShape(ctx, s, sym, '#fff1a8');
      break;
    }
  }
}

export function iconCanvas(kind: IconKind, sym?: number, size = 128, text?: string): HTMLCanvasElement {
  const key = `${kind}:${sym ?? '-'}:${size}:${text ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.scale(size / 64, size / 64);
  drawBase(ctx, kind, sym, text);
  cache.set(key, c);
  return c;
}

export function iconUrl(kind: IconKind, sym?: number, text?: string): string {
  const key = `${kind}:${sym ?? '-'}:${text ?? ''}`;
  let url = urlCache.get(key);
  if (!url) {
    url = iconCanvas(kind, sym, 96, text).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}

export interface NodeIcons {
  /** Obstacle/medium: drawn inside the node. */
  inner?: { kind: IconKind; sym?: number; text?: string };
  /** Reward/outcome: drawn on the node's top edge. */
  reward?: { kind: IconKind; sym?: number; text?: string };
}

const GATE_ICON: Record<NonNullable<DepNode['lock']>, IconKind> = {
  key: 'door',
  switch: 'barrier',
  follower: 'followdoor',
  ability: 'seal',
  code: 'dial',
};

export function codeMask(n: DepNode): string {
  return [0, 1, 2].map((i) => (n.reveals?.includes(i) ? '•' : '_')).join('');
}

export function nodeIcons(n: DepNode): NodeIcons {
  switch (n.kind) {
    case 'start':
    case 'location':
      return { inner: { kind: 'flag' } };
    case 'goal':
      return { inner: { kind: 'goal' } };
    case 'gate':
      return { inner: { kind: GATE_ICON[n.lock!], sym: n.sym } };
    case 'key':
      return { reward: { kind: 'key', sym: n.sym } };
    case 'switch':
      return { inner: { kind: 'switch', sym: n.sym }, reward: { kind: 'bolt', sym: n.sym } };
    case 'lure':
      return { reward: { kind: 'lure', sym: n.sym } };
    case 'follower':
      return { inner: { kind: 'follower', sym: n.sym }, reward: { kind: 'follower', sym: n.sym } };
    case 'hint':
      return { reward: { kind: 'info' } };
    case 'tool':
      return { reward: { kind: 'tool' } };
    case 'ability':
      return { reward: { kind: 'ability', sym: n.sym } };
    case 'activator':
      return { inner: { kind: 'activator', sym: n.sym }, reward: { kind: 'spark', sym: n.sym } };
    case 'clue':
      return { reward: { kind: 'tablet', sym: n.sym, text: codeMask(n) } };
  }
}

/** World sign for a hint: "lure → follower" or "ability → activator", drawn with the real patterns. */
export function hintCanvas(a: { kind: IconKind; sym?: number }, b: { kind: IconKind; sym?: number }): HTMLCanvasElement {
  const key = `hint:${a.kind}:${a.sym}:${b.kind}:${b.sym}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8e0d0';
  ctx.fillRect(0, 0, 256, 128);
  ctx.drawImage(iconCanvas(a.kind, a.sym, 96), 12, 16);
  ctx.drawImage(iconCanvas(b.kind, b.sym, 96), 148, 16);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(110, 64);
  ctx.lineTo(144, 64);
  ctx.moveTo(132, 52);
  ctx.lineTo(144, 64);
  ctx.lineTo(132, 76);
  ctx.stroke();
  cache.set(key, c);
  return c;
}

/** World tablet for a code clue: gate pattern + revealed digits. */
export function clueCanvas(sym: number, code: number[], reveals: number[]): HTMLCanvasElement {
  const key = `clue:${sym}:${code.join('')}:${reveals.join('')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d0c2';
  ctx.fillRect(0, 0, 256, 128);
  ctx.drawImage(iconCanvas('dial', sym, 96), 8, 16);
  ctx.font = 'bold 52px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  code.forEach((d, i) => {
    ctx.fillStyle = reveals.includes(i) ? INK : '#a59c8e';
    ctx.fillText(reveals.includes(i) ? String(d) : '_', 136 + i * 42, 66);
  });
  cache.set(key, c);
  return c;
}

/** Ability stone: its pattern plus a three-dot motif that the activator chime replays. */
export function abilityCanvas(sym: number): HTMLCanvasElement {
  const key = `ability:${sym}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d0c2';
  ctx.fillRect(0, 0, 256, 128);
  ctx.drawImage(iconCanvas('ability', sym, 96), 8, 16);
  abilityMotif(sym).forEach((v, i) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(144 + i * 40, 64, 6 + v * 1.6, 0, Math.PI * 2);
    ctx.fill();
  });
  cache.set(key, c);
  return c;
}

export function abilityMotif(sym: number): number[] {
  return [(sym * 5) % 8, (sym * 3 + 2) % 8, (sym * 7 + 5) % 8];
}
