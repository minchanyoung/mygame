import type { PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onApply: (offerId: string) => void;
}

const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);

export function JobOffers({ view, busy, onApply }: Props) {
  return (
    <section className="screen">
      <h2>어디에 지원할까요?</h2>
      <p className="muted">
        합격률은 정확한 값입니다. 다른 회사에 떨어지면 정신력이 조금 깎이고, &lsquo;합격 확정&rsquo; 회사로
        자동 입사합니다.
      </p>
      <div className="card-list">
        {view.jobOffers.map((o) => (
          <article key={o.offerId} className="card">
            <div className="card-head">
              <span className={`grade grade-${o.grade}`}>{o.grade}</span>
              <strong>{o.companyName}</strong>
              <span className="chip">{o.jobLabel}</span>
              {o.guaranteed && <span className="chip chip-accent">합격 확정</span>}
            </div>
            <p className="muted small">
              {o.industry} · {o.companyDescription}
            </p>
            <div className="offer-numbers">
              <div>
                <span className="muted small">합격률</span>
                <strong className="big">{o.hireChancePercent}%</strong>
              </div>
              <div>
                <span className="muted small">제시 연봉</span>
                <strong className="big">{formatKrw(o.annualSalary)}</strong>
              </div>
            </div>
            <p className="small">
              업무강도 <span aria-label={`${o.workload}/5`}>{dots(o.workload)}</span> · 안정성{' '}
              <span aria-label={`${o.stability}/5`}>{dots(o.stability)}</span>
            </p>
            <details>
              <summary className="small">합격률 근거</summary>
              <ul className="small">
                {o.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onApply(o.offerId)}
            >
              {busy ? '심사 중…' : '지원하기'}
            </button>
          </article>
        ))}
      </div>
      <p className="muted small">※ 모든 연봉·확률은 게임 밸런스용 가상 수치입니다.</p>
    </section>
  );
}
