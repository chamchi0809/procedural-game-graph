import type { GraphMode } from '../graph/GraphView';
import type { RegenTarget } from './TopBar';

interface Props {
  mode: GraphMode;
  isFinal: boolean;
  edited: boolean;
  pinned: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBlank: () => void;
  onRevert: () => void;
  onUnpin: () => void;
  onRegen: (what: RegenTarget) => void;
  onFinal: () => void;
}

export function EditBar({ mode, isFinal, edited, pinned, canUndo, canRedo, onUndo, onRedo, onBlank, onRevert, onUnpin, onRegen, onFinal }: Props) {
  return (
    <div className="edit-bar">
      <button className="icon-btn" disabled={!canUndo} onClick={onUndo} title="되돌리기 (Ctrl+Z)">↶</button>
      <button className="icon-btn" disabled={!canRedo} onClick={onRedo} title="다시 하기 (Ctrl+Shift+Z)">↷</button>
      <span className="sep" />
      {!isFinal ? (
        <>
          <span className="hint">생성 과정을 보는 중입니다. 편집은 마지막 단계에서 할 수 있습니다</span>
          <button className="btn" onClick={onFinal}>마지막 단계로</button>
        </>
      ) : mode === 'dep' ? (
        <>
          {edited ? <span className="badge edited" title="생성기 설정 대신 직접 편집한 그래프를 쓰고 있습니다">✎ 편집됨</span> : <span className="hint">노드를 클릭하면 오른쪽 패널에서 편집할 수 있습니다</span>}
          <span className="spacer" />
          {edited && (
            <button className="btn" onClick={onRevert} title="편집을 버리고 현재 시드·설정으로 다시 생성">
              생성본으로
            </button>
          )}
          <button className="btn" onClick={onBlank} title="시작 → 목표만 있는 그래프에서 직접 만들기">
            빈 그래프에서 시작
          </button>
        </>
      ) : (
        <>
          <span className="hint">노드를 끌어서 옮기면 그 자리에 📌 고정됩니다</span>
          <span className="spacer" />
          {pinned > 0 && (
            <button className="btn" onClick={onUnpin} title="고정을 모두 풀고 지금 위치에서 다시 이완">
              📌 고정 해제 ({pinned})
            </button>
          )}
          <button className="btn" onClick={() => onRegen('spatial')} title="의존성 그래프는 그대로 두고 공간 배치만 새로 생성 (S)">
            공간만 재생성
          </button>
        </>
      )}
    </div>
  );
}
