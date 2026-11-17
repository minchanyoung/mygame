import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicReview, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { Icon } from '../components/Icons';
import { Warnings } from '../components/StatusPanel';
import { StoryOutcome, verdictOf } from './StoryResult';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onNext: () => void;
}

const won = (n: number) => n.toLocaleString('ko-KR');
const signedWon = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `−${won(-n)}` : '0');
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function ReviewSheet({ review, age }: { review: PublicReview; age: number }) {
  return (
    <div className="sheet review-sheet">
      <div className="sheet-title">
        <strong>연말 인사평가표</strong>
        <span className="tiny muted">
          {age}세 · 종합 {review.score}점
        </span>
      </div>
      <div className="sheet-rows">
        {review.items.map((it) => (
          <div key={it.label} className="review-item">
            <div className="sheet-row">
              <span>{it.label}</span>
              <span className={`grade grade-sm review-${it.grade}`}>{it.grade}</span>
            </div>
            <div className="review-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, Math.min(100, it.score))}%` }} />
            </div>
            <span className="tiny muted">{it.note}</span>
          </div>
        ))}
        {review.traitAdjustment !== 0 && (
          <div className="sheet-row small">
            <span className="muted">특성 보정</span>
            <span className="num">{signed(review.traitAdjustment)}</span>
          </div>
        )}
      </div>
      <div className="bubble-row" style={{ marginTop: 8 }}>
        <span className="avatar avatar-small" aria-hidden="true">
          {(review.bossName ?? '팀').slice(0, 1)}
        </span>
        <div className="bubble-col">
          <span className="bubble-name">{review.bossName ?? '팀장'} · 평가 코멘트</span>
          <p className="bubble">{review.comment}</p>
        </div>
      </div>
      <div className="sheet-rows" style={{ marginTop: 8 }}>
        <div className="sheet-row">
          <span>최종 등급</span>
          <span className={`grade review-${review.grade}`}>{review.grade}</span>
        </div>
        <div className="sheet-row">
          <span>평판 반영</span>
          <span className="num">{signed(review.reputationDelta)}</span>
        </div>
        <div className="sheet-row">
          <span>성과급</span>
          <strong className={`num ${review.bonus > 0 ? 'pos' : 'muted'}`}>
            {review.bonus > 0 ? `+${formatKrw(review.bonus)}` : '없음'}
          </strong>
        </div>
        <span className="tiny muted">등급은 다음 1월 연봉 조정에 반영됩니다.</span>
      </div>
      {review.warning && (
        <div className="banner banner-error" role="alert" style={{ marginTop: 8 }}>
          <Icon name="warning" />
          <div>
            <strong>성과 개선 대상자 지정</strong>
            <p className="small">
              인사팀의 성과 개선 프로그램(PIP)이 곧 시작됩니다. 실패하면 권고사직으로 이어질 수 있어요.
            </p>
          </div>
        </div>
      )}
      <span className="stamp stamp-mid sheet-stamp stamp-slam" aria-hidden="true">
        {review.grade}
      </span>
    </div>
  );
}

/** MONTH_SUMMARY — 이달의 이야기들 + 급여명세서 + 가계부 */
export function MonthSummary({ view, busy, onNext }: Props) {
  const m = view.monthSummary;
  const ending = view.pendingEnding;
  const nextMonth = view.turn.monthOfYear === 12 ? 1 : view.turn.monthOfYear + 1;

  return (
    <section className="screen">
      <h2>
        {view.turn.monthOfYear}월 결산 <span className="small muted">{view.turn.age}세</span>
      </h2>

      {m && m.events.length > 0 && (
        <article className="card story" aria-label="이달의 이야기">
          <span className="story-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="story" size={14} /> 이달의 이야기
          </span>
          {m.events.map((ev) => (
            <details key={ev.occurrenceId} className="story-entry">
              <summary>
                <span
                  className={`stamp stamp-small ${verdictOf(ev) === '확정' ? 'stamp-navy' : ''}`}
                  aria-hidden="true"
                >
                  {verdictOf(ev)}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="tiny muted" style={{ fontWeight: 700 }}>
                    {ev.slot === 'work' ? '업무' : '일상'} · {ev.channelName}
                  </span>
                  <strong>{ev.title}</strong>
                  <span className="small muted">→ {ev.choiceLabel}</span>
                </span>
              </summary>
              <p className="small" style={{ color: 'var(--ink-2)' }}>
                {ev.situation}
              </p>
              <StoryOutcome story={ev} />
            </details>
          ))}
        </article>
      )}

      {ending && (
        <div className="banner banner-error" role="alert">
          <Icon name="warning" />
          <div>
            <strong>{ending.category === 'FAILURE' ? '이번 달을 끝으로…' : '직장 생활의 끝'}</strong>
            <p>
              <strong>{ending.title}</strong> — {ending.text}
            </p>
          </div>
        </div>
      )}

      {m?.annualReview && <ReviewSheet review={m.annualReview} age={view.turn.age} />}

      {m?.promotion && (
        <div className={`sheet appointment ${m.promotion.success ? '' : 'appointment-held'}`}>
          <div className="sheet-title">
            <strong>{m.promotion.success ? '인 사 발 령' : '승진 심사 결과'}</strong>
            <span className="tiny muted">{view.turn.age}세 1월</span>
          </div>
          {m.promotion.success ? (
            <>
              <p className="appointment-line">
                <strong>{view.profile.displayName}</strong> — {m.promotion.fromLabel}
                {' → '}
                <strong className="display">{m.promotion.toLabel}</strong>에 임함
              </p>
              <div className="sheet-rows">
                {m.promotion.salaryFrom !== null && m.promotion.salaryTo !== null && (
                  <div className="sheet-row">
                    <span>승진 연봉</span>
                    <strong className="num pos">
                      {formatKrw(m.promotion.salaryFrom)} → {formatKrw(m.promotion.salaryTo)}
                    </strong>
                  </div>
                )}
                {m.promotion.newBossName && (
                  <span className="tiny muted">
                    직급 조정으로 {m.promotion.newBossName}이(가) 새 직속 상사가 되었습니다.
                  </span>
                )}
              </div>
              <span className="stamp stamp-mid sheet-stamp stamp-slam" aria-hidden="true">
                발령
              </span>
            </>
          ) : (
            <>
              <p className="appointment-line">
                {m.promotion.toLabel} 승진 심사에서 <strong>누락</strong>되었습니다.
                {m.promotion.misses >= 2 ? ` (${m.promotion.misses}년 연속)` : ''}
              </p>
              <p className="tiny muted">
                정신력·평판·상사 호감이 떨어졌어요. 포인트는 유지되고, 다음 심사에서는 조금 유리해집니다.
              </p>
              <span className="stamp stamp-mid stamp-navy sheet-stamp" aria-hidden="true">
                보류
              </span>
            </>
          )}
        </div>
      )}

      {m?.goalMilestone && view.lifeGoal && (
        <div className="card goal-milestone flip-in" role="status">
          <span className="goal-emoji" aria-hidden="true">
            {view.lifeGoal.emoji}
          </span>
          <div>
            <strong>
              인생 목표 {m.goalMilestone}% 돌파 · {view.lifeGoal.title}
            </strong>
            <p className="tiny muted">{view.lifeGoal.progressLabel} · 정신력 +3</p>
          </div>
        </div>
      )}

      {m?.salaryAdjustment && (
        <div className="sheet">
          <div className="sheet-title">
            <strong>연봉계약서</strong>
            <span className="tiny muted">{view.turn.age}세 1월</span>
          </div>
          <div className="sheet-rows">
            <div className="sheet-row">
              <span>이전 연봉</span>
              <span className="num">{formatKrw(m.salaryAdjustment.from)}</span>
            </div>
            <div className="sheet-row">
              <strong>새 연봉</strong>
              <strong className="num pos">{formatKrw(m.salaryAdjustment.to)}</strong>
            </div>
            {m.salaryAdjustment.grade && (
              <span className="tiny muted">지난해 {m.salaryAdjustment.grade}등급 평가 반영</span>
            )}
          </div>
        </div>
      )}

      {m && (
        <div className="sheet">
          <div className="sheet-title">
            <strong>급여명세서</strong>
            <span className="tiny muted">
              {view.turn.age}세 {view.turn.monthOfYear}월분
            </span>
          </div>
          <div className="sheet-meta">
            <span>
              성명 <strong>{view.profile.displayName}</strong>
            </span>
            <span>
              소속 <strong>{view.employment.companyName ?? '-'}</strong>
            </span>
            <span>
              직급 <strong>{view.employment.rankLabel ?? '-'}</strong>
            </span>
            <span>
              연봉{' '}
              <strong>
                {view.employment.annualSalary !== null ? formatKrw(view.employment.annualSalary) : '-'}
              </strong>
            </span>
          </div>
          <div className="sheet-rows">
            <div className="sheet-row">
              <span>기본급 (월)</span>
              <span className="num">{won(m.grossSalary)}</span>
            </div>
            <div className="sheet-row muted">
              <span>공제 (게임 세율)</span>
              <span className="num">−{won(m.tax)}</span>
            </div>
          </div>
          <div className="sheet-total">
            <strong className="small">실지급액</strong>
            <span className="amount num">{won(m.netSalary)}원</span>
          </div>
          <span
            className="stamp stamp-mid sheet-stamp"
            style={{ transform: 'rotate(12deg)' }}
            aria-hidden="true"
          >
            지급
            <br />
            완료
          </span>
        </div>
      )}

      {m && (
        <div className="card ledger" style={{ gap: 6 }}>
          <strong className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="cash" size={16} /> 이달의 가계부
          </strong>
          {m.livingBreakdown.map((l) => (
            <div key={l.label} className="sheet-row small">
              <span className="muted">{l.label}</span>
              <span className="num">−{won(l.amount)}</span>
            </div>
          ))}
          {m.interest > 0 && (
            <div className="sheet-row small">
              <span className="muted">부채 이자</span>
              <span className="num">−{won(m.interest)}</span>
            </div>
          )}
          {m.debtRepayment > 0 && (
            <div className="sheet-row small">
              <span className="muted">빚 원금 상환</span>
              <span className="num">−{won(m.debtRepayment)}</span>
            </div>
          )}
          <div className="sheet-row small" style={{ borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
            <strong>통장 변화 (사건 지출 포함)</strong>
            <strong className="num">
              <span className={m.cashDelta >= 0 ? 'pos' : 'neg'}>현금 {signedWon(m.cashDelta)}</span>
              {m.debtDelta !== 0 && (
                <span className={m.debtDelta > 0 ? 'neg' : 'pos'}> · 빚 {signedWon(m.debtDelta)}</span>
              )}
            </strong>
          </div>
        </div>
      )}

      {m && <span className="story-label">이달 전체 변화 (정산·자연 회복 포함)</span>}
      {m && (
        <div className="deltas">
          {RESOURCE_KEYS.map((k, i) => {
            const d = m.resourceDelta[k];
            const now = view.resources[k];
            const low = now <= 20;
            return (
              <div
                key={k}
                className="delta float-up"
                style={{ animationDelay: `${i * 80}ms`, borderColor: low ? 'var(--danger-line)' : undefined }}
              >
                <span className="tiny muted">{RESOURCE_LABELS[k]}</span>
                <span className={`delta-value ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{signed(d)}</span>
                <span
                  className="tiny"
                  style={{ fontWeight: 700, color: low ? 'var(--danger)' : 'var(--muted)' }}
                >
                  {low ? `위험 ${now}` : `현재 ${now}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!ending && <Warnings view={view} />}
      <p className="tiny muted" style={{ textAlign: 'center' }}>
        ※ 세율·생활비·이자는 게임용 가상 수치입니다.
      </p>

      <div className="action-bar">
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={busy}>
          {busy ? '진행 중…' : ending ? '결말 보기' : `${nextMonth}월로 넘어가기`}
        </button>
      </div>
    </section>
  );
}
