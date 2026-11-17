import { useState } from 'react';
import type { PublicChoice, PublicRunView } from '@company-life/shared';
import { Icon } from '../components/Icons';
import { Gauges, Warnings } from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onChoose: (occurrenceId: string, choiceId: string) => void;
}

const RISK_COLOR: Record<string, string> = {
  LOW: 'var(--risk-low)',
  MEDIUM: 'var(--risk-mid)',
  HIGH: 'var(--risk-high)',
};

/**
 * EVENT_PENDING — 사내 메신저 화면.
 * 등장 NPC가 있으면 그 사람의 메신저로, 없으면 회사 공지 채널로 보여준다.
 * 정확한 확률은 숨기고 위험도·적용 특성·확정 비용만 보여준다 (§22.1).
 */
export function EventScreen({ view, busy, onChoose }: Props) {
  const event = view.activeEvent;
  // 실직 경고가 붙은 선택지는 두 번 눌러야 확정 (실수 방지)
  const [armed, setArmed] = useState<string | null>(null);
  if (!event) return null;
  const p = event.participant;

  const pick = (c: PublicChoice) => {
    if (!c.enabled || busy) return;
    if (c.fatalWarning && armed !== c.id) {
      setArmed(c.id);
      return;
    }
    onChoose(event.occurrenceId, c.id);
  };

  return (
    <section className="messenger">
      <header className="msg-head">
        <span className="avatar" aria-hidden="true">
          {p ? p.name.slice(0, 1) : <Icon name="company" />}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
          <strong>
            {p ? p.name : (view.employment.companyName ?? '회사')}{' '}
            <span className="msg-sub" style={{ fontWeight: 400 }}>
              {p ? `${p.roleLabel} · ${p.rankLabel}` : `${event.categoryLabel} 채널`}
            </span>
          </strong>
          <span className="msg-sub">
            {p ? `${p.personalities.map((x) => x.name).join(' · ')} · 관계 ${p.relationLabel}` : '전체 공지'}
          </span>
        </div>
        <span className="msg-sub">
          {view.turn.age}세 {view.turn.monthOfYear}월
        </span>
      </header>

      <div className="msg-body">
        <span className="event-pill">이번 달 사건 · {event.categoryLabel}</span>
        <h2 className="event-title">{event.title}</h2>
        {p ? (
          <div className="bubble-row float-up">
            <span className="avatar avatar-small" aria-hidden="true">
              {p.name.slice(0, 1)}
            </span>
            <p className="bubble">{event.description}</p>
          </div>
        ) : (
          <p className="narration float-up">{event.description}</p>
        )}
        <Warnings view={view} />
        <details>
          <summary className="small muted">내 상태 보기</summary>
          <Gauges view={view} />
        </details>
      </div>

      <div className="reply-panel">
        <span className="tiny" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>
          어떻게 할까요?
        </span>
        {event.choices.map((c) => {
          const isArmed = armed === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className={`card choice ${c.enabled ? '' : 'choice-locked'} ${c.fatalWarning ? 'choice-fatal' : ''} ${isArmed ? 'choice-armed' : ''}`}
              disabled={!c.enabled || busy}
              onClick={() => pick(c)}
            >
              <span className="choice-label">
                {!c.enabled && (
                  <span style={{ verticalAlign: '-3px', marginRight: 4 }}>
                    <Icon name="lock" size={16} />
                  </span>
                )}
                {c.label}
              </span>
              {c.description && <span className="small muted">{c.description}</span>}
              <span className="choice-meta">
                {c.risk ? (
                  <span className="chip">
                    <span className="dot" style={{ background: RISK_COLOR[c.risk] }} aria-hidden="true" />
                    위험도 {c.riskLabel}
                  </span>
                ) : (
                  <span className="chip">확정 결과</span>
                )}
                {c.appliedTraits.map((t) => (
                  <span key={t} className="chip chip-trait">
                    <Icon name="star" size={12} />
                    {t} 적용
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
                  <Icon name="warning" size={16} />
                  {c.fatalWarning.replace(/^⚠\s*/, '')}
                  {isArmed ? ' — 한 번 더 누르면 확정' : ''}
                </span>
              )}
            </button>
          );
        })}
        <span className="tiny muted" style={{ textAlign: 'center' }}>
          정확한 확률은 공개되지 않아요. 결과는 확률에 따라 달라집니다.
        </span>
      </div>
    </section>
  );
}
