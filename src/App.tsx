import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { blankSpec, connect, EditError, removeLocation } from './core/edit';
import { assembleLevel, DEFAULT_PARAMS, dependencyFromSpec, generateDependency, generateSpatial, isLocationKind, type Dependency } from './core/generate';
import { GOAL, START } from './core/locations';
import { randomSeedWord } from './core/rng';
import type { DepSpec, GenParams, Level, Vec2 } from './core/types';
import { GameRuntime } from './game/runtime';
import { GraphView, type GraphMode } from './graph/GraphView';
import { PlayPanel } from './play/PlayPanel';
import { EditBar } from './ui/EditBar';
import { HelpModal } from './ui/HelpModal';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { TermsModal } from './ui/TermsModal';
import { docFromHash, docToHash, type Doc } from './ui/params';
import { Timeline } from './ui/Timeline';
import { TopBar, type RegenTarget } from './ui/TopBar';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function bump(seed: string) {
  const m = seed.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${seed}-1`;
}

const sameGenerator = (a: GenParams, b: GenParams) =>
  a.seed === b.seed && a.locations === b.locations && a.remoteness === b.remoteness && a.complexity === b.complexity && a.mechanics.join() === b.mechanics.join();

export type SpecEdit = (spec: DepSpec) => DepSpec | { spec: DepSpec; id: string };

const DEFAULT_DOC: Doc = { params: DEFAULT_PARAMS, spatialSeed: DEFAULT_PARAMS.seed, spec: null, layout: null };

export function App() {
  const [doc, setDoc] = useState<Doc>(() => docFromHash(location.hash));
  const docRef = useRef(doc);
  docRef.current = doc;
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);

  // Dragging and editing rebuild often; cache both stages so undo and re-renders are instant.
  const depCache = useRef(new Map<string, Dependency>());
  const levelCache = useRef(new Map<string, Level>());
  const build = useCallback((d: Doc): Level => {
    const key = JSON.stringify(d);
    const hit = levelCache.current.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const depKey = JSON.stringify(d.spec ?? d.params);
    let dep = depCache.current.get(depKey);
    if (!dep) {
      dep = d.spec ? dependencyFromSpec(d.spec) : generateDependency(d.params);
      if (depCache.current.size > 40) depCache.current.clear();
      depCache.current.set(depKey, dep);
    }
    const level = assembleLevel(d.params, dep, d.spatialSeed, generateSpatial(dep, d.spatialSeed, d.layout), performance.now() - t0);
    if (levelCache.current.size > 40) levelCache.current.clear();
    levelCache.current.set(key, level);
    return level;
  }, []);

  const lastGood = useRef<Level | null>(null);
  // A failed generation keeps showing the previous level instead of blanking the page.
  const { level, error } = useMemo(() => {
    try {
      const l = build(doc);
      lastGood.current = l;
      return { level: l, error: null };
    } catch (e) {
      console.error(e);
      return { level: lastGood.current ?? build(DEFAULT_DOC), error: String(e) };
    }
  }, [doc, build]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const notify = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const [, setHistRev] = useState(0);
  const commit = useCallback((next: Doc) => {
    past.current.push(docRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setDoc(next);
    setHistRev((r) => r + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    setDoc(prev);
    setHistRev((r) => r + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    setDoc(next);
    setHistRev((r) => r + 1);
  }, []);

  useEffect(() => {
    const h = docToHash(doc);
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [doc]);
  useEffect(() => {
    const on = () => commit(docFromHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [commit]);

  const changeParams = useCallback(
    (p: GenParams) => {
      const d = docRef.current;
      if (d.spec && sameGenerator(d.params, p)) {
        commit({ ...d, params: p, spec: { ...d.spec, hints: p.hints } });
        return;
      }
      if (d.spec) notify('직접 편집한 의존성 그래프 대신 새로 생성했습니다. Ctrl+Z로 되돌릴 수 있습니다');
      commit({ ...d, params: p, spec: null, layout: null });
    },
    [commit, notify],
  );

  const regen = useCallback(
    (what: RegenTarget) => {
      const d = docRef.current;
      if (what === 'spatial') {
        commit({ ...d, spatialSeed: randomSeedWord(), layout: null });
        return;
      }
      if (d.spec) notify('직접 편집한 의존성 그래프 대신 새로 생성했습니다. Ctrl+Z로 되돌릴 수 있습니다');
      const params = { ...d.params, seed: randomSeedWord() };
      commit({ params, spatialSeed: what === 'all' ? params.seed : d.spatialSeed, spec: null, layout: null });
    },
    [commit, notify],
  );

  const [resetKey, setResetKey] = useState(0);
  const runtime = useMemo(() => new GameRuntime(level), [level, resetKey]);
  const rev = useSyncExternalStore(runtime.subscribe, runtime.getRev);
  if (import.meta.env.DEV) (window as unknown as { __rt: GameRuntime }).__rt = runtime;

  const [snapIndex, setSnapIndex] = useState(level.snapshots.length - 1);
  useEffect(() => setSnapIndex(level.snapshots.length - 1), [level]);
  const snapshot = level.snapshots[Math.min(snapIndex, level.snapshots.length - 1)];
  const isFinal = snapIndex >= level.snapshots.length - 1;

  const [mode, setMode] = useState<GraphMode>('dep');
  const [showStatus, setShowStatus] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tracked, setTracked] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  useEffect(() => {
    const has = (id: string | null) => !!id && level.graph.nodes.some((n) => n.id === id);
    setSelected((s) => (has(s) ? s : null));
    setTracked((s) => (has(s) ? s : null));
    setConnectFrom((s) => (has(s) ? s : null));
  }, [level]);

  const levelRef = useRef(level);
  levelRef.current = level;

  /** Apply a spec edit, keeping the current spatial layout as a starting point when possible. */
  const editSpec = useCallback(
    (fn: SpecEdit) => {
      const lv = levelRef.current;
      const d = docRef.current;
      let res: ReturnType<SpecEdit>;
      try {
        res = fn(lv.spec);
      } catch (e) {
        if (e instanceof EditError) return notify(e.message);
        throw e;
      }
      const spec = 'locs' in res ? res : res.spec;
      let next: Doc = { ...d, spec, layout: { pos: lv.spatial, fixed: d.layout?.fixed ?? [] } };
      try {
        build(next);
      } catch {
        next = { ...next, layout: null };
        try {
          build(next);
          notify('기존 공간 배치를 유지할 수 없어서 새로 배치했습니다');
        } catch (e) {
          console.error(e);
          return notify('이 편집으로는 레벨을 만들 수 없습니다');
        }
      }
      commit(next);
      if (!('locs' in res)) setSelected(res.id);
    },
    [build, commit, notify],
  );

  const moveNode = useCallback(
    (id: string, to: Vec2) => {
      const lv = levelRef.current;
      const d = docRef.current;
      const node = lv.graph.nodes.find((n) => n.id === id);
      if (!node) return;
      const from = lv.world.objects[id] ?? lv.spatial[id];
      const pos = { ...lv.spatial, [id]: to };
      // A location carries its contents along.
      if (isLocationKind(node.kind)) {
        for (const n of lv.graph.nodes) {
          if (n.loc !== id || n.id === id || n.kind === 'gate' || !lv.spatial[n.id]) continue;
          pos[n.id] = { x: lv.spatial[n.id].x + to.x - from.x, y: lv.spatial[n.id].y + to.y - from.y };
        }
      }
      const next: Doc = { ...d, layout: { pos, fixed: [...new Set([...(d.layout?.fixed ?? []), id])] } };
      try {
        build(next);
        commit(next);
      } catch {
        notify('그 위치로는 옮길 수 없습니다. 월드를 만들 수 없는 배치입니다');
      }
    },
    [build, commit, notify],
  );

  const unpinAll = useCallback(() => {
    const d = docRef.current;
    if (d.layout?.fixed.length) commit({ ...d, layout: { pos: levelRef.current.spatial, fixed: [] } });
  }, [commit]);
  const startBlank = useCallback(() => {
    const d = docRef.current;
    commit({ ...d, spec: blankSpec(d.params.hints), layout: null });
    setSelected(START);
  }, [commit]);
  const revertToGenerated = useCallback(() => {
    const d = docRef.current;
    commit({ ...d, spec: null, layout: null });
  }, [commit]);

  const connectTo = useCallback(
    (target: string | null) => {
      const from = connectFrom;
      setConnectFrom(null);
      if (from && target) editSpec((s) => connect(s, from, target));
    },
    [connectFrom, editSpec],
  );

  const [help, setHelp] = useState(() => store.get('pgl-help-seen') !== '1');
  const closeHelp = useCallback(() => {
    setHelp(false);
    store.set('pgl-help-seen', '1');
  }, []);

  const [termsOpen, setTermsOpen] = useState(false);

  const [split, setSplit] = useState(() => Number(store.get('pgl-split')) || 0.5);
  const mainRef = useRef<HTMLElement>(null);
  const startSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = mainRef.current!;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setSplit(Math.min(0.75, Math.max(0.25, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => store.set('pgl-split', String(split)), [split]);

  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  const nextSeed = useCallback(() => changeParams({ ...docRef.current.params, seed: bump(docRef.current.params.seed) }), [changeParams]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (document.querySelector('.play.active, .modal-backdrop')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (k === 'z' && !e.shiftKey) undo();
        else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const last = level.snapshots.length - 1;
      switch (e.key) {
        case 'n':
        case 'N':
          regen('all');
          break;
        case 'd':
        case 'D':
          regen('dep');
          break;
        case 's':
        case 'S':
          regen('spatial');
          break;
        case '[':
          changeParams({ ...docRef.current.params, seed: docRef.current.params.seed.replace(/(\d+)$/, (x) => String(Math.max(0, Number(x) - 1))) });
          break;
        case ']':
          nextSeed();
          break;
        case ',':
          setSnapIndex((i) => Math.max(0, i - 1));
          break;
        case '.':
          setSnapIndex((i) => Math.min(last, i + 1));
          break;
        case '1':
          setMode('dep');
          break;
        case '2':
          setMode('spatial');
          break;
        case '?':
          setHelp(true);
          break;
        case 'Delete':
          if (!isFinal || !selected || selected === START || selected === GOAL || !level.spec.locs.includes(selected)) return;
          editSpec((s) => removeLocation(s, selected));
          break;
        case 'Escape':
          if (connectFrom) setConnectFrom(null);
          else setSelected(null);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [level, nextSeed, regen, changeParams, undo, redo, isFinal, selected, connectFrom, editSpec]);

  return (
    <div className="app">
      <TopBar params={doc.params} level={level} error={error} onChange={changeParams} onRegen={regen} onHelp={() => setHelp(true)} onTerms={() => setTermsOpen(true)} />
      <main ref={mainRef} className="split" style={{ ['--split' as string]: `${split * 100}%` }}>
        <section className="pane graph-pane">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'dep'} className={mode === 'dep' ? 'on' : ''} onClick={() => setMode('dep')} title="퍼즐 구조 (1)">
              의존성 그래프
            </button>
            <button role="tab" aria-selected={mode === 'spatial'} className={mode === 'spatial' ? 'on' : ''} onClick={() => setMode('spatial')} title="같은 그래프의 공간 배치 (2)">
              공간 그래프
            </button>
            <div className="spacer" />
            <label className="toggle" title="3D 플레이 진행 상황을 그래프에 칠한다 (최종 단계에서만)">
              <input type="checkbox" checked={showStatus} onChange={(e) => setShowStatus(e.target.checked)} />
              진행 상황 표시
            </label>
          </div>
          <EditBar
            mode={mode}
            isFinal={isFinal}
            edited={level.edited}
            pinned={doc.layout?.fixed.length ?? 0}
            canUndo={past.current.length > 0}
            canRedo={future.current.length > 0}
            onUndo={undo}
            onRedo={redo}
            onBlank={startBlank}
            onRevert={revertToGenerated}
            onUnpin={unpinAll}
            onRegen={regen}
            onFinal={() => setSnapIndex(level.snapshots.length - 1)}
          />
          <div className="graph-wrap">
            <GraphView
              level={level}
              snapshot={snapshot}
              isFinal={isFinal}
              mode={mode}
              runtime={runtime}
              rev={rev}
              showStatus={showStatus}
              selected={selected}
              tracked={tracked}
              pinned={doc.layout?.fixed}
              connectFrom={connectFrom}
              onSelect={setSelected}
              onConnectTo={connectTo}
              onMoveNode={moveNode}
            />
            <Legend />
            {selected && (
              <Inspector
                graph={snapshot.graph}
                id={selected}
                colors={level.colors}
                runtime={isFinal ? runtime : null}
                tracked={tracked}
                canTrack={isFinal && !!level.world.objects[selected]}
                onSelect={setSelected}
                onTrack={setTracked}
                edit={isFinal ? { spec: level.spec, onEdit: editSpec, onConnect: setConnectFrom, connecting: connectFrom === selected } : null}
              />
            )}
            {toast && (
              <div className="toast" role="status">
                {toast}
              </div>
            )}
          </div>
          <Timeline snapshots={level.snapshots} index={Math.min(snapIndex, level.snapshots.length - 1)} onIndex={setSnapIndex} />
        </section>
        <div className="splitter" onPointerDown={startSplit} onDoubleClick={() => setSplit(0.5)} title="드래그해서 크기 조절 · 더블클릭: 반반" />
        <section className="pane play-pane">
          <PlayPanel runtime={runtime} rev={rev} tracked={tracked} onTrack={setTracked} onReset={reset} onNextSeed={nextSeed} />
        </section>
      </main>
      {help && <HelpModal onClose={closeHelp} />}
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
    </div>
  );
}
