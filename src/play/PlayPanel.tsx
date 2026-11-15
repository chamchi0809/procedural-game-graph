import { useEffect, useRef, useState } from 'react';
import { Autopilot } from '../game/bot';
import type { GameRuntime } from '../game/runtime';
import { Scene3D } from '../game/scene3d';
import { iconUrl, nodeIcons } from '../icons';
import { fmt, useTerms } from '../terms';
import { JOURNAL_MARK, journalText, kindTerm, nodeTitle } from '../ui/text';
import { CodeDialog, ActivatorDialog } from './Dialogs';
import { Minimap } from './Minimap';
import { isMuted, setMuted, sfx } from './sound';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1],
};
const TOAST_MS = 4200;

interface Props {
  runtime: GameRuntime;
  rev: number;
  tracked: string | null;
  onTrack: (id: string | null) => void;
  onReset: () => void;
  onNextSeed: () => void;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function PlayPanel({ runtime, rev, tracked, onTrack, onReset, onNextSeed }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const timerEl = useRef<HTMLSpanElement>(null);
  const compassEl = useRef<HTMLDivElement>(null);
  const autoEl = useRef<HTMLSpanElement>(null);
  const scene = useRef<Scene3D | null>(null);
  const loaded = useRef<unknown>(null);
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: runtime.player.yaw, pitch: -0.08 });
  const bot = useRef<Autopilot | null>(null);

  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(false);
  const [camMode, setCamMode] = useState<'first' | 'top'>('first');
  const [auto, setAuto] = useState(false);
  const [bigMap, setBigMap] = useState(false);
  const [journal, setJournal] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [, setClock] = useState(0);

  const live = useRef({ runtime, tracked, auto, camMode });
  live.current = { runtime, tracked, auto, camMode };

  useEffect(() => {
    const s = new Scene3D(host.current!);
    scene.current = s;
    return () => {
      s.destroy();
      scene.current = null;
    };
  }, []);

  // New runtime = new level or reset.
  useEffect(() => {
    look.current.yaw = runtime.player.yaw;
    bot.current = null;
    setAuto(false);
    const s = scene.current!;
    let alive = true;
    s.whenReady().then(() => {
      if (!alive || loaded.current === runtime.level) return;
      s.load(runtime.level);
      loaded.current = runtime.level;
    });
    return () => {
      alive = false;
    };
  }, [runtime]);

  // Location banners are baked into textures, so a rename rebuilds the scene.
  const terms = useTerms();
  const termsSeen = useRef(terms);
  useEffect(() => {
    if (termsSeen.current === terms) return;
    termsSeen.current = terms;
    if (scene.current && loaded.current === runtime.level) scene.current.load(runtime.level);
  }, [terms, runtime]);

  useEffect(() => {
    if (scene.current) scene.current.mode = camMode;
    if (camMode === 'top' && document.pointerLockElement) document.exitPointerLock();
  }, [camMode]);

  // Main loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { runtime: rt, tracked: tr, auto: au } = live.current;
      const s = scene.current;
      if (au) {
        bot.current ??= new Autopilot(rt);
        if (!bot.current.step(dt)) setAuto(false);
        look.current.yaw = rt.player.yaw;
        if (autoEl.current) {
          const cur = bot.current.current ? rt.byId.get(bot.current.current) : null;
          autoEl.current.textContent = cur ? nodeTitle(cur) : '';
        }
      } else {
        let f = 0;
        let r = 0;
        for (const k of keys.current) {
          const m = MOVE_KEYS[k];
          if (m) {
            f += m[0];
            r += m[1];
          }
        }
        const sprint = keys.current.has('ShiftLeft') || keys.current.has('ShiftRight');
        rt.update(dt, { f: Math.sign(f), r: Math.sign(r), sprint }, look.current.yaw);
      }
      if (s && loaded.current === rt.level) {
        s.pitch = look.current.pitch;
        s.sync(rt, dt, tr);
      }
      rt.flush();
      if (timerEl.current) timerEl.current.textContent = fmtTime(rt.elapsed);
      const ce = compassEl.current;
      if (ce) {
        if (tr && rt.level.world.objects[tr]) {
          const q = rt.objectPos(tr);
          const dx = q.x - rt.player.x;
          const dy = q.y - rt.player.y;
          const rel = Math.atan2(dx, dy) - rt.player.yaw;
          ce.style.display = '';
          ce.querySelector<HTMLElement>('.arrow')!.style.transform = `rotate(${rel}rad)`;
          ce.querySelector<HTMLElement>('.dist')!.textContent = `${Math.round(Math.hypot(dx, dy))}m`;
        } else ce.style.display = 'none';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Toast expiry + sounds for new toasts.
  const lastToast = useRef(0);
  useEffect(() => {
    const t = runtime.toasts.at(-1);
    if (t && t.id !== lastToast.current) {
      lastToast.current = t.id;
      sfx(t.tone);
    }
  }, [rev, runtime]);
  useEffect(() => {
    if (runtime.won) sfx('win');
  }, [runtime.won, runtime]);
  useEffect(() => {
    const i = setInterval(() => setClock((c) => c + 1), 600);
    return () => clearInterval(i);
  }, []);

  // Dialogs need the mouse.
  useEffect(() => {
    if ((runtime.dialog || runtime.won) && document.pointerLockElement) document.exitPointerLock();
  }, [rev, runtime]);

  useEffect(() => {
    const onLock = () => setLocked(document.pointerLockElement === host.current);
    document.addEventListener('pointerlockchange', onLock);
    return () => document.removeEventListener('pointerlockchange', onLock);
  }, []);

  // Clicking anywhere else releases keyboard focus from the game.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setActive(false);
        keys.current.clear();
      }
    };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  }, []);

  useEffect(() => {
    if (!active) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const rt = live.current.runtime;
      if (rt.dialog) return;
      if (MOVE_KEYS[e.code] || e.code.startsWith('Shift')) {
        if (MOVE_KEYS[e.code] && live.current.auto) {
          setAuto(false);
          rt.toast('자동 플레이를 껐다', 'info');
        }
        keys.current.add(e.code);
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyE':
        case 'Space':
          rt.interact();
          break;
        case 'KeyV':
          setCamMode((m) => (m === 'first' ? 'top' : 'first'));
          break;
        case 'KeyM':
          setBigMap((b) => !b);
          break;
        case 'KeyJ':
          setJournal((j) => !j);
          break;
        case 'KeyP':
          setAuto((a) => !a);
          break;
        case 'KeyR':
          onReset();
          break;
        case 'Escape':
          if (!document.pointerLockElement) setActive(false);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [active, onReset]);

  // Mouse look: pointer lock in first person, drag otherwise (and as a fallback).
  const drag = useRef<{ x: number; y: number } | null>(null);
  const turn = (dx: number, dy: number, k: number) => {
    look.current.yaw += dx * k;
    look.current.pitch = Math.max(-1.2, Math.min(1.0, look.current.pitch - dy * k));
    if (live.current.auto && Math.abs(dx) > 2) setAuto(false);
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement === host.current) turn(e.movementX, e.movementY, 0.0024);
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);

  const rt = runtime;
  const regionId = rt.region >= 0 ? rt.level.world.locIds[rt.region] : null;
  const region = regionId ? rt.byId.get(regionId) : null;
  const total = rt.level.graph.nodes.length;
  const doneCount = rt.done.size;
  const now = performance.now();
  const toasts = rt.toasts.filter((t) => now - t.at < TOAST_MS);
  const items = [...rt.inventory].map((id) => rt.byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n && ['key', 'lure', 'tool', 'ability'].includes(n.kind));
  const trackedNode = tracked ? rt.byId.get(tracked) : null;

  return (
    <div ref={root} className={`play ${active ? 'active' : ''}`}>
      <div
        ref={host}
        className="play-canvas"
        onPointerDown={(e) => {
          setActive(true);
          if (camMode === 'first' && !rt.dialog && !rt.won && e.pointerType === 'mouse') {
            host.current!.requestPointerLock?.()?.catch?.(() => {});
          }
          drag.current = { x: e.clientX, y: e.clientY };
          host.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || document.pointerLockElement) return;
          turn(e.clientX - drag.current.x, e.clientY - drag.current.y, 0.006);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => {
          if (camMode !== 'top' || !scene.current) return;
          scene.current.topZoom = Math.max(10, Math.min(70, scene.current.topZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
        }}
      />

      <div className="hud-top">
        <div className="hud-loc" style={{ ['--loc' as string]: region ? rt.level.colors[region.id] : '#4b6340' }}>
          {region ? nodeTitle(region) : '숲'}
        </div>
        <div className="hud-pill" title="경과 시간">⏱ <span ref={timerEl}>0:00</span></div>
        <div className="hud-pill" title="완료한 그래프 노드">
          ✓ {doneCount}/{total}
          <i className="bar"><i style={{ width: `${(doneCount / total) * 100}%` }} /></i>
        </div>
        <div className="spacer" />
        <button className={`hud-btn ${auto ? 'on' : ''}`} onClick={() => setAuto(!auto)} title="자동 플레이 (P): 해법 순서대로 직접 걸어가며 푼다">
          {auto ? '⏸ 자동 플레이' : '▶ 자동 플레이'}
        </button>
        <button className="hud-btn" onClick={() => setCamMode(camMode === 'first' ? 'top' : 'first')} title="시점 전환 (V)">
          {camMode === 'first' ? '👁 1인칭' : '🗺 탑뷰'}
        </button>
        <button className={`hud-btn ${journal ? 'on' : ''}`} onClick={() => setJournal(!journal)} title="수첩 (J)">
          📖 {rt.journal.length}
        </button>
        <button
          className="hud-btn"
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
          title="소리"
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="hud-btn" onClick={onReset} title="처음부터 (R)">↺</button>
      </div>

      {auto && (
        <div className="hud-auto">
          🤖 자동 플레이 중 → <span ref={autoEl} />
        </div>
      )}

      <div className="compass" ref={compassEl} style={{ display: 'none' }} title="추적 중인 대상 방향">
        <div className="arrow">▲</div>
        <div>
          <b>{trackedNode ? nodeTitle(trackedNode) : ''}</b>
          <span className="dist" />
        </div>
        <button className="icon-btn" onClick={() => onTrack(null)} title="추적 해제">✕</button>
      </div>

      {camMode === 'first' && <div className={`crosshair ${rt.prompt ? 'hot' : ''}`} />}

      {rt.prompt && !rt.dialog && !rt.won && (
        <div className={`hud-prompt ${rt.prompt.action === 'none' ? 'info' : ''}`}>
          {rt.prompt.action !== 'none' && <kbd>E</kbd>}
          {rt.prompt.text}
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>

      <div className="inventory" aria-label="소지품">
        {items.map((n) => {
          const ic = nodeIcons(n).reward!;
          return (
            <div key={n.id} className="inv-item" title={nodeTitle(n)}>
              <img src={iconUrl(ic.kind, ic.sym, ic.text)} alt="" />
              <span>{n.label || kindTerm(n.kind)}</span>
            </div>
          );
        })}
      </div>

      <Minimap runtime={rt} rev={rev} tracked={tracked} big={bigMap} onToggle={() => setBigMap(!bigMap)} />

      {journal && (
        <div className="journal">
          <div className="journal-head">
            <b>수첩</b>
            <button className="icon-btn" onClick={() => setJournal(false)}>✕</button>
          </div>
          {rt.journal.length === 0 && <p className="dlg-empty">{fmt('{hint}·{clue}·{ability:을/를} 얻으면 여기에 기록된다.')}</p>}
          {rt.journal.map((j) => (
            <div key={j.id} className={`jr jr-${j.kind}`}>
              {JOURNAL_MARK[j.kind]} {journalText(j, rt.byId)}
            </div>
          ))}
        </div>
      )}

      {!active && !rt.won && (
        <button className="click-to-play" onClick={() => setActive(true)}>
          <b>클릭해서 플레이</b>
          <span>WASD 이동 · 마우스 시점 · E 상호작용 · P 자동 플레이</span>
        </button>
      )}
      {active && !auto && camMode === 'first' && !locked && !rt.dialog && !rt.won && <div className="hint-lock">화면을 클릭하면 마우스로 시점을 돌릴 수 있다 · 드래그도 가능</div>}

      {rt.dialog?.type === 'activator' && <ActivatorDialog runtime={rt} id={rt.dialog.id} />}
      {rt.dialog?.type === 'code' && <CodeDialog runtime={rt} id={rt.dialog.id} />}

      {rt.won && (
        <div className="win">
          <div className="win-card">
            <div className="win-flag">🏁</div>
            <h2>목표 도달!</h2>
            <p>
              {fmtTime(rt.elapsed)} 만에 클리어 · 그래프 노드 {doneCount}/{total} 완료
            </p>
            <div className="row">
              <button className="btn" onClick={onReset}>↺ 다시 하기</button>
              <button className="btn primary" onClick={onNextSeed}>다음 레벨 ›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
