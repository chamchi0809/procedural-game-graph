// Korean particle selection for user-chosen words.

// Korean reading of the final character decides the particle: none / ㄹ / other batchim.
const DIGIT_END = ['other', 'rieul', 'none', 'other', 'none', 'none', 'other', 'rieul', 'rieul', 'none'] as const;

function ending(word: string): 'none' | 'rieul' | 'other' | null {
  const ch = word.trim().slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other';
  }
  if (/[0-9]/.test(ch)) return DIGIT_END[Number(ch)];
  if (/[lrLR]/.test(ch)) return 'rieul';
  if (/[mnMN]/.test(ch)) return 'other';
  if (/[a-zA-Z]/.test(ch)) return 'none';
  return null;
}

/** Particle for `word`; `pair` is "받침형/무받침형", e.g. "을/를", "이/가", "으로/로". */
export function josa(word: string, pair: string): string {
  const [withB, without] = pair.split('/');
  const e = ending(word);
  if (e === null) return `${without}(${withB})`;
  if (withB === '으로') return e === 'other' ? '으로' : '로';
  return e === 'none' ? without : withB;
}
