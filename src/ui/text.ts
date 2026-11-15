import type { DepEdge, DepNode, NodeKind } from '../core/types';
import { fmt, josa, lockName, t, type TermKey } from '../terms';

const KIND_TERM: Record<NodeKind, TermKey | null> = {
  start: 'start',
  location: 'location',
  goal: 'goal',
  gate: null,
  key: 'key',
  switch: 'switch',
  lure: 'lure',
  follower: 'follower',
  hint: 'hint',
  tool: 'tool',
  ability: 'ability',
  activator: 'activator',
  clue: 'clue',
};

export const EDGE_LABEL: Record<DepEdge['kind'], string> = {
  path: '장소 의존 (재작성 단계)',
  in: '그 장소 안에 있음',
  unlock: '관문이 장소를 열어줌',
  item: '필수 선행 조건',
  knowledge: '정보 (몰라도 시행착오로 가능)',
};

/** Word followed by its particle, e.g. `j('열쇠 A', '을/를')` → "열쇠 A를". */
export const j = (word: string, pair: string) => word + josa(word, pair);

export function kindTerm(kind: NodeKind): string {
  const k = KIND_TERM[kind];
  return k ? t(k) : '관문';
}

export function kindName(n: DepNode): string {
  if (n.kind === 'gate' && n.lock) return lockName(n.lock);
  return kindTerm(n.kind);
}

/** Short on-card label; start/goal labels are term tokens. */
export const shortLabel = (n: DepNode) => fmt(n.label);

export function nodeTitle(n: DepNode): string {
  if (n.kind === 'start' || n.kind === 'goal') return shortLabel(n);
  if (!n.label) return kindName(n);
  return `${kindName(n)} ${n.label}`;
}

export function describe(n: DepNode, byId: Map<string, DepNode>): string {
  const loc = byId.get(n.loc);
  const where = loc ? nodeTitle(loc) : '';
  const gate = n.gate ? byId.get(n.gate) : undefined;
  const to = gate?.to ? byId.get(gate.to) : undefined;
  const target = to ? nodeTitle(to) : '';
  const gateName = gate ? nodeTitle(gate) : '';
  switch (n.kind) {
    case 'start':
      return '플레이어가 시작하는 장소.';
    case 'goal':
      return '도달하면 클리어. 모든 경로는 결국 여기로 이어진다.';
    case 'location':
      return '관문 하나를 통해 들어가는 지역. 안에 다른 관문을 여는 물건이 숨어 있을 수 있다.';
    case 'gate': {
      const dest = byId.get(n.to!);
      const destName = dest ? nodeTitle(dest) : '';
      const how: Record<string, string> = {
        key: `같은 무늬의 ${j(t('key'), '을/를')} 가지고 다가가면 열린다.`,
        switch: `같은 무늬의 ${j(t('switch'), '을/를')} 전부 작동시키면 원격으로 열린다.`,
        follower: `같은 무늬의 ${j(t('follower'), '을/를')} ${j(t('lure'), '으로/로')} 유인해 관문 앞까지 데려오면 열린다.`,
        ability: `같은 무늬의 ${t('activator')}에서 맞는 ${j(t('ability'), '을/를')} 사용하면 열린다 (${t('tool')} 필요).`,
        code: `세 자리 암호. 같은 무늬의 ${t('clue')}에 숫자가 흩어져 있다.`,
      };
      return `${where}에서 ${j(destName, '으로/로')} 가는 길을 막는다. ${how[n.lock!]}`;
    }
    case 'key':
      return `${where}에 있다. ${j(target, '으로/로')} 가는 ${j(gateName, '을/를')} 연다. 관문과 멀리 떨어져 있을 수 있다.`;
    case 'switch':
      return `${where}에 있다. 같은 무늬의 ${j(t('switch'), '을/를')} 모두 작동시키면 ${target} 앞 ${j(gateName, '이/가')} 열린다.`;
    case 'lure': {
      const c = [...byId.values()].find((m) => m.wants === n.id);
      return `${where}에 있다. 가지고 있으면 ${c ? j(nodeTitle(c), '이/가') : ''} 따라온다.`;
    }
    case 'follower':
      return `${where}에 있다. 맞는 ${j(t('lure'), '을/를')} 가지고 다가가면 따라온다. ${target} 앞 관문까지 데려가야 한다.`;
    case 'hint': {
      const a = byId.get(n.hintA!);
      const b = byId.get(n.hintB!);
      return `${where}에 있다. "${a ? nodeTitle(a) : ''} → ${b ? nodeTitle(b) : ''}" 관계를 알려준다. 정보일 뿐이라 없어도 시행착오로 풀 수 있다.`;
    }
    case 'tool':
      return `${where}에 있다. ${t('activator')}에서 ${j(t('ability'), '을/를')} 쓰려면 필요하다. 여러 관문에서 재사용된다.`;
    case 'ability':
      return `${where}에 있다. 습득하면 ${t('activator')}에서 사용할 수 있다.`;
    case 'activator':
      return `${where}에 있다. 맞는 ${j(t('ability'), '을/를')} 사용하면 ${target} 앞 ${j(gateName, '이/가')} 열린다.`;
    case 'clue':
      return `${where}에 있다. ${target} 앞 ${gateName} 암호의 ${n.reveals!.map((r) => r + 1).join(', ')}번째 자리를 알려준다.`;
  }
}

/** Journal / hint sentence for a hint node: what A does for B. */
export function hintText(n: DepNode, byId: Map<string, DepNode>): string {
  const a = byId.get(n.hintA!)!;
  const b = byId.get(n.hintB!)!;
  return a.kind === 'lure'
    ? `${j(nodeTitle(b), '은/는')} ${j(nodeTitle(a), '을/를')} 가지고 있으면 따라온다`
    : `${j(nodeTitle(b), '은/는')} ${nodeTitle(a)}에 반응한다`;
}

/** Revealed digits of a clue, unknown positions as "_". */
export function clueDigits(n: DepNode, byId: Map<string, DepNode>): string {
  const g = byId.get(n.gate!)!;
  return [0, 1, 2].map((i) => (n.reveals!.includes(i) ? String(g.code![i]) : '_')).join(' ');
}

export function clueText(n: DepNode, byId: Map<string, DepNode>): string {
  return `${nodeTitle(byId.get(n.gate!)!)}: ${clueDigits(n, byId)}`;
}

export function journalText(e: { id: string; kind: 'clue' | 'hint' | 'ability' }, byId: Map<string, DepNode>): string {
  const n = byId.get(e.id)!;
  if (e.kind === 'clue') return clueText(n, byId);
  if (e.kind === 'hint') return hintText(n, byId);
  return nodeTitle(n);
}

export const JOURNAL_MARK = { clue: '🔢', hint: '💡', ability: '✦' } as const;
