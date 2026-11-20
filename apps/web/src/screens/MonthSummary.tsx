import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicReview, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { Icon } from '../components/Icons';
import { Warnings } from '../components/StatusPanel';
import { StoryOutcome, verdictOf } from './StoryResult';
import { Avatar } from '../components/Avatar';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onNext: () => void;
  /** S7 결산의 이직 제안서 응답 */
  onTransfer: (decision: 'accept' | 'decline') => void;
}

const won = (n: number) => n.toLocaleString('ko-KR');
const signedWon = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `−${won(-n)}` : '0');
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** S14 올해 평판이 움직인 곳: 깎인 곳 TOP 3 → 오른 곳 TOP 1 */
function ReputationSources({ sources }: { sources: PublicReview['reputationSources'] }) {
  return (
    <div className="rep-sources">
      <span className="tiny fw-7">올해 평판이 움직인 곳</span>
      <ul>
        {sources.map((s) => (
          <li key={s.label} className="small">
            <span className="rep-label">{s.label}</span>
            <span className={`num ${s.delta > 0 ? 'pos' : 'neg'}`}>
              {s.count > 1 && <span className="tiny muted">×{s.count} </span>}
              {signed(s.delta)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewSheet({ review, age }: { review: PublicReview; age: number }) {
  return (
    <div className="sheet review-sheet">
      {/* S15 도장은 제목 줄 오른쪽에 (항목 등급 칩을 가리지 않게) */}
      <div className="sheet-title review-title">
        <span className="col">
          <strong>연말 인사평가표</strong>
          <span className="tiny muted">
            {age}세 · 종합 {review.score}점
          </span>
        </span>
        <span className="stamp stamp-mid stamp-slam" aria-hidden="true">
          {review.grade}
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
            {it.label === '사내 평판' && review.reputationSources.length > 0 && (
              <ReputationSources sources={review.reputationSources} />
            )}
          </div>
        ))}
        {review.traitAdjustment !== 0 && (
          <div className="sheet-row small">
            <span className="muted">특성 보정</span>
            <span className="num">{signed(review.traitAdjustment)}</span>
          </div>
        )}
      </div>
      <div className="bubble-row mt-2">
        <Avatar name={review.bossName ?? '팀장'} small />
        <div className="bubble-col">
          <span className="bubble-name">{review.bossName ?? '팀장'} · 평가 코멘트</span>
          <p className="bubble">{review.comment}</p>
        </div>
      </div>
      <div className="sheet-rows mt-2">
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
        <div className="banner banner-error mt-2" role="alert">
          <Icon name="warning" />
          <div>
            <strong>성과 개선 대상자 지정</strong>
            <p className="small">
              인사팀의 성과 개선 프로그램(PIP)이 곧 시작됩니다. 실패하면 권고사직으로 이어질 수 있어요.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** MONTH_SUMMARY — 이달의 이야기들 + 급여명세서 + 가계부 */
type Summary = NonNullable<PublicRunView['monthSummary']>;

const pct = (from: number, to: number) => {
  const p = Math.round(((to - from) / from) * 1000) / 10;
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`;
};

/**
 * S18 1월 정기 인사 통지: 지난해 평가 등급 → 연봉 조정 → 승진 심사를 한 장의 사내 공문으로.
 * 연봉 조정이 먼저, 승진 연봉이 그 위에 붙는다 (엔진 순서와 같다).
 */
function PersonnelNotice({
  name,
  age,
  companyName,
  promotion,
  salary,
}: {
  name: string;
  age: number;
  companyName: string | null;
  promotion: Summary['promotion'];
  salary: Summary['salaryAdjustment'];
}) {
  const promoted = promotion?.success === true;
  const finalSalary = (promoted ? promotion?.salaryTo : null) ?? salary?.to ?? null;
  const startSalary = salary?.from ?? promotion?.salaryFrom ?? null;
  const stamp = promoted ? '발령' : promotion ? '보류' : '확정';
  return (
    <div
      className={`sheet notice ${promotion && !promoted ? 'appointment-held' : ''}`}
      aria-label="정기 인사 통지"
    >
      <div className="notice-head">
        <span className="tiny muted">
          {companyName ?? '회사'} 인사팀 · {age}세 1월
        </span>
        <strong className="notice-title">정 기 인 사 통 지</strong>
        <span className="small">
          수신 <strong>{name}</strong>
        </span>
      </div>
      <ol className="notice-items">
        {salary?.grade && (
          <li>
            <span className="notice-label">지난해 평가</span>
            <span className={`notice-grade review-${salary.grade}`}>{salary.grade}</span>
          </li>
        )}
        {salary && (
          <li>
            <span className="notice-label">연봉 조정</span>
            <span className="num">
              {formatKrw(salary.from)} → <strong>{formatKrw(salary.to)}</strong>{' '}
              <span className={salary.to >= salary.from ? 'pos' : 'neg'}>
                ({pct(salary.from, salary.to)})
              </span>
            </span>
          </li>
        )}
        {promotion && (
          <li>
            <span className="notice-label">승진 심사</span>
            {promoted ? (
              <span>
                {promotion.fromLabel} → <strong className="display">{promotion.toLabel}</strong>에 임함
                {promotion.salaryFrom !== null && promotion.salaryTo !== null && (
                  <span className="tiny muted notice-sub">
                    승진 가산 {formatKrw(promotion.salaryFrom)} → {formatKrw(promotion.salaryTo)}
                  </span>
                )}
              </span>
            ) : (
              <span>
                {promotion.toLabel} 승진 <strong>누락</strong>
                {promotion.misses >= 2 ? ` (${promotion.misses}년 연속)` : ''}
                <span className="tiny muted notice-sub">
                  정신력·평판·상사 호감이 떨어졌어요. 포인트는 유지되고, 다음 심사에서는 조금 유리해집니다.
                </span>
              </span>
            )}
          </li>
        )}
      </ol>
      {finalSalary !== null && (
        <div className="sheet-total">
          <strong className="small">올해 연봉</strong>
          <span className="amount num">
            {formatKrw(finalSalary)}
            {startSalary !== null && startSalary !== finalSalary && (
              <span className="tiny pos notice-total-pct"> {pct(startSalary, finalSalary)}</span>
            )}
          </span>
        </div>
      )}
      {promoted && promotion?.newBossName && (
        <span className="tiny muted">
          직급 조정으로 {promotion.newBossName}이(가) 새 직속 상사가 되었습니다.
        </span>
      )}
      <span
        className={`stamp stamp-mid sheet-stamp ${promotion && !promoted ? 'stamp-navy' : ''}`}
        aria-hidden="true"
      >
        {stamp}
      </span>
    </div>
  );
}

export function MonthSummary({ view, busy, onNext, onTransfer }: Props) {
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
          <span className="story-label row gap-1">
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
                <span className="col">
                  <span className="tiny muted fw-7">
                    {ev.slot === 'work' ? '업무' : '일상'} · {ev.channelName}
                  </span>
                  <strong>{ev.title}</strong>
                  <span className="small muted">→ {ev.choiceLabel}</span>
                </span>
              </summary>
              <p className="small ink-2">{ev.situation}</p>
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

      {m && m.news.length > 0 && (
        <div className="card news-card" aria-label="사내 소식">
          <strong className="small">📢 사내 소식</strong>
          <ul className="news-list">
            {m.news.map((n, i) => (
              <li key={`${n.kind}-${i}`} className="small">
                {n.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.transferOffer && (
        <div className="sheet transfer-offer" aria-label="이직 제안서">
          <div className="sheet-title">
            <strong>이직 제안서</strong>
            <span className="tiny muted">이번 달 결산에서만 유효</span>
          </div>
          <div className="card-head">
            <span className={`grade grade-${view.transferOffer.grade}`}>{view.transferOffer.grade}</span>
            <strong>{view.transferOffer.companyName}</strong>
            <span className="chip">{view.transferOffer.jobLabel}</span>
          </div>
          <p className="tiny muted">
            {view.transferOffer.industry} · {view.transferOffer.companyDescription}
          </p>
          <div className="sheet-rows">
            <div className="sheet-row">
              <span>제시 연봉</span>
              <strong className="num pos">
                {formatKrw(view.transferOffer.currentSalary)} → {formatKrw(view.transferOffer.annualSalary)}{' '}
                (+
                {view.transferOffer.raisePercent}%)
              </strong>
            </div>
            <div className="sheet-row small">
              <span className="muted">직급</span>
              <span>{view.employment.rankLabel} 그대로</span>
            </div>
          </div>
          <ul className="transfer-cost small">
            <li>승진 포인트·직급 근속이 처음부터 다시 시작돼요.</li>
            <li>새 팀·새 상사와 관계를 다시 쌓고, 평판은 50에서 시작해요.</li>
            <li>석 달 동안 수습 기간(텃세 사건이 잦아요).</li>
          </ul>
          <div className="transfer-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => onTransfer('decline')}>
              남는다
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onTransfer('accept')}
            >
              옮긴다
            </button>
          </div>
        </div>
      )}
      {m && (m.promotion || m.salaryAdjustment) && (
        <PersonnelNotice
          name={view.profile.displayName}
          age={view.turn.age}
          companyName={view.employment.companyName}
          promotion={m.promotion}
          salary={m.salaryAdjustment}
        />
      )}

      {m?.seasonResult && (
        <div
          className={`card goal-milestone flip-in ${m.seasonResult.achieved ? '' : 'season-missed'}`}
          role="status"
        >
          <span className="goal-emoji" aria-hidden="true">
            {m.seasonResult.emoji}
          </span>
          <div>
            <strong>
              시즌 목표 {m.seasonResult.achieved ? '달성' : '놓침'} · {m.seasonResult.title}
            </strong>
            <p className="tiny muted">{m.seasonResult.text}</p>
          </div>
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
        <div className="card ledger gap-2">
          <strong className="small row gap-2">
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
          <div className="sheet-row small divider-top">
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
      <p className="tiny muted text-center">※ 세율·생활비·이자는 게임용 가상 수치입니다.</p>

      <div className="action-bar">
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={busy}>
          {busy ? '진행 중…' : ending ? '결말 보기' : `${nextMonth}월로 넘어가기`}
        </button>
      </div>
    </section>
  );
}
