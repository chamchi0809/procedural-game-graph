import { generateLevel, DEFAULT_PARAMS } from '../src/core/generate';
import { GameRuntime } from '../src/game/runtime';
import { Autopilot } from '../src/game/bot';

let ok = 0, fail = 0;
const times: number[] = [];
const nodes: Record<string, number[]> = {};
for (const complexity of [0, 0.5, 1])
for (const locations of [2, 5, 9, 14]) {
  for (let s = 0; s < 15; s++) {
    const level = generateLevel({ ...DEFAULT_PARAMS, seed: `bot-${s}`, locations, complexity });
    (nodes[`c${complexity} n${locations}`] ??= []).push(level.graph.nodes.length);
    const rt = new GameRuntime(level);
    const bot = new Autopilot(rt);
    let t = 0;
    while (t < 900 && bot.step(1 / 30)) t += 1 / 30;
    if (rt.won) { ok++; times.push(t); }
    else { fail++; console.log('FAIL', complexity, locations, s, 'stuck on', bot.current, rt.byId.get(bot.current!)?.kind, rt.byId.get(bot.current!)?.lock, 'done', rt.done.size, '/', level.graph.nodes.length); }
  }
}
for (const [k, v] of Object.entries(nodes)) console.log(k, 'avg nodes', (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1));
console.log({ ok, fail, avgGameSeconds: times.reduce((a, b) => a + b, 0) / times.length });
