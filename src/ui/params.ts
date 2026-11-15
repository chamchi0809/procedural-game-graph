import { DEFAULT_PARAMS } from '../core/generate';
import { LOCK_KINDS, type DepSpec, type GenParams, type LockKind, type SpatialLayout } from '../core/types';

/** Everything that determines a level: generator settings plus the user's edits. */
export interface Doc {
  params: GenParams;
  spatialSeed: string;
  /** Hand-edited dependency graph; null means generate from `params`. */
  spec: DepSpec | null;
  layout: SpatialLayout | null;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

// Layout as `id:x,y;!id:x,y` with `!` marking pinned nodes; one decimal is plenty at world scale.
function layoutToString(l: SpatialLayout): string {
  const fixed = new Set(l.fixed);
  return Object.entries(l.pos)
    .map(([id, p]) => `${fixed.has(id) ? '!' : ''}${id}:${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(';');
}

function layoutFromString(s: string): SpatialLayout | null {
  const pos: SpatialLayout['pos'] = {};
  const fixed: string[] = [];
  for (const part of s.split(';')) {
    const m = part.match(/^(!?)(.+):(-?[\d.]+),(-?[\d.]+)$/);
    if (!m) continue;
    pos[m[2]] = { x: Number(m[3]), y: Number(m[4]) };
    if (m[1]) fixed.push(m[2]);
  }
  return Object.keys(pos).length ? { pos, fixed } : null;
}

export function docToHash(d: Doc): string {
  const p = d.params;
  const q = new URLSearchParams({
    seed: p.seed,
    n: String(p.locations),
    m: p.mechanics.join(','),
    r: p.remoteness.toFixed(2),
    c: p.complexity.toFixed(2),
    h: p.hints ? '1' : '0',
  });
  if (d.spatialSeed !== p.seed) q.set('s', d.spatialSeed);
  if (d.spec) q.set('d', b64(JSON.stringify(d.spec)));
  if (d.layout) q.set('l', layoutToString(d.layout));
  return `#${q.toString()}`;
}

export function docFromHash(hash: string): Doc {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const num = (v: string | null, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const m = q.get('m');
  const mechanics = m === null ? DEFAULT_PARAMS.mechanics : (m.split(',').filter((k) => LOCK_KINDS.includes(k as LockKind)) as LockKind[]);
  const params: GenParams = {
    seed: q.get('seed') || DEFAULT_PARAMS.seed,
    locations: Math.round(num(q.get('n'), 2, 20, DEFAULT_PARAMS.locations)),
    mechanics: mechanics.length ? mechanics : ['key'],
    remoteness: num(q.get('r'), 0, 1, DEFAULT_PARAMS.remoteness),
    complexity: num(q.get('c'), 0, 1, DEFAULT_PARAMS.complexity),
    hints: q.get('h') === null ? DEFAULT_PARAMS.hints : q.get('h') === '1',
  };
  let spec: DepSpec | null = null;
  try {
    const d = q.get('d');
    if (d) spec = JSON.parse(unb64(d));
  } catch {
    /* corrupted link: fall back to the generator */
  }
  const l = q.get('l');
  return { params, spatialSeed: q.get('s') || params.seed, spec, layout: l ? layoutFromString(l) : null };
}
