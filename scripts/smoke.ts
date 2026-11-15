import { generateLevel, DEFAULT_PARAMS } from '../src/core/generate';
let fails = 0, attempts = 0, ms = 0;
const N = 60;
for (let i = 0; i < N; i++) {
  for (const locations of [5, 9, 14]) {
    try {
      const lv = generateLevel({ ...DEFAULT_PARAMS, seed: 'seed' + i, locations });
      attempts += lv.attempts; ms += lv.stats.ms;
      if (i === 0) console.log(locations, lv.stats, 'walls', lv.world.walls.length, 'cells', lv.world.cells.length, 'trees', lv.world.trees.length, 'snaps', lv.snapshots.length);
    } catch (e) { fails++; console.log('FAIL', i, locations, (e as Error).message); }
  }
}
console.log({ fails, avgAttempts: attempts / (N * 3), avgMs: ms / (N * 3) });
