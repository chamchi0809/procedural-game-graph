import { useEffect } from 'react';
import { LOCK_KINDS } from '../core/types';
import { iconUrl } from '../icons';
import { COMMON_TERMS, DEFAULT_TERMS, fmt, MECHANICS, setTerms, TERM_PRESETS, useTerms, type TermKey, type Terms } from '../terms';
import { LOCK_ICON } from './TopBar';

const same = (a: Terms, b: Terms) => (Object.keys(a) as TermKey[]).every((k) => a[k] === b[k]);

function Field({ k, role }: { k: TermKey; role: string }) {
  const terms = useTerms();
  return (
    <label className="term-field">
      <span>{role}</span>
      <input
        value={terms[k]}
        placeholder={DEFAULT_TERMS[k]}
        maxLength={24}
        spellCheck={false}
        onChange={(e) => setTerms({ [k]: e.target.value })}
        onBlur={(e) => !e.target.value.trim() && setTerms({ [k]: DEFAULT_TERMS[k] })}
      />
    </label>
  );
}

export function TermsModal({ onClose }: { onClose: () => void }) {
  const terms = useTerms();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal terms" role="dialog" aria-modal="true" aria-label="용어 설정" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="닫기">✕</button>
        <h2>용어 설정</h2>
        <p className="tip">
          생성기는 장르와 무관한 추상 메커니즘만 다룬다. 여기서 붙인 이름이 그래프·3D 월드·안내 문구 전체에 바로 반영된다.
        </p>
        <div className="seg term-presets" role="group" aria-label="용어 테마">
          {TERM_PRESETS.map((p) => (
            <button key={p.name} className={same(terms, p.terms) ? 'on' : ''} onClick={() => setTerms(p.terms)}>
              {p.name}
            </button>
          ))}
        </div>

        <section className="term-group">
          <h3>공통</h3>
          <div className="term-grid">
            {COMMON_TERMS.map((r) => <Field key={r.key} k={r.key} role={r.role} />)}
          </div>
        </section>
        {LOCK_KINDS.map((lock) => {
          const m = MECHANICS[lock];
          return (
            <section className="term-group" key={lock}>
              <h3>
                <img src={iconUrl(LOCK_ICON[lock], 3)} alt="" />
                {m.name}
              </h3>
              <p className="term-rule">{fmt(m.rule)}</p>
              <div className="term-grid">
                {m.roles.map((r) => <Field key={r.key} k={r.key} role={r.role} />)}
              </div>
            </section>
          );
        })}
        <div className="row">
          <button className="btn" onClick={() => setTerms(DEFAULT_TERMS)}>기본값으로</button>
          <button className="btn primary" onClick={onClose}>완료</button>
        </div>
      </div>
    </div>
  );
}
