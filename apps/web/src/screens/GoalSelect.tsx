import { useState } from 'react';
import type { PublicRunView } from '@company-life/shared';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onConfirm: (goalId: string) => void;
}

/**
 * GOAL_SELECTION — 인생 목표 카드 3장 중 1장 (S5).
 * 한 판 동안 바꿀 수 없고, 엔딩에서 달성 여부를 판정한다. 50세 전에 실직하면 자동 미달성.
 */
export function GoalSelect({ view, busy, onConfirm }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section className="screen">
      <h2>이번 인생의 목표는?</h2>
      <p className="muted">
        한 번 고르면 바꿀 수 없어요. 은퇴할 때 달성 여부를 판정하고, 50세 전에 회사를 잃으면 목표도 함께
        사라집니다.
      </p>
      <div className="goal-grid" role="radiogroup" aria-label="인생 목표">
        {view.lifeGoalOffers.map((g) => {
          const on = picked === g.id;
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`card goal-card ${on ? 'goal-card-on' : ''}`}
              onClick={() => setPicked(g.id)}
              disabled={busy}
            >
              <span className="goal-emoji" aria-hidden="true">
                {g.emoji}
              </span>
              <span className="goal-title">{g.title}</span>
              {g.fitting && <span className="chip chip-trait">내 배경과 어울림</span>}
              <span className="small ink-2">{g.description}</span>
            </button>
          );
        })}
      </div>
      <div className="action-bar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!picked || busy}
          onClick={() => picked && onConfirm(picked)}
        >
          {busy ? '진행 중…' : picked ? '이 목표로 살아보기' : '목표를 골라주세요'}
        </button>
      </div>
    </section>
  );
}
