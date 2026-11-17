import { useState } from 'react';
import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onConfirm: (cardId: string) => void;
}

export function CharacterSelect({ view, busy, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <section className="screen">
      <h2>어떤 인생으로 시작할까요?</h2>
      <p className="muted">
        세 명 모두 {view.profile.displayName}({view.profile.genderLabel})입니다. 영구 능력은 아직 아무도
        없어요 — 사건을 통해 발견하게 됩니다.
      </p>

      <div className="card-list" role="radiogroup" aria-label="캐릭터 카드">
        {view.characterCards.map((card, i) => {
          const on = selected === card.cardId;
          return (
            <button
              key={card.cardId}
              type="button"
              role="radio"
              aria-checked={on}
              className={`card flip-in ${on ? 'card-on' : ''}`}
              style={{ animationDelay: `${i * 160}ms` }}
              onClick={() => setSelected(card.cardId)}
            >
              <div className="card-head">
                <strong>카드 {i + 1}</strong>
                <span className="chip">{card.startAge}세</span>
                {on && <span className="chip chip-accent">✓ 선택됨</span>}
              </div>
              <dl className="kv">
                <dt>학력</dt>
                <dd>{card.university.name}</dd>
                <dt>전공</dt>
                <dd>{card.major.name}</dd>
                <dt>가정</dt>
                <dd>{card.family.name}</dd>
                <dt>강점</dt>
                <dd>
                  👍 {card.strength.name} <span className="muted small">— {card.strength.description}</span>
                </dd>
                <dt>약점</dt>
                <dd>
                  👎 {card.weakness.name} <span className="muted small">— {card.weakness.description}</span>
                </dd>
                <dt>자금</dt>
                <dd>
                  현금 {formatKrw(card.cash)}
                  {card.debt > 0 && <> · 빚 {formatKrw(card.debt)}</>}
                </dd>
              </dl>
              <div className="stats">
                {RESOURCE_KEYS.map((k) => (
                  <div key={k} className="stat">
                    <span className="stat-label">{RESOURCE_LABELS[k]}</span>
                    <span className="stat-bar" aria-hidden="true">
                      <span style={{ width: `${card.resources[k]}%` }} />
                    </span>
                    <span className="stat-value">{card.resources[k]}</span>
                  </div>
                ))}
              </div>
              <p className="muted small">발견한 영구 특성 {card.permanentTraitCount}개</p>
            </button>
          );
        })}
      </div>

      <div className="action-bar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected || busy}
          onClick={() => selected && onConfirm(selected)}
        >
          {busy ? '확정 중…' : '이 인생으로 시작'}
        </button>
      </div>
    </section>
  );
}
