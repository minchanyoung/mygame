import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { StatusPanel, Warnings } from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onNext: () => void;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const signedKrw = (n: number) => (n > 0 ? `+${formatKrw(n)}` : n < 0 ? `-${formatKrw(-n)}` : '0원');

/** MONTH_SUMMARY: 사건 결과 → 정산 → 변화량. 실직이 예고되면 원인을 먼저 보여준다 (§26.2). */
export function MonthSummary({ view, busy, onNext }: Props) {
  const m = view.monthSummary;
  const ending = view.pendingEnding;
  const ev = m?.event;
  const deltas = m ? RESOURCE_KEYS.filter((k) => m.resourceDelta[k] !== 0) : [];

  return (
    <section className="screen">
      <h2>
        {view.turn.age}세 {view.turn.monthOfYear}월 결산
      </h2>

      {ev && (
        <article className="card">
          <p className="muted small">{ev.title}</p>
          <strong>
            {ev.success === true && '✅ 성공 — '}
            {ev.success === false && '❌ 실패 — '}
            {ev.choiceLabel}
          </strong>
          {ev.resultText && <p>{ev.resultText}</p>}
          {ev.traitChanges.length > 0 && (
            <ul className="trait-change">
              {ev.traitChanges.map((t) => (
                <li key={t}>🌟 {t}</li>
              ))}
            </ul>
          )}
        </article>
      )}

      {ending && (
        <div
          className={`card ending-notice ${ending.category === 'FAILURE' ? 'ending-fail' : 'ending-normal'}`}
        >
          <strong>{ending.category === 'FAILURE' ? '💼 이번 달을 끝으로…' : '🌅 직장 생활의 끝'}</strong>
          <p>
            <strong>{ending.title}</strong> — {ending.text}
          </p>
        </div>
      )}

      {m?.annualReview && (
        <div className="card review">
          <strong>📋 연말 인사평가</strong>
          <p>
            올해 평가 등급은{' '}
            <span className={`grade grade-${m.annualReview.grade}`}>{m.annualReview.grade}</span>
            {m.annualReview.reputationDelta !== 0 && ` (평판 ${signed(m.annualReview.reputationDelta)})`}.
            다음 1월 연봉에 반영됩니다.
          </p>
        </div>
      )}

      {m?.salaryAdjustment && (
        <div className="card review">
          <strong>💰 연봉 조정</strong>
          <p>
            {m.salaryAdjustment.grade && `지난해 ${m.salaryAdjustment.grade}등급 반영 — `}
            {formatKrw(m.salaryAdjustment.from)} → <strong>{formatKrw(m.salaryAdjustment.to)}</strong>
          </p>
        </div>
      )}

      {m && (
        <div className="card">
          <dl className="kv kv-wide">
            <dt>세후 월급</dt>
            <dd>{signedKrw(m.netSalary)}</dd>
            <dt>생활비</dt>
            <dd>{signedKrw(-m.livingCost)}</dd>
            {m.interest > 0 && (
              <>
                <dt>부채 이자</dt>
                <dd>{signedKrw(-m.interest)}</dd>
              </>
            )}
            <dt>현금 변화</dt>
            <dd>{signedKrw(m.cashDelta)}</dd>
            {m.debtDelta !== 0 && (
              <>
                <dt>빚 변화</dt>
                <dd>{signedKrw(m.debtDelta)}</dd>
              </>
            )}
          </dl>
          {deltas.length > 0 && (
            <p className="small">
              {deltas.map((k) => `${RESOURCE_LABELS[k]} ${signed(m.resourceDelta[k])}`).join(' · ')}
            </p>
          )}
          <p className="muted small">※ 세율·생활비·이자는 게임용 가상 수치입니다.</p>
        </div>
      )}

      {!ending && <Warnings view={view} />}
      <StatusPanel view={view} />

      <div className="action-bar">
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={busy}>
          {busy ? '진행 중…' : ending ? '결말 보기' : '다음 달로'}
        </button>
      </div>
    </section>
  );
}
