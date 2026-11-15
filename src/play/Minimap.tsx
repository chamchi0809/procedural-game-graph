import { useEffect, useRef } from 'react';
import { isLocationKind } from '../core/generate';
import type { GameRuntime } from '../game/runtime';
import { iconCanvas, nodeIcons } from '../icons';

interface Props {
  runtime: GameRuntime;
  rev: number;
  tracked: string | null;
  big: boolean;
  onToggle: () => void;
}

/** North-up map; regions you haven't entered stay hidden, like fog of war. */
export function Minimap({ runtime, rev, tracked, big, onToggle }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  const w = runtime.level.world;
  const { minX, minY, maxX, maxY } = w.bounds;
  const RES = 6;

  useEffect(() => {
    const c = base.current ?? document.createElement('canvas');
    base.current = c;
    c.width = Math.ceil((maxX - minX) * RES);
    c.height = Math.ceil((maxY - minY) * RES);
    const ctx = c.getContext('2d')!;
    const tx = (x: number) => (x - minX) * RES;
    const ty = (y: number) => (maxY - y) * RES;
    ctx.fillStyle = '#3f5233';
    ctx.fillRect(0, 0, c.width, c.height);
    const seen = (label: number) => label >= 0 && runtime.done.has(w.locIds[label]);
    for (const cell of w.cells) {
      if (cell.poly.length < 3) continue;
      const known = seen(cell.label);
      ctx.fillStyle = cell.label < 0 ? '#4b6340' : known ? runtime.level.colors[w.locIds[cell.label]] : '#8b8577';
      ctx.beginPath();
      cell.poly.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.strokeStyle = '#2a2520';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of w.walls) {
      ctx.moveTo(tx(s.ax), ty(s.ay));
      ctx.lineTo(tx(s.bx), ty(s.by));
    }
    ctx.stroke();
    for (const d of Object.values(w.doors)) {
      const open = runtime.openGates.has(d.gate);
      const ux = (Math.cos(d.angle) * d.width) / 2;
      const uy = (Math.sin(d.angle) * d.width) / 2;
      ctx.strokeStyle = open ? '#f4efe4' : '#c2412d';
      ctx.lineWidth = open ? 2 : 3.5;
      ctx.beginPath();
      ctx.moveTo(tx(d.cx - ux), ty(d.cy - uy));
      ctx.lineTo(tx(d.cx + ux), ty(d.cy + uy));
      ctx.stroke();
    }
    for (const n of runtime.level.graph.nodes) {
      if (isLocationKind(n.kind) || n.kind === 'gate' || n.kind === 'follower') continue;
      if (runtime.done.has(n.id) && n.kind !== 'switch' && n.kind !== 'activator') continue;
      if (!runtime.done.has(n.loc)) continue;
      const p = w.objects[n.id];
      const ic = nodeIcons(n);
      const i = ic.inner ?? ic.reward;
      if (i) ctx.drawImage(iconCanvas(i.kind, i.sym, 64, i.text), tx(p.x) - 9, ty(p.y) - 9, 18, 18);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, rev]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return;
      last = t;
      const c = ref.current;
      const b = base.current;
      if (!c || !b) return;
      const dpr = Math.min(devicePixelRatio, 2);
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (c.width !== Math.round(cw * dpr)) c.width = Math.round(cw * dpr);
      if (c.height !== Math.round(ch * dpr)) c.height = Math.round(ch * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#3f5233';
      ctx.fillRect(0, 0, cw, ch);
      const p = runtime.player;
      // Small map follows the player; the big one shows the whole level.
      const scale = big ? Math.min(cw / b.width, ch / b.height) : 1.15;
      const px = (p.x - minX) * RES;
      const py = (maxY - p.y) * RES;
      const ox = big ? (cw - b.width * scale) / 2 : cw / 2 - px * scale;
      const oy = big ? (ch - b.height * scale) / 2 : ch / 2 - py * scale;
      ctx.drawImage(b, ox, oy, b.width * scale, b.height * scale);
      const sx = (x: number) => ox + (x - minX) * RES * scale;
      const sy = (y: number) => oy + (maxY - y) * RES * scale;

      for (const cr of runtime.followers.values()) {
        const n = runtime.byId.get(cr.id)!;
        if (!runtime.done.has(n.loc) && cr.mode === 'idle') continue;
        ctx.drawImage(iconCanvas('follower', n.sym, 64), sx(cr.x) - 8, sy(cr.y) - 8, 16, 16);
      }
      const tr = trackedRef.current;
      if (tr && runtime.level.world.objects[tr]) {
        const q = runtime.objectPos(tr);
        const pulse = 6 + Math.sin(t / 180) * 2;
        ctx.strokeStyle = '#ff3d7f';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx(q.x), sy(q.y), pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(sx(p.x), sy(p.y));
      ctx.rotate(p.yaw);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1d1a16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [runtime, big, minX, maxY]);

  return (
    <div className={`minimap ${big ? 'big' : ''}`} onClick={onToggle} title={big ? '클릭 또는 M: 작게' : '클릭 또는 M: 전체 지도'}>
      <canvas ref={ref} />
      <span className="mm-n">N</span>
    </div>
  );
}
