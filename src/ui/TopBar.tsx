import { useEffect, useState } from 'react';
import { randomSeedWord } from '../core/rng';
import { LOCK_KINDS, type GenParams, type Level, type LockKind } from '../core/types';
import { iconUrl, type IconKind } from '../icons';
import { fmt, getTerms, lockName, MECHANICS, useTerms } from '../terms';

export const LOCK_ICON: Record<LockKind, IconKind> = { key: 'door', switch: 'barrier', follower: 'followdoor', ability: 'seal', code: 'dial' };

const LOC_PICKS = [2, 3, 4, 6, 8, 12];
export type RegenTarget = 'all' | 'dep' | 'spatial';

function bumpSeed(seed: string, d: number): string {
  const m = seed.match(/^(.*?)(\d+)$/);
  if (!m) return `${seed}-${d > 0 ? 1 : 0}`;
  return `${m[1]}${Math.max(0, Number(m[2]) + d)}`;
}

interface Props {
  params: GenParams;
  level: Level | null;
  error: string | null;
  onChange: (p: GenParams) => void;
  onRegen: (what: RegenTarget) => void;
  onHelp: () => void;
  onTerms: () => void;
}

export function TopBar({ params, level, error, onChange, onRegen, onHelp, onTerms }: Props) {
  useTerms();
  const [seedDraft, setSeedDraft] = useState(params.seed);
  const [locDraft, setLocDraft] = useState(params.locations);
  const [remDraft, setRemDraft] = useState(params.remoteness);
  const [cxDraft, setCxDraft] = useState(params.complexity);
  const [copied, setCopied] = useState(false);

  useEffect(() => setSeedDraft(params.seed), [params.seed]);
  useEffect(() => setLocDraft(params.locations), [params.locations]);
  useEffect(() => setRemDraft(params.remoteness), [params.remoteness]);
  useEffect(() => setCxDraft(params.complexity), [params.complexity]);

  // Sliders regenerate after a short pause so dragging stays smooth.
  useEffect(() => {
    if (locDraft === params.locations && remDraft === params.remoteness && cxDraft === params.complexity) return;
    if (!(locDraft >= 2 && locDraft <= 20)) return;
    const t = setTimeout(() => onChange({ ...params, locations: Math.round(locDraft), remoteness: remDraft, complexity: cxDraft }), 300);
    return () => clearTimeout(t);
  }, [locDraft, remDraft, cxDraft, params, onChange]);

  const setSeed = (seed: string) => onChange({ ...params, seed: seed.trim() || randomSeedWord() });
  const toggleMech = (k: LockKind) => {
    const has = params.mechanics.includes(k);
    if (has && params.mechanics.length === 1) return;
    onChange({ ...params, mechanics: has ? params.mechanics.filter((m) => m !== k) : LOCK_KINDS.filter((m) => m === k || params.mechanics.includes(m)) });
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      prompt('이 주소를 복사하세요', location.href);
    }
  };

  const exportJson = () => {
    if (!level) return;
    const { snapshots: _s, ...rest } = level;
    const blob = new Blob([JSON.stringify({ ...rest, terms: getTerms() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `level-${params.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <header className="topbar">
      <div className="brand" title="Rune Skovbo Johansen, “Procedural game progression dependency graphs” (2024) 기반">
        <span className="brand-mark">◆</span>
        <span>진행 그래프 실험실</span>
      </div>

      <div className="group seed-group">
        <button className="icon-btn" title="이전 시드 ([)" onClick={() => setSeed(bumpSeed(params.seed, -1))}>‹</button>
        <input
          className="seed"
          value={seedDraft}
          spellCheck={false}
          aria-label="시드"
          title="시드: 같은 시드 + 같은 설정 = 같은 레벨"
          onChange={(e) => setSeedDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSeed(seedDraft)}
          onBlur={() => seedDraft !== params.seed && setSeed(seedDraft)}
        />
        <button className="icon-btn" title="다음 시드 (])" onClick={() => setSeed(bumpSeed(params.seed, 1))}>›</button>
      </div>

      <div className="group regen" role="group" aria-label="재생성">
        <button className="btn primary" title="의존성 그래프와 공간 그래프를 모두 새로 생성 (N)" onClick={() => onRegen('all')}>
          🎲 새로 생성
        </button>
        <button className="btn" title="의존성 그래프만 새로 생성. 공간 시드는 유지 (D)" onClick={() => onRegen('dep')}>
          의존성만
        </button>
        <button className="btn" title="지금 의존성 그래프는 그대로 두고 공간 배치만 새로 생성 (S)" onClick={() => onRegen('spatial')}>
          공간만
        </button>
      </div>

      <div className="group loc-pick" role="group" aria-label={fmt('{location} 개수')} title={fmt('{location} 개수 ({start}/{goal} 포함). 직접 편집한 그래프에는 적용되지 않는다')}>
        <span>{fmt('{location}')}</span>
        <div className="seg">
          {LOC_PICKS.map((n) => (
            <button key={n} className={!level?.edited && params.locations === n ? 'on' : ''} onClick={() => onChange({ ...params, locations: n })}>
              {n}
            </button>
          ))}
        </div>
        <input
          type="number"
          className="loc-num"
          min={2}
          max={20}
          value={Number.isFinite(locDraft) ? locDraft : ''}
          aria-label={fmt('{location} 개수 직접 입력')}
          onChange={(e) => setLocDraft(e.target.valueAsNumber)}
          onBlur={() => !(locDraft >= 2 && locDraft <= 20) && setLocDraft(params.locations)}
        />
      </div>

      <label className="group slider" title="선행 조건을 바로 앞이 아닌 더 먼 조상 지역에 숨길 확률. 높을수록 오가는 동선이 길어진다">
        <span>원거리 배치 <b>{Math.round(remDraft * 100)}%</b></span>
        <input type="range" min={0} max={1} step={0.05} value={remDraft} onChange={(e) => setRemDraft(Number(e.target.value))} />
      </label>

      <label className="group slider" title="0%: 갈림길 없는 일직선, 관문마다 아이템 하나. 높을수록 병렬 갈림길과 여러 아이템이 필요한 관문이 늘어난다">
        <span>복잡도 <b>{Math.round(cxDraft * 100)}%</b></span>
        <input type="range" min={0} max={1} step={0.05} value={cxDraft} onChange={(e) => setCxDraft(Number(e.target.value))} />
      </label>

      <div className="group chips" role="group" aria-label="메커니즘">
        {LOCK_KINDS.map((k) => (
          <button key={k} className={`chip ${params.mechanics.includes(k) ? 'on' : ''}`} title={`${MECHANICS[k].name}: ${fmt(MECHANICS[k].rule)}`} aria-pressed={params.mechanics.includes(k)} onClick={() => toggleMech(k)}>
            <img src={iconUrl(LOCK_ICON[k], 3)} alt="" />
            {lockName(k)}
          </button>
        ))}
        <button className={`chip ${params.hints ? 'on' : ''}`} title={fmt('{hint} 배치: 어떤 아이템이 어디에 쓰이는지 알려주는 정보 의존성')} aria-pressed={params.hints} onClick={() => onChange({ ...params, hints: !params.hints })}>
          <img src={iconUrl('info')} alt="" />
          {fmt('{hint}')}
        </button>
        <button className="chip action" title="메커니즘 이름을 원하는 장르에 맞게 바꾸기" onClick={onTerms}>
          🏷 용어
        </button>
      </div>

      <div className="spacer" />

      {error ? (
        <div className="stats error" title={error}>생성 실패: 설정을 바꿔보세요</div>
      ) : (
        level && (
          <div className="stats" title={`생성 ${level.stats.ms.toFixed(0)}ms · 시도 ${level.attempts}회`}>
            노드 <b>{level.stats.nodes}</b> · 간선 <b>{level.stats.edges}</b> · 깊이 <b>{level.stats.maxDepth}</b> · 분기 <b>{level.stats.branching.toFixed(1)}</b>
          </div>
        )
      )}
      <button className="btn" onClick={share} title="현재 설정이 담긴 링크 복사">{copied ? '복사됨 ✓' : '🔗 공유'}</button>
      <button className="btn" onClick={exportJson} disabled={!level} title="레벨 데이터를 JSON으로 저장">⤓ JSON</button>
      <button className="icon-btn help" onClick={onHelp} title="도움말 (?)">?</button>
    </header>
  );
}
