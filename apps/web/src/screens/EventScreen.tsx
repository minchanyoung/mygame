import { useState } from 'react';
import type { PublicChoice, PublicRunView } from '@company-life/shared';
import { StatusPanel, Warnings } from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onChoose: (occurrenceId: string, choiceId: string) => void;
}

const RISK_ICON: Record<string, string> = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴' };

/** EVENT_PENDING: 사건 설명 + 선택지. 정확한 확률은 숨기고 위험도·적용 특성·확정 비용만 보여준다 (§22.1). */
export function EventScreen({ view, busy, onChoose }: Props) {
  const event = view.activeEvent;
  // 실직 경고가 붙은 선택지는 두 번 눌러야 확정 (실수 방지)
  const [armed, setArmed] = useState<string | null>(null);
  if (!event) return null;

  const pick = (c: PublicChoice) => {
    if (!c.enabled || busy) return;
    if (c.fatalWarning && armed !== c.id) {
      setArmed(c.id);
      return;
    }
    onChoose(event.occurrenceId, c.id);
  };

  return (
    <section className="screen">
      <Warnings view={view} />
      <article className="card event-card">
        <p className="muted small">
          {view.turn.age}세 {view.turn.monthOfYear}월
          {event.participantName && ` · 등장: ${event.participantName}`}
        </p>
        <h2>{event.title}</h2>
        <p>{event.description}</p>
      </article>

      <div className="choice-list">
        {event.choices.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`card choice ${c.enabled ? '' : 'choice-locked'} ${c.fatalWarning ? 'choice-fatal' : ''}`}
            disabled={!c.enabled || busy}
            onClick={() => pick(c)}
          >
            <strong className="choice-label">
              {c.enabled ? '' : '🔒 '}
              {c.label}
            </strong>
            {c.description && <span className="small muted">{c.description}</span>}
            <span className="choice-meta">
              {c.riskLabel ? (
                <span className="chip">
                  {RISK_ICON[c.risk ?? ''] ?? ''} 위험도 {c.riskLabel}
                </span>
              ) : (
                <span className="chip">확정 결과</span>
              )}
              {c.appliedTraits.map((t) => (
                <span key={t} className="chip chip-accent">
                  ✨ {t} 적용
                </span>
              ))}
              {c.costs.map((cost) => (
                <span key={cost} className="chip">
                  {cost}
                </span>
              ))}
            </span>
            {!c.enabled && c.lockedHint && <span className="small muted">{c.lockedHint}</span>}
            {c.fatalWarning && (
              <span className="fatal">
                {c.fatalWarning}
                {armed === c.id ? ' — 한 번 더 누르면 확정' : ''}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="muted small">결과는 확률에 따라 달라집니다. 정확한 확률은 공개되지 않아요.</p>

      <details>
        <summary className="small">내 상태 보기</summary>
        <StatusPanel view={view} />
      </details>
    </section>
  );
}
