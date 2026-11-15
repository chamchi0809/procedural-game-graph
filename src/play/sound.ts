import { abilityMotif } from '../icons';

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (m: boolean) => (muted = m);
export const isMuted = () => muted;

function audio() {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Pentatonic so any melody sounds pleasant.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

function note(a: AudioContext, freq: number, at: number, len: number, type: OscillatorType = 'triangle', vol = 0.18) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.05);
}

export function playChime(sym: number) {
  const a = audio();
  if (!a) return;
  abilityMotif(sym).forEach((p, i) => note(a, 392 * 2 ** (SCALE[p] / 12), a.currentTime + i * 0.28, 0.5));
}

export function sfx(kind: 'good' | 'bad' | 'info' | 'win') {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  if (kind === 'good') [0, 4, 7].forEach((s, i) => note(a, 523 * 2 ** (s / 12), t + i * 0.07, 0.25));
  else if (kind === 'bad') note(a, 160, t, 0.25, 'square', 0.08);
  else if (kind === 'info') note(a, 660, t, 0.15, 'sine', 0.12);
  else [0, 4, 7, 12, 16].forEach((s, i) => note(a, 523 * 2 ** (s / 12), t + i * 0.1, 0.6));
}
