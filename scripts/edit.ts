// Fuzz: random edit sequences on generated and blank specs must always build, lay out and be beatable.
import { addBranch, blankSpec, connect, disconnect, EditError, insertAfter, movePiece, pieceTargets, removeLocation, setEntrance, setLock, setSlotCount } from '../src/core/edit';
import { assembleLevel, DEFAULT_PARAMS, dependencyFromSpec, generateDependency, generateSpatial } from '../src/core/generate';
import { makeRng } from '../src/core/rng';
import { LOCK_KINDS, type DepSpec } from '../src/core/types';
import { GameRuntime } from '../src/game/runtime';
import { Autopilot } from '../src/game/bot';

let ok = 0, fail = 0, rejected = 0, applied = 0;
for (let s = 0; s < 40; s++) {
  const rng = makeRng(`edit-${s}`);
  let spec: DepSpec = s % 4 === 0 ? blankSpec(true) : generateDependency({ ...DEFAULT_PARAMS, seed: `edit-${s}`, locations: 3 + (s % 6) }).spec;
  for (let k = 0; k < 25; k++) {
    const locs = spec.locs;
    const L = rng.pick(locs);
    const M = rng.pick(locs);
    const pieces = dependencyFromSpec(spec).graph.nodes.filter((n) => !['start', 'goal', 'location', 'gate'].includes(n.kind));
    try {
      switch (rng.int(0, 8)) {
        case 0: spec = insertAfter(spec, L).spec; break;
        case 1: spec = addBranch(spec, L).spec; break;
        case 2: spec = connect(spec, L, M); break;
        case 3: spec = disconnect(spec, rng.pick(spec.parents[M].length ? spec.parents[M] : [L]), M); break;
        case 4: spec = removeLocation(spec, L); break;
        case 5: if (spec.gates[L]) spec = setLock(spec, L, rng.pick(LOCK_KINDS)); break;
        case 6: if (spec.gates[L]) spec = setSlotCount(spec, L, rng.int(1, 3)); break;
        case 7: if (spec.gates[L]) spec = setEntrance(spec, L, rng.pick(spec.parents[L])); break;
        case 8: if (pieces.length) { const p = rng.pick(pieces).id; const t = pieceTargets(spec, p); if (t.length) spec = movePiece(spec, p, rng.pick(t)); } break;
      }
      applied++;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      rejected++;
    }
  }
  const dep = dependencyFromSpec(spec);
  const level = assembleLevel(DEFAULT_PARAMS, dep, `sp-${s}`, generateSpatial(dep, `sp-${s}`), 0);
  const rt = new GameRuntime(level);
  const bot = new Autopilot(rt);
  let t = 0;
  while (t < 900 && bot.step(1 / 30)) t += 1 / 30;
  if (rt.won) ok++;
  else { fail++; console.log('FAIL', s, 'locs', spec.locs.length, 'stuck on', bot.current); }
}
console.log({ ok, fail, applied, rejected });
