// PixiJS 3D rendering of a GameRuntime. World (x, y) maps to 3D (x, height, -y), so world +y is
// "north" and a yaw of 0 looks down -Z like the default camera.

import {
  Container3D,
  CubeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Geometry3D,
  IcosahedronGeometry,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  SphereGeometry,
  Sprite3D,
  srgbToLinear,
  View3D,
  ConeGeometry,
} from '@pixi/3d';
import { OutlinePass } from '@pixi/3d/extras';
import { Application, Texture } from 'pixi.js';
import { cssToHex, symStyle } from '../core/patterns';
import type { DepNode, Level } from '../core/types';
import { clueCanvas, hintCanvas, iconCanvas, abilityCanvas, type IconKind } from '../icons';
import { fmt } from '../terms';
import type { GameRuntime } from './runtime';

export type CameraMode = 'first' | 'top';

const WALL_H = 1.25;
const EYE = 1.6;
const textures = new Map<HTMLCanvasElement, Texture>();
const tex = (c: HTMLCanvasElement) => {
  let t = textures.get(c);
  if (!t) {
    t = Texture.from(c);
    textures.set(c, t);
  }
  return t;
};

const geo = {
  cube: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
  trunk: new CylinderGeometry({ radiusTop: 0.14, radiusBottom: 0.2, height: 1.4, radialSegments: 6 }),
  crown: new IcosahedronGeometry({ radius: 1, detail: 0 }),
  pole: new CylinderGeometry({ radiusTop: 0.05, radiusBottom: 0.05, height: 1, radialSegments: 6 }),
  disc: new CylinderGeometry({ radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 20 }),
  ball: new SphereGeometry({ radius: 1, widthSegments: 16, heightSegments: 10 }),
  cone: new ConeGeometry({ radius: 1, height: 1, radialSegments: 12 }),
  quad: new PlaneGeometry({ width: 1, height: 1, flipV: true }),
};

interface GateView {
  node: DepNode;
  panel: Mesh3D;
  extras: Mesh3D[];
  t: number;
  h: number;
}

interface ItemView {
  node: DepNode;
  root: Container3D;
  bob?: Container3D;
  baseY: number;
}

export class Scene3D {
  app!: Application;
  view!: View3D;
  private levelRoot = new Container3D();
  private sun!: DirectionalLight;
  private gates: GateView[] = [];
  private items: ItemView[] = [];
  private switches = new Map<string, Container3D>();
  private activators = new Map<string, Material3D>();
  private followers = new Map<string, Container3D>();
  private avatar!: Container3D;
  private beacon!: Mesh3D;
  private time = 0;
  private mats = new Map<string, Material3D>();
  mode: CameraMode = 'first';
  pitch = -0.08;
  topZoom = 26;
  private ready: Promise<void>;
  private destroyed = false;

  constructor(private readonly host: HTMLElement) {
    this.ready = this.init();
  }

  private async init() {
    const app = new Application();
    await app.init({ resizeTo: this.host, antialias: true, background: 0xcfe3e8, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    app.canvas.style.display = 'block';
    this.host.appendChild(app.canvas);
    this.view = new View3D({
      autoResize: true,
      shadowQuality: 'medium',
      environment: { skyColor: 0xd8ecff, groundColor: 0x8a7a5c, intensity: 0.9 },
      background: 0xcfe3e8,
      fog: { type: 'linear', color: 0xcfe3e8, near: 30, far: 95 },
    });
    this.view.passes = [new OutlinePass({ width: 0.035, color: 0x2a2520 })];
    app.stage.addChild(this.view);
    this.view.camera.fov = 70;
    this.view.camera.far = 400;
    this.sun = new DirectionalLight({ color: 0xfff1dc, intensity: 2.6, castShadow: true, shadow: { cascades: 2, maxDistance: 70 } });
    this.sun.rotation.set(-Math.PI / 3.2, Math.PI / 5, 0);
    this.view.root.addChild(this.sun);
    this.view.root.addChild(this.levelRoot);
  }

  whenReady() {
    return this.ready;
  }

  destroy() {
    this.destroyed = true;
    if (this.app) this.app.destroy(true, { children: true });
  }

  private mat(color: number | string, opts: Partial<{ roughness: number; emissive: number; strength: number; outline: boolean; alpha: number }> = {}) {
    const key = `${color}:${JSON.stringify(opts)}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new Material3D({
        baseColor: color,
        roughness: opts.roughness ?? 0.85,
        metallic: 0,
        ...(opts.emissive !== undefined ? { emissive: { color: opts.emissive, strength: opts.strength ?? 1 } } : {}),
        ...(opts.alpha !== undefined ? { alphaMode: 'blend' as const, alpha: opts.alpha } : {}),
        passes: { outline: opts.outline ?? true },
      });
      this.mats.set(key, m);
    }
    return m;
  }

  private box(parent: Container3D, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, outline = true) {
    const m = new Mesh3D({ geometry: geo.cube, material: this.mat(color, { outline }), position: { x, y, z }, castShadow: true, receiveShadow: true });
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    parent.addChild(m);
    return m;
  }

  private sprite(parent: Container3D, canvas: HTMLCanvasElement, height: number, y: number, mode: 'cylindrical' | 'spherical' | 'none' = 'cylindrical') {
    return new Sprite3D({ texture: tex(canvas), height, anchor: { x: 0.5, y: 1 }, billboardMode: mode, position: { x: 0, y, z: 0 }, parent });
  }

  load(level: Level) {
    const root = this.levelRoot;
    for (const c of [...root.children]) c.destroy({ children: true });
    this.gates = [];
    this.items = [];
    this.switches.clear();
    this.activators.clear();
    this.followers.clear();
    const w = level.world;
    const byId = new Map(level.graph.nodes.map((n) => [n.id, n]));

    // Ground: every Voronoi cell as a flat fan, tinted by its location.
    const locColor = w.locIds.map((id) => cssToHex(level.colors[id]));
    const forest = 0x5d7a46;
    let vcount = 0;
    let icount = 0;
    for (const c of w.cells) {
      vcount += c.poly.length;
      icount += Math.max(0, c.poly.length - 2) * 3;
    }
    const positions = new Float32Array(vcount * 3);
    const normals = new Float32Array(vcount * 3);
    const colors = new Float32Array(vcount * 4);
    const indices = new Uint32Array(icount);
    let v = 0;
    let ii = 0;
    w.cells.forEach((c, ci) => {
      const base = c.label >= 0 ? locColor[c.label] : forest;
      const jitter = 0.93 + ((ci * 2654435761) % 1000) / 1000 * 0.1;
      const r = srgbToLinear((((base >> 16) & 255) / 255) * jitter);
      const g = srgbToLinear((((base >> 8) & 255) / 255) * jitter);
      const b = srgbToLinear(((base & 255) / 255) * jitter);
      const start = v;
      const pts = c.poly.length > 1 && c.poly[0][0] === c.poly[c.poly.length - 1][0] && c.poly[0][1] === c.poly[c.poly.length - 1][1] ? c.poly.slice(0, -1) : c.poly;
      for (const [px, py] of pts) {
        positions.set([px, 0, -py], v * 3);
        normals.set([0, 1, 0], v * 3);
        colors.set([r, g, b, 1], v * 4);
        v++;
      }
      // Seen from +Y with z = -y, the polygon's winding flips; pick the order that faces up.
      let area = 0;
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[(k + 1) % pts.length];
        area += ax * by - bx * ay;
      }
      for (let k = 1; k < pts.length - 1; k++) {
        if (area > 0) indices.set([start, start + k, start + k + 1], ii);
        else indices.set([start, start + k + 1, start + k], ii);
        ii += 3;
      }
    });
    root.addChild(
      new Mesh3D({
        geometry: new Geometry3D({ positions: positions.subarray(0, v * 3), normals: normals.subarray(0, v * 3), colors: colors.subarray(0, v * 4), indices: indices.subarray(0, ii) }),
        material: new Material3D({ baseColor: 0xffffff, roughness: 1, vertexColors: true, passes: { outline: false } }),
        receiveShadow: true,
        castShadow: false,
      }),
    );

    // Walls between differing regions.
    const wallMat = this.mat(0xc9bba3, { outline: false });
    for (const s of w.walls) {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const len = Math.hypot(dx, dy);
      const m = new Mesh3D({ geometry: geo.cube, material: wallMat, position: { x: (s.ax + s.bx) / 2, y: WALL_H / 2, z: -(s.ay + s.by) / 2 }, castShadow: true, receiveShadow: true });
      m.scale.set(len + 0.32, WALL_H, 0.32);
      m.rotation.y = Math.atan2(dy, dx);
      root.addChild(m);
    }

    // Trees
    const trunkMat = this.mat(0x7a5a3c, { outline: false });
    const crownMats = [this.mat(0x4f8a3e), this.mat(0x5e9a48), this.mat(0x3f7a3a)];
    w.trees.forEach((t, i) => {
      const s = t.scale * (t.blocking ? 1 : 1.25);
      const trunk = new Mesh3D({ geometry: geo.trunk, material: trunkMat, position: { x: t.x, y: 0.7 * s, z: -t.y }, castShadow: true });
      trunk.scale.set(s, s, s);
      const crown = new Mesh3D({ geometry: geo.crown, material: crownMats[i % 3], position: { x: t.x, y: 1.9 * s, z: -t.y }, castShadow: true });
      crown.scale.set(1.05 * s, 1.15 * s, 1.05 * s);
      crown.rotation.y = i;
      root.addChild(trunk, crown);
    });

    // Location markers: a flag pole with the location's name.
    level.locations.forEach((id) => {
      const n = byId.get(id)!;
      const p = w.objects[id];
      const c = new Container3D({ position: { x: p.x, y: 0, z: -p.y } });
      const pole = new Mesh3D({ geometry: geo.pole, material: this.mat(0x5a4a3a), position: { x: 0, y: 1.6, z: 0 }, castShadow: true });
      pole.scale.set(1, 3.2, 1);
      c.addChild(pole);
      this.sprite(c, locationBanner(fmt(n.label), level.colors[id], n.kind), 1.2, 3.3);
      if (n.kind === 'goal') {
        const glow = new Mesh3D({ geometry: geo.disc, material: this.mat(0xffd34d, { emissive: 0xffc93c, strength: 0.8, outline: false }), position: { x: 0, y: 0.03, z: 0 } });
        glow.scale.set(2.2, 0.05, 2.2);
        c.addChild(glow);
      }
      root.addChild(c);
    });

    // Gates
    for (const d of Object.values(w.doors)) {
      const n = byId.get(d.gate)!;
      const st = symStyle(n.sym ?? 0);
      const col = cssToHex(st.base);
      const c = new Container3D({ position: { x: d.cx, y: 0, z: -d.cy } });
      c.rotation.y = d.angle;
      root.addChild(c);
      for (const side of [-1, 1]) this.box(c, 0x8f8270, side * (d.width / 2 + 0.2), 1.25, 0, 0.4, 2.5, 0.5);
      this.box(c, 0x8f8270, 0, 2.6, 0, d.width + 0.8, 0.3, 0.5);
      const h = 2.3;
      let panel: Mesh3D;
      const extras: Mesh3D[] = [];
      if (n.lock === 'switch' || n.lock === 'ability') {
        panel = new Mesh3D({ geometry: geo.cube, material: this.mat(col, { emissive: col, strength: 0.6, alpha: 0.55, outline: false }), position: { x: 0, y: h / 2, z: 0 } });
        panel.scale.set(d.width, h, 0.08);
        c.addChild(panel);
      } else {
        panel = this.box(c, col, 0, h / 2, 0, d.width, h, 0.22);
      }
      const icon: IconKind = n.lock === 'key' ? 'door' : n.lock === 'switch' ? 'barrier' : n.lock === 'follower' ? 'followdoor' : n.lock === 'ability' ? 'seal' : 'dial';
      for (const side of [-1, 1]) {
        const q = new Mesh3D({ geometry: geo.quad, material: new Material3D({ baseColorTexture: tex(iconCanvas(icon, n.sym, 128)), alphaMode: 'mask', roughness: 0.9, passes: { outline: false } }), position: { x: 0, y: 1.25, z: side * 0.13 } });
        q.scale.set(1.3, 1.3, 1);
        if (side < 0) q.rotation.y = Math.PI;
        c.addChild(q);
        extras.push(q);
      }
      this.gates.push({ node: n, panel, extras, t: 0, h });
    }

    // Objects
    for (const n of level.graph.nodes) {
      const p = w.objects[n.id];
      if (!p || n.kind === 'gate' || n.kind === 'start' || n.kind === 'goal' || n.kind === 'location') continue;
      const c = new Container3D({ position: { x: p.x, y: 0, z: -p.y } });
      root.addChild(c);
      if (n.kind === 'switch') {
        this.box(c, 0x8b8378, 0, 0.3, 0, 0.9, 0.6, 0.6);
        const arm = new Container3D({ position: { x: 0, y: 0.6, z: 0 } });
        const stick = new Mesh3D({ geometry: geo.pole, material: this.mat(0x444038), position: { x: 0, y: 0.45, z: 0 }, castShadow: true });
        stick.scale.set(1.4, 0.9, 1.4);
        const knob = new Mesh3D({ geometry: geo.ball, material: this.mat(cssToHex(symStyle(n.sym!).base)), position: { x: 0, y: 0.95, z: 0 }, castShadow: true });
        knob.scale.set(0.16, 0.16, 0.16);
        arm.addChild(stick, knob);
        arm.rotation.x = 0.6;
        c.addChild(arm);
        this.switches.set(n.id, arm);
        this.sprite(c, iconCanvas('switch', n.sym, 128), 0.8, 2.2);
        this.items.push({ node: n, root: c, baseY: 0 });
      } else if (n.kind === 'activator') {
        const ped = new Mesh3D({ geometry: geo.disc, material: this.mat(0xb5a993), position: { x: 0, y: 0.45, z: 0 }, castShadow: true, receiveShadow: true });
        ped.scale.set(0.6, 0.9, 0.6);
        const col = cssToHex(symStyle(n.sym!).base);
        const orbMat = new Material3D({ baseColor: col, roughness: 0.3, emissive: { color: col, strength: 0 }, passes: { outline: true } });
        const orb = new Mesh3D({ geometry: geo.ball, material: orbMat, position: { x: 0, y: 1.25, z: 0 }, castShadow: true });
        orb.scale.set(0.35, 0.35, 0.35);
        c.addChild(ped, orb);
        this.activators.set(n.id, orbMat);
        this.sprite(c, iconCanvas('activator', n.sym, 128), 0.8, 2.5);
        this.items.push({ node: n, root: c, baseY: 0 });
      } else if (n.kind === 'follower') {
        const body = new Container3D();
        const col = cssToHex(symStyle(n.sym!).base);
        const orb = new Mesh3D({ geometry: geo.ball, material: this.mat(col), position: { x: 0, y: 0.5, z: 0 }, castShadow: true });
        orb.scale.set(0.4, 0.4, 0.4);
        body.addChild(orb);
        for (const sx of [-1, 1]) {
          const eye = new Mesh3D({ geometry: geo.ball, material: this.mat(0x22201c, { outline: false }), position: { x: sx * 0.13, y: 0.6, z: -0.34 } });
          eye.scale.set(0.07, 0.09, 0.07);
          body.addChild(eye);
        }
        c.addChild(body);
        this.sprite(c, iconCanvas('follower', n.sym, 128), 0.7, 1.35);
        this.followers.set(n.id, c);
        this.items.push({ node: n, root: c, bob: body, baseY: 0 });
      } else {
        const bob = new Container3D({ position: { x: 0, y: 0.9, z: 0 } });
        c.addChild(bob);
        const shadow = new Mesh3D({ geometry: geo.disc, material: this.mat(0x000000, { alpha: 0.18, outline: false }), position: { x: 0, y: 0.02, z: 0 } });
        shadow.scale.set(0.45, 0.01, 0.45);
        c.addChild(shadow);
        if (n.kind === 'hint') {
          const a = byId.get(n.hintA!)!;
          const b = byId.get(n.hintB!)!;
          const post = new Mesh3D({ geometry: geo.pole, material: this.mat(0x6b4f36), position: { x: 0, y: 0.6, z: 0 }, castShadow: true });
          post.scale.set(1.5, 1.2, 1.5);
          c.addChild(post);
          const ka: IconKind = a.kind === 'lure' ? 'lure' : 'ability';
          const kb: IconKind = b.kind === 'follower' ? 'follower' : 'activator';
          bob.position.y = 0.6;
          this.sprite(bob, hintCanvas({ kind: ka, sym: a.sym }, { kind: kb, sym: b.sym }), 0.9, 0.7);
        } else if (n.kind === 'clue') {
          const g = byId.get(n.gate!)!;
          bob.position.y = 0.2;
          this.sprite(bob, clueCanvas(n.sym!, g.code!, n.reveals!), 0.9, 0.9);
        } else if (n.kind === 'ability') {
          bob.position.y = 0.2;
          this.sprite(bob, abilityCanvas(n.sym!), 0.9, 0.9);
        } else {
          const kind: IconKind = n.kind === 'key' ? 'key' : n.kind === 'lure' ? 'lure' : 'tool';
          this.sprite(bob, iconCanvas(kind, n.sym, 128), 0.8, 0);
        }
        this.items.push({ node: n, root: c, bob, baseY: bob.position.y });
      }
    }

    // Player avatar (only visible from the top camera) and the tracking beacon.
    this.avatar = new Container3D();
    const pBody = new Mesh3D({ geometry: geo.ball, material: this.mat(0xf2f0ea), position: { x: 0, y: 0.6, z: 0 }, castShadow: true });
    pBody.scale.set(0.35, 0.6, 0.35);
    const pNose = new Mesh3D({ geometry: geo.cone, material: this.mat(0xe85d3f), position: { x: 0, y: 0.9, z: -0.38 } });
    pNose.scale.set(0.12, 0.3, 0.12);
    pNose.rotation.x = -Math.PI / 2;
    this.avatar.addChild(pBody, pNose);
    root.addChild(this.avatar);
    this.beacon = new Mesh3D({ geometry: geo.disc, material: this.mat(0xffe066, { emissive: 0xffd23f, strength: 1.2, alpha: 0.28, outline: false }), position: { x: 0, y: 12, z: 0 } });
    this.beacon.scale.set(0.35, 24, 0.35);
    this.beacon.visible = false;
    root.addChild(this.beacon);
  }

  /** Mirrors runtime state into the scene and positions the camera. */
  sync(rt: GameRuntime, dt: number, tracked: string | null) {
    this.time += dt;
    const p = rt.player;
    for (const g of this.gates) {
      const open = rt.openGates.has(g.node.id);
      g.t = Math.min(1, Math.max(0, g.t + (open ? dt : -dt) * 1.4));
      const e = g.t * g.t * (3 - 2 * g.t);
      g.panel.position.y = g.h / 2 - e * (g.h + 0.05);
      g.panel.visible = e < 0.999;
      for (const q of g.extras) q.visible = e < 0.5;
    }
    for (const it of this.items) {
      const n = it.node;
      if (n.kind === 'follower') {
        const c = rt.followers.get(n.id)!;
        const prev = it.root.position;
        const dx = c.x - prev.x;
        const dz = -c.y - prev.z;
        if (Math.hypot(dx, dz) > 0.01) it.bob!.rotation.y = Math.atan2(-dx, -dz);
        it.root.position.set(c.x, 0, -c.y);
        it.bob!.position.y = c.mode === 'follow' ? Math.abs(Math.sin(this.time * 9)) * 0.12 : 0;
        continue;
      }
      if (n.kind === 'switch') {
        const arm = this.switches.get(n.id)!;
        const target = rt.done.has(n.id) ? -0.6 : 0.6;
        arm.rotation.x += (target - arm.rotation.x) * Math.min(1, dt * 8);
        continue;
      }
      if (n.kind === 'activator') {
        const m = this.activators.get(n.id)!;
        const s = rt.done.has(n.id) ? 1.6 + Math.sin(this.time * 3) * 0.4 : 0;
        if (m.emissive) m.emissive.strength = s;
        continue;
      }
      it.root.visible = !rt.done.has(n.id);
      if (it.bob) it.bob.position.y = it.baseY + Math.sin(this.time * 2.2 + n.id.length) * 0.08;
    }

    if (tracked && rt.level.world.objects[tracked]) {
      const tp = rt.objectPos(tracked);
      this.beacon.visible = true;
      this.beacon.position.set(tp.x, 12, -tp.y);
    } else this.beacon.visible = false;

    this.avatar.position.set(p.x, 0, -p.y);
    this.avatar.rotation.y = -p.yaw;
    this.avatar.visible = this.mode === 'top';

    const cam = this.view.camera;
    const fx = Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    if (this.mode === 'first') {
      const bobY = EYE;
      cam.position.set(p.x, bobY, -p.y);
      cam.lookAt({ x: p.x + fx * Math.cos(this.pitch), y: bobY + Math.sin(this.pitch), z: -p.y + fz * Math.cos(this.pitch) });
    } else {
      const back = this.topZoom * 0.45;
      cam.position.set(p.x - fx * back, this.topZoom, -p.y - fz * back);
      cam.lookAt({ x: p.x, y: 0, z: -p.y });
    }
  }
}

function locationBanner(label: string, color: string, kind: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 112;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#2a2520';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(6, 6, 148, 100, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a2520';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${label.length > 2 ? 44 : 64}px system-ui, sans-serif`;
  ctx.fillText(label, 80, kind === 'location' ? 60 : 58);
  return c;
}
