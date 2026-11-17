import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

/** 자원 막대 + 돈. 경고 구간(20 이하)은 색과 함께 '위험' 텍스트로도 표시한다 (§10.2). */
export function StatusPanel({ view, threshold = 20 }: { view: PublicRunView; threshold?: number }) {
  return (
    <div className="card status">
      <div className="stats">
        {RESOURCE_KEYS.map((k) => {
          const v = view.resources[k];
          const danger = v <= threshold;
          return (
            <div key={k} className={`stat ${danger ? 'stat-danger' : ''}`}>
              <span className="stat-label">{RESOURCE_LABELS[k]}</span>
              <span className="stat-bar" aria-hidden="true">
                <span style={{ width: `${v}%` }} />
              </span>
              <span className="stat-value">
                {v}
                {danger && <span className="sr-danger"> 위험</span>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="small money">
        현금 <strong>{formatKrw(view.cash)}</strong> · 빚 <strong>{formatKrw(view.debt)}</strong> · 순자산{' '}
        <strong>{formatKrw(view.netWorth)}</strong>
      </p>
    </div>
  );
}

export function Warnings({ view }: { view: PublicRunView }) {
  if (view.warnings.length === 0) return null;
  return (
    <div className="banner banner-error" role="alert">
      <strong>⚠ 위험 신호</strong>
      <ul className="warning-list">
        {view.warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}
