import { useEffect, useState } from 'react';
import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { Icon } from '../components/Icons';
import { Warnings } from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onNext: () => void;
}

const won = (n: number) => n.toLocaleString('ko-KR');
const signedWon = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `−${won(-n)}` : '0');
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/**
 * MONTH_SUMMARY — 급여명세서 형식의 결산.
 * 들어오는 순간 판정 도장(승인/반려/확정)이 찍히고, 탭하거나 잠시 뒤 사라진다.
 */
export function MonthSummary({ view, busy, onNext }: Props) {
  const m = view.monthSummary;
  const ending = view.pendingEnding;
  const ev = m?.event;
  const verdict = ev ? (ev.success === true ? '승인' : ev.success === false ? '반려' : '확정') : null;
  const [showStamp, setShowStamp] = useState(verdict !== null);

  useEffect(() => {
    if (!showStamp) return;
    const t = setTimeout(() => setShowStamp(false), 1100);
    return () => clearTimeout(t);
  }, [showStamp]);

  const nextMonth = view.turn.monthOfYear === 12 ? 1 : view.turn.monthOfYear + 1;

  return (
    <section className="screen">
      {showStamp && verdict && (
        <button
          type="button"
          className="stamp-overlay"
          onClick={() => setShowStamp(false)}
          aria-label="판정 결과 닫기"
        >
          <span className={`stamp stamp-big stamp-slam ${verdict === '확정' ? 'stamp-navy' : ''}`}>
            {verdict}
          </span>
        </button>
      )}

      <h2>
        {view.turn.monthOfYear}월 결산 <span className="small muted">{view.turn.age}세</span>
      </h2>

      {ev && (
        <article className="card story" aria-label="이달의 이야기">
          <div className="result-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className={`stamp stamp-small ${verdict === '확정' ? 'stamp-navy' : ''}`}
              aria-hidden="true"
            >
              {verdict}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span
                className="tiny muted"
                style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Icon name="story" size={14} /> 이달의 이야기 · {ev.categoryLabel}
              </span>
              <strong className="display" style={{ fontSize: '1.2rem' }}>
                {ev.title}
              </strong>
            </div>
          </div>

          <div className="story-step">
            <span className="story-label">상황{ev.participantName && ` · ${ev.participantName}`}</span>
            <p className="small" style={{ color: 'var(--ink-2)' }}>
              {ev.situation}
            </p>
          </div>

          <div className="story-step">
            <span className="story-label">나의 선택</span>
            <strong>{ev.choiceLabel}</strong>
          </div>

          <div className="story-step">
            <span className="story-label">결과 · {ev.verdictLabel}</span>
            <p className="story-result">{ev.resultText}</p>
            {ev.factors.length > 0 && (
              <ul className="fx-list" aria-label="판정에 작용한 요인">
                {ev.factors.map((f) => (
                  <li key={f.label} className="factor" style={{ flexDirection: 'row' }}>
                    <span style={{ color: f.positive ? 'var(--good)' : 'var(--danger)' }}>
                      <Icon name={f.positive ? 'thumbUp' : 'thumbDown'} size={14} />
                    </span>
                    {f.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(ev.effects.length > 0 || ev.relationChanges.length > 0 || ev.followUpHint) && (
            <div className="story-step">
              <span className="story-label">이 일로 달라진 것</span>
              <div className="choice-meta">
                {ev.effects.map((e) => (
                  <span key={e.text} className={`fx fx-${e.tone}`}>
                    {e.text}
                  </span>
                ))}
                {ev.relationChanges.map((r) => (
                  <span key={r} className="fx fx-neutral">
                    {r}
                  </span>
                ))}
              </div>
              {ev.followUpHint && (
                <p
                  className="small"
                  style={{ color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="warning" size={14} /> {ev.followUpHint}
                </p>
              )}
            </div>
          )}
        </article>
      )}

      {ev && ev.traitChanges.length > 0 && (
        <div className="card trait-burst flip-in" role="status">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="star" /> 특성 변화
          </span>
          {ev.traitChanges.map((t) => (
            <span key={t} className="display" style={{ fontSize: '1.2rem' }}>
              {t}
            </span>
          ))}
        </div>
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

      {m?.annualReview && (
        <div className="sheet">
          <div className="sheet-title">
            <strong>인사평가표</strong>
            <span className="tiny muted">{view.turn.age}세 연말</span>
          </div>
          <div className="sheet-rows">
            <div className="sheet-row">
              <span>평가 등급</span>
              <span className="grade">{m.annualReview.grade}</span>
            </div>
            <div className="sheet-row">
              <span>평판 반영</span>
              <span className="num">{signed(m.annualReview.reputationDelta)}</span>
            </div>
            <span className="tiny muted">다음 1월 연봉에 반영됩니다.</span>
          </div>
          <span className="stamp stamp-mid sheet-stamp stamp-slam" aria-hidden="true">
            {m.annualReview.grade}
          </span>
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
        <div className="card" style={{ gap: 6 }}>
          <div className="sheet-row small">
            <span className="muted">생활비</span>
            <span className="num">−{won(m.livingCost)}</span>
          </div>
          {m.interest > 0 && (
            <div className="sheet-row small">
              <span className="muted">부채 이자</span>
              <span className="num">−{won(m.interest)}</span>
            </div>
          )}
          <div className="sheet-row small" style={{ borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
            <strong>통장 변화</strong>
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
