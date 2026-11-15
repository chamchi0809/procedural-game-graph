// Every gate/key/follower/lure/ability gets a unique color + pattern so it can be recognized
// in the world without letters, as the article's prototype does.

export type PatternKind = 'stripes' | 'dots' | 'zigzag' | 'checker' | 'diamonds' | 'waves' | 'cross' | 'rings';

export interface SymStyle {
  base: string;
  accent: string;
  pattern: PatternKind;
}

const PATTERNS: PatternKind[] = ['stripes', 'dots', 'zigzag', 'checker', 'diamonds', 'waves', 'cross', 'rings'];

export function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${s}% ${l}%)`;
}

export function symStyle(sym: number): SymStyle {
  const hue = (sym * 137.508 + 20) % 360;
  const pattern = PATTERNS[(sym * 3 + Math.floor(sym / 8)) % PATTERNS.length];
  const darkAccent = sym % 2 === 0;
  return {
    base: hsl(hue, 70, darkAccent ? 72 : 52),
    accent: hsl(hue + (darkAccent ? 160 : 30), darkAccent ? 45 : 80, darkAccent ? 38 : 88),
    pattern,
  };
}

export function locationColor(index: number, kind: 'start' | 'goal' | 'location'): string {
  if (kind === 'start') return '#e9e6df';
  if (kind === 'goal') return '#ffe08a';
  const hue = (index * 137.508 + 95) % 360;
  return hsl(hue, 62, 76);
}

export function letter(i: number): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  return i < abc.length ? abc[i] : abc[i % abc.length] + Math.floor(i / abc.length);
}

/** Parses any CSS hsl()/hex color into 0xRRGGBB for the 3D side. */
export function cssToHex(css: string): number {
  if (css.startsWith('#')) return parseInt(css.slice(1), 16);
  const m = css.match(/hsl\(([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/);
  if (!m) return 0xffffff;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
