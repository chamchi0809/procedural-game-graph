// User-editable names for the abstract mechanics. Generated text carries `{term}` / `{term:을/를}`
// tokens that are filled in at display time, so renaming applies everywhere immediately.

import { useSyncExternalStore } from 'react';
import { josa } from './core/josa';
import type { LockKind } from './core/types';

export { josa };

export type TermKey =
  | 'location'
  | 'start'
  | 'goal'
  | 'hint'
  | 'gate.key'
  | 'key'
  | 'gate.switch'
  | 'switch'
  | 'gate.follower'
  | 'follower'
  | 'lure'
  | 'gate.ability'
  | 'tool'
  | 'ability'
  | 'activator'
  | 'gate.code'
  | 'clue';

export type Terms = Record<TermKey, string>;

/** Genre-free mechanic descriptions; `rule` is a template over the user's terms. */
export const MECHANICS: Record<LockKind, { name: string; rule: string; roles: { key: TermKey; role: string }[] }> = {
  key: {
    name: '열쇠 잠금',
    rule: '{key} 하나가 {gate.key} 하나를 연다.',
    roles: [
      { key: 'gate.key', role: '관문' },
      { key: 'key', role: '여는 아이템' },
    ],
  },
  switch: {
    name: '원격 스위치',
    rule: '흩어진 {switch:을/를} 모두 작동시키면 멀리 있는 {gate.switch:이/가} 열린다.',
    roles: [
      { key: 'gate.switch', role: '관문' },
      { key: 'switch', role: '스위치' },
    ],
  },
  follower: {
    name: '동행체 운반',
    rule: '{lure:을/를} 가지고 다가가면 {follower:이/가} 따라온다. {gate.follower}까지 데려가면 열린다.',
    roles: [
      { key: 'gate.follower', role: '관문' },
      { key: 'follower', role: '움직이는 열쇠' },
      { key: 'lure', role: '유인 아이템' },
    ],
  },
  ability: {
    name: '능력 사용',
    rule: '{tool:을/를} 가진 채 습득한 {ability:을/를} 맞는 {activator}에서 사용하면 멀리 있는 {gate.ability:이/가} 열린다.',
    roles: [
      { key: 'gate.ability', role: '관문' },
      { key: 'tool', role: '공용 도구 (하나)' },
      { key: 'ability', role: '익히는 능력' },
      { key: 'activator', role: '발동 지점' },
    ],
  },
  code: {
    name: '정보 잠금',
    rule: '흩어진 {clue:을/를} 모아 세 자리 암호를 알아내 {gate.code}에 입력한다.',
    roles: [
      { key: 'gate.code', role: '관문' },
      { key: 'clue', role: '단서' },
    ],
  },
};

export const COMMON_TERMS: { key: TermKey; role: string }[] = [
  { key: 'location', role: '지역' },
  { key: 'start', role: '시작 지역' },
  { key: 'goal', role: '목표 지역' },
  { key: 'hint', role: '힌트 (A → B 정보)' },
];

export const DEFAULT_TERMS: Terms = {
  location: '장소',
  start: '시작',
  goal: '목표',
  hint: '힌트',
  'gate.key': '잠긴 문',
  key: '열쇠',
  'gate.switch': '차단막',
  switch: '스위치',
  'gate.follower': '운반 관문',
  follower: '동행체',
  lure: '유인 아이템',
  'gate.ability': '봉인',
  tool: '도구',
  ability: '능력',
  activator: '발동대',
  'gate.code': '암호 잠금',
  clue: '단서',
};

export const TERM_PRESETS: { name: string; terms: Terms }[] = [
  { name: '추상 (기본)', terms: DEFAULT_TERMS },
  {
    name: '판타지',
    terms: {
      location: '지역',
      start: '마을',
      goal: '성소',
      hint: '표지판',
      'gate.key': '열쇠 문',
      key: '열쇠',
      'gate.switch': '마력 장벽',
      switch: '레버',
      'gate.follower': '고양이 문',
      follower: '고양이',
      lure: '먹이',
      'gate.ability': '노래 봉인',
      tool: '악기',
      ability: '노래',
      activator: '제단',
      'gate.code': '암호 자물쇠',
      clue: '석판',
    },
  },
  {
    name: 'SF',
    terms: {
      location: '구역',
      start: '격납고',
      goal: '탈출선',
      hint: '메모',
      'gate.key': '보안문',
      key: '카드키',
      'gate.switch': '역장',
      switch: '전원 스위치',
      'gate.follower': '도킹 해치',
      follower: '드론',
      lure: '배터리',
      'gate.ability': '방화벽',
      tool: '해킹 툴',
      ability: '프로그램',
      activator: '단말기',
      'gate.code': '암호 패널',
      clue: '로그',
    },
  },
  {
    name: '방탈출',
    terms: {
      location: '방',
      start: '거실',
      goal: '출구',
      hint: '쪽지',
      'gate.key': '잠긴 문',
      key: '열쇠',
      'gate.switch': '셔터',
      switch: '버튼',
      'gate.follower': '강아지 문',
      follower: '강아지',
      lure: '간식',
      'gate.ability': '비밀 장치',
      tool: '손전등',
      ability: '비밀 문양',
      activator: '거울',
      'gate.code': '번호 자물쇠',
      clue: '메모지',
    },
  },
];

const STORE_KEY = 'pgl-terms';

function load(): Terms {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* private mode or bad JSON */
  }
  return DEFAULT_TERMS;
}

function sanitize(v: unknown): Terms {
  const out = { ...DEFAULT_TERMS };
  if (v && typeof v === 'object') {
    for (const k of Object.keys(out) as TermKey[]) {
      const s = (v as Record<string, unknown>)[k];
      if (typeof s === 'string' && s.trim()) out[k] = s.trim().slice(0, 24);
    }
  }
  return out;
}

let current = load();
const listeners = new Set<() => void>();

export const getTerms = () => current;

export function setTerms(next: Partial<Terms>) {
  current = { ...current, ...next };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(current));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function replaceTerms(next: unknown) {
  setTerms(sanitize(next));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useTerms = () => useSyncExternalStore(subscribe, getTerms);

export const t = (k: TermKey) => current[k] ?? DEFAULT_TERMS[k] ?? k;
export const lockName = (lock: LockKind) => t(`gate.${lock}`);

/** Fill `{term}` and `{term:을/를}` tokens with the current names. */
export function fmt(text: string): string {
  return text.replace(/\{([a-z.]+)(?::([^}]+))?\}/g, (m, key: string, pair?: string) => {
    if (!(key in DEFAULT_TERMS)) return m;
    const w = t(key as TermKey);
    return pair ? w + josa(w, pair) : w;
  });
}
