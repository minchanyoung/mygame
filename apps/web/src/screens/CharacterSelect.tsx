import { useState } from 'react';
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  type PublicBackgroundTrait,
  type PublicCharacterCard,
  type PublicEffect,
  type PublicRunView,
  type ResourceKey,
} from '@company-life/shared';
import { formatKrw } from '../api';
import { Icon, STAT_STYLE } from '../components/Icons';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onConfirm: (cardId: string) => void;
}

const LETTERS = ['A', 'B', 'C'];
/** 카드 앞면에는 핵심 효과만, 나머지는 '자세히'에 */
const FRONT_EFFECTS = 2;

/** 데이터에서 계산된 실제 효과 목록 (카드 문구 = 게임 규칙) */
function EffectList({ effects }: { effects: PublicEffect[] }) {
  if (effects.length === 0) return <p className="tiny muted">게임 내 효과 없음</p>;
  return (
    <ul className="fx-list">
      {effects.map((e) => (
        <li key={e.text}>
          <span className={`fx fx-${e.tone}`}>{e.text}</span>
          {e.detail && <span className="tiny muted fx-detail">{e.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 강점/약점 한 줄: 기호 + 이름 + 핵심 효과 1~2개 */
function TraitLine({ trait, good }: { trait: PublicBackgroundTrait; good: boolean }) {
  const front = trait.effects.slice(0, FRONT_EFFECTS);
  return (
    <div className={`spec-trait ${good ? 'is-good' : 'is-bad'}`}>
      <span className="spec-trait-sign" aria-hidden="true">
        {good ? '+' : '−'}
      </span>
      <div className="spec-trait-body">
        <span className="spec-trait-name">
          <span className="sr-only">{good ? '강점' : '약점'} </span>
          {trait.name}
          {trait.rare && <span className="spec-rare-tag">희귀</span>}
        </span>
        {front.length > 0 && (
          <span className="spec-trait-fx">
            {front.map((e) => e.text).join(' · ')}
            {trait.effects.length > FRONT_EFFECTS && ` 외 ${trait.effects.length - FRONT_EFFECTS}`}
          </span>
        )}
      </div>
    </div>
  );
}

function SpecCard({
  card,
  index,
  on,
  best,
  onPick,
}: {
  card: PublicCharacterCard;
  index: number;
  on: boolean;
  /** 세 장 중 가장 높은 능력치 (비교 표시) */
  best: Set<ResourceKey>;
  onPick: () => void;
}) {
  const rec = card.recommendedJob;
  const details = [
    { label: '강점', trait: card.strength },
    { label: '약점', trait: card.weakness },
    { label: '학력', trait: card.university },
    { label: '전공', trait: card.major },
  ];
  return (
    <article
      id={`spec-${card.cardId}`}
      className={`card spec ${on ? 'spec-on' : ''}`}
      aria-label={`스펙 ${LETTERS[index]}`}
    >
      <button type="button" className="spec-hit" aria-pressed={on} onClick={onPick}>
        <div className="spec-head">
          <span className="spec-letter display">스펙 {LETTERS[index]}</span>
          <span className={`spec-check ${on ? 'on' : ''}`} aria-hidden="true">
            {on && <Icon name="check" size={16} />}
          </span>
        </div>

        <p className="spec-profile">
          {card.university.name} · {card.major.name}
        </p>
        {rec.bonusPercent > 0 && (
          <p className="spec-rec">
            <Icon name="briefcase" size={13} /> 추천 직무 <strong>{rec.label}</strong> · 합격률 +
            {rec.bonusPercent}%p
          </p>
        )}

        <dl className="spec-stats">
          {RESOURCE_KEYS.map((k) => (
            <div key={k} className="spec-stat">
              <dt>{RESOURCE_LABELS[k]}</dt>
              <dd>
                <span className="spec-bar" aria-hidden="true">
                  <span style={{ width: `${card.resources[k]}%`, background: STAT_STYLE[k].color }} />
                </span>
                <span className={`spec-num ${best.has(k) ? 'is-best' : ''}`}>
                  {card.resources[k]}
                  {best.has(k) && <span className="sr-only"> (세 장 중 최고)</span>}
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="spec-traits">
          <TraitLine trait={card.strength} good />
          <TraitLine trait={card.weakness} good={false} />
        </div>

        <p className="spec-money">
          시작 현금 <strong className="num">{formatKrw(card.cash)}</strong>
          <span className="spec-dot" aria-hidden="true">
            ·
          </span>
          빚{' '}
          <strong className={`num ${card.debt > 0 ? 'neg' : ''}`}>
            {card.debt > 0 ? formatKrw(card.debt) : '없음'}
          </strong>
        </p>
      </button>

      <details className="spec-more">
        <summary className="small">효과 자세히 보기</summary>
        {details.map((d) => (
          <div key={d.label} className="spec-more-item">
            <strong className="small">
              {d.label} · {d.trait.name}
            </strong>
            <p className="tiny muted">{d.trait.description}</p>
            <EffectList effects={d.trait.effects} />
          </div>
        ))}
      </details>
    </article>
  );
}

export function CharacterSelect({ view, busy, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const cards = view.characterCards;

  // 능력치별 세 장 중 최고값 (모두 같으면 표시하지 않음)
  const bestOf = (cardId: string) => {
    const set = new Set<ResourceKey>();
    for (const k of RESOURCE_KEYS) {
      const values = cards.map((c) => c.resources[k]);
      const max = Math.max(...values);
      const me = cards.find((c) => c.cardId === cardId)!.resources[k];
      if (me === max && values.some((v) => v !== max)) set.add(k);
    }
    return set;
  };

  return (
    <section className="screen">
      <div>
        <h2>어떤 스펙으로 시작할까요?</h2>
        <p className="small muted">
          {view.profile.displayName}({view.profile.genderLabel}) · 24세 · 카드를 눌러 고르세요. 진하게 표시된
          숫자는 세 장 중 가장 높은 값이에요.
        </p>
      </div>

      <div className="spec-pager" role="tablist" aria-label="스펙 바로가기">
        {cards.map((card, i) => (
          <button
            key={card.cardId}
            type="button"
            role="tab"
            aria-selected={selected === card.cardId}
            className={`spec-pager-dot ${selected === card.cardId ? 'on' : ''}`}
            onClick={() =>
              document
                .getElementById(`spec-${card.cardId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
            }
          >
            {LETTERS[i]}
          </button>
        ))}
        <span className="tiny muted spec-swipe-hint">옆으로 넘겨 비교</span>
      </div>

      <div className="spec-row">
        {cards.map((card, i) => (
          <SpecCard
            key={card.cardId}
            card={card}
            index={i}
            on={selected === card.cardId}
            best={bestOf(card.cardId)}
            onPick={() => setSelected(card.cardId)}
          />
        ))}
      </div>

      <div className="action-bar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected || busy}
          onClick={() => selected && onConfirm(selected)}
        >
          {busy
            ? '확정 중…'
            : selected
              ? `스펙 ${LETTERS[cards.findIndex((c) => c.cardId === selected)]}로 시작`
              : '스펙을 골라 주세요'}
        </button>
      </div>
    </section>
  );
}
