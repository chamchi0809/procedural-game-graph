import { useEffect } from 'react';
import { LOCK_KINDS } from '../core/types';
import { fmt, lockName, useTerms } from '../terms';

const keys = (): [string, string][] => [
  ['클릭', '3D 화면 조작 시작 (마우스로 시점)'],
  ['W A S D / 방향키', '이동'],
  ['Shift', '달리기'],
  ['E / Space', fmt('상호작용 ({switch}·{activator}·{gate.code})')],
  ['V', '1인칭 ↔ 탑뷰 전환'],
  ['M', '미니맵 크게 보기'],
  ['J', fmt('수첩 ({clue}·{hint}·{ability})')],
  ['P', '자동 플레이 켜기/끄기'],
  ['R', '처음부터 다시'],
  ['Esc', '마우스 풀기 · 창 닫기'],
  ['N / D / S', '새로 생성 · 의존성만 · 공간만 재생성'],
  ['[ / ]', '이전 · 다음 시드'],
  ['Ctrl+Z / Ctrl+Shift+Z', '편집 되돌리기 · 다시 하기'],
  ['Delete', fmt('선택한 {location} 삭제')],
  [', / .', '생성 과정 이전·다음 단계'],
  ['1 / 2', '의존성 그래프 · 공간 그래프 탭'],
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  useTerms();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help" role="dialog" aria-modal="true" aria-label="도움말" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="닫기">✕</button>
        <h2>진행 그래프 실험실</h2>
        <p>
          Rune Skovbo Johansen의 글 <a href="https://blog.runevision.com/2024/10/procedural-game-progression-dependency.html" target="_blank" rel="noreferrer">“Procedural game progression dependency graphs”</a>의 결론을 그대로 구현했다.
          하나의 의존성 그래프에서 퍼즐 구조와 공간 배치가 함께 나오고, 그 결과가 바로 플레이 가능한 3D 레벨이 된다.
        </p>
        <ol className="steps">
          <li><b>장소 재작성</b> — 시작→목표 간선 하나에서 출발해, 간선 하나를 골라 평행한 두 장소 A·B로 바꾸고 주변 연결을 다시 거는 규칙을 반복한다. 항상 사이클 없는 DAG가 유지된다.</li>
          <li><b>메커니즘 주입</b> — 각 장소로 들어가는 길목에 관문({LOCK_KINDS.map(lockName).join(', ')})을 세우고, 여는 데 필요한 물건을 그 장소의 <i>조상</i> 장소에 숨긴다. 그래서 언제나 풀 수 있다.</li>
          <li><b>공간 배치</b> — 완성된 의존성 그래프의 노드를 입구 장소 옆에 놓고 짧은 거리 반발력으로 이완시킨 뒤, 보로노이 셀로 지역을 나눠 다른 장소 사이에 벽을, 관문 자리에 문을 낸다.</li>
          <li><b>편집</b> — 마지막 단계에서 노드를 클릭하면 오른쪽 패널에서 장소 추가·연결·삭제, 관문 종류, 물건 위치를 바꿀 수 있다. 공간 그래프에서는 노드를 끌어 옮기면 그 자리에 고정된다. <b>의존성만</b>/<b>공간만</b> 버튼으로 두 그래프를 따로 재생성할 수 있어서, 직접 만든 의존성 그래프에 공간 배치만 무작위로 뽑을 수도 있다.</li>
          <li><b>용어</b> — 메커니즘은 장르와 무관한 추상 규칙이다. 상단 <b>🏷 용어</b>에서 이름을 판타지·SF 등 원하는 세계관에 맞게 바꿀 수 있다.</li>
          <li><b>플레이</b> — 그래프와 3D 월드는 같은 데이터다. 그래프 노드를 클릭해 <i>추적</i>하면 월드에 표시되고, 플레이 진행이 그래프에 실시간으로 칠해진다.</li>
        </ol>
        <h3>조작</h3>
        <table className="keys">
          <tbody>
            {keys().map(([k, v]) => (
              <tr key={k}>
                <td><kbd>{k}</kbd></td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tip">팁: 막히면 <kbd>P</kbd>로 자동 플레이를 켜서 해법을 구경하거나, 그래프에서 초록(지금 가능) 노드를 찾아 추적해보자.</p>
        <button className="btn primary wide" onClick={onClose}>시작하기</button>
      </div>
    </div>
  );
}
