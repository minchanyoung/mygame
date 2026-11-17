import { useState } from 'react';
import type { PublicActiveEvent, PublicChatLine, PublicChoice, PublicRunView } from '@company-life/shared';
import { ChatThread } from '../components/Chat';
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

const SLOT_LABEL = { work: '업무', life: '일상' } as const;

/** 대화가 없는 사건은 설명을 첫 줄로 보여준다 */
function openingLines(event: PublicActiveEvent): PublicChatLine[] {
  if (event.dialogue.length > 0) return event.dialogue;
  const p = event.participant;
  return [
    p
      ? {
          side: 'other',
          name: `${p.name} ${p.rankLabel}`,
          initial: p.name.slice(0, 1),
          text: event.description,
        }
      : { side: 'narration', name: null, initial: null, text: event.description },
  ];
}

/**
 * EVENT_PENDING — 업무 사건은 사내 메신저, 일상 사건은 하루 일기 카드.
 * 정확한 확률은 숨기고 위험도·적용 특성·확정 비용만 보여준다 (§22.1).
 */
export function EventScreen({ view, busy, onChoose }: Props) {
  const event = view.activeEvent;
  // 실직 경고가 붙은 선택지는 두 번 눌러야 확정 (실수 방지)
  const [armed, setArmed] = useState<string | null>(null);
  if (!event) return null;
  const p = event.participant;
  const isLife = event.slot === 'life';

  const pick = (c: PublicChoice) => {
    if (!c.enabled || busy) return;
    if (c.fatalWarning && armed !== c.id) {
      setArmed(c.id);
      return;
    }
    onChoose(event.occurrenceId, c.id);
  };

  const progress = (
    <span
      className="slot-progress"
      aria-label={`이번 달 ${event.position.index}번째 사건, 총 ${event.position.total}개`}
    >
      {Array.from({ length: event.position.total }, (_, i) => (
        <span key={i} className={`slot-dot ${i < event.position.index ? 'on' : ''}`} />
      ))}
      {SLOT_LABEL[event.slot]} {event.position.index}/{event.position.total}
    </span>
  );

  const choices = (
    <div className="reply-panel">
      <span className="tiny" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>
        {isLife ? '어떻게 할까요?' : '답장하기'}
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
            {c.reply && !isLife && <span className="choice-reply">“{c.reply}”</span>}
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
  );

  if (isLife) {
    return (
      <section className="screen life-screen">
        <div className="life-card float-up">
          <div className="life-head">
            <span className="life-date">
              {view.turn.age}세 {view.turn.monthOfYear}월 · 퇴근 후
            </span>
            {progress}
          </div>
          <span className="life-tag">
            <Icon name="story" size={14} /> 오늘의 일상
          </span>
          <h2 className="event-title" style={{ alignSelf: 'flex-start', textAlign: 'left' }}>
            {event.title}
          </h2>
          <p className="life-text">{event.description}</p>
        </div>
        <Warnings view={view} />
        <details>
          <summary className="small muted">내 상태 보기</summary>
          <Gauges view={view} />
        </details>
        {choices}
      </section>
    );
  }

  return (
    <section className="messenger">
      <header className="msg-head">
        <span className="avatar" aria-hidden="true">
          {p ? p.name.slice(0, 1) : <Icon name="company" />}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
          <strong className="msg-channel">{event.channelName}</strong>
          <span className="msg-sub">
            {p
              ? `${p.roleLabel} · ${p.personalities.map((x) => x.name).join(' · ')} · 관계 ${p.relationLabel}`
              : `${view.employment.companyName ?? '회사'} · ${event.categoryLabel}`}
          </span>
        </div>
        {progress}
      </header>

      <div className="msg-body">
        <span className="event-pill">
          {view.turn.monthOfYear}월 · {event.title}
        </span>
        {event.dialogue.length > 0 && <p className="chat-context">{event.description}</p>}
        <ChatThread lines={openingLines(event)} resetKey={event.occurrenceId}>
          <Warnings view={view} />
          <details>
            <summary className="small muted">내 상태 보기</summary>
            <Gauges view={view} />
          </details>
        </ChatThread>
      </div>

      {choices}
    </section>
  );
}
