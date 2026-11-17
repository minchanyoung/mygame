import { useState } from 'react';
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  type PublicBackgroundTrait,
  type PublicCharacterCard,
  type PublicEffect,
  type PublicRunView,
} from '@company-life/shared';
import { formatKrw } from '../api';
import { Icon, IconBadge, STAT_STYLE } from '../components/Icons';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onConfirm: (cardId: string) => void;
}

const LETTERS = ['A', 'B', 'C'];

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

function TraitBlock({ trait, good }: { trait: PublicBackgroundTrait; good: boolean }) {
  return (
    <div className={`trait-block ${good ? 'trait-good' : 'trait-bad'}`}>
      <div className="trait-block-head">
        <IconBadge
          name={good ? 'thumbUp' : 'thumbDown'}
          color={good ? 'var(--c-cash)' : 'var(--stamp)'}
          size={28}
        />
        <span className="tiny muted" style={{ fontWeight: 700 }}>
          {good ? '강점' : '약점'}
        </span>
        <strong>{trait.name}</strong>
        {trait.rare && <span className="chip chip-pill chip-trait">희귀</span>}
      </div>
      <p className="small" style={{ color: 'var(--ink-2)' }}>
        {trait.description}
      </p>
      <EffectList effects={trait.effects} />
    </div>
  );
}

function SpecCard({
  card,
  index,
  on,
  onPick,
}: {
  card: PublicCharacterCard;
  index: number;
  on: boolean;
  onPick: () => void;
}) {
  const rec = card.recommendedJob;
  const backgrounds = [
    { icon: 'school' as const, label: '학력', trait: card.university },
    { icon: 'book' as const, label: '전공', trait: card.major },
  ];
  const rare = card.strength.rare || card.weakness.rare;
  return (
    <article
      id={`spec-${card.cardId}`}
      className={`card spec flip-in ${on ? 'card-on' : ''} ${rare ? 'spec-rare' : ''}`}
      style={{ animationDelay: `${index * 160}ms` }}
      aria-label={`스펙 ${LETTERS[index]}`}
    >
      <div className="spec-head">
        <span className="spec-letter display">스펙 {LETTERS[index]}</span>
        {rec.bonusPercent > 0 && (
          <span className="chip chip-pill chip-accent">
            <Icon name="briefcase" size={13} />
            추천 {rec.label} · 합격률 +{rec.bonusPercent}%p
          </span>
        )}
      </div>

      <div className="mini-stats">
        {RESOURCE_KEYS.map((k) => (
          <div key={k} className="mini-stat">
            <IconBadge name={STAT_STYLE[k].icon} color={STAT_STYLE[k].color} size={26} />
            <span className="tiny muted">{RESOURCE_LABELS[k]}</span>
            <strong className="display">{card.resources[k]}</strong>
          </div>
        ))}
      </div>

      <div className="bg-tiles">
        {backgrounds.map((b) => (
          <div key={b.label} className="bg-tile">
            <span className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name={b.icon} size={14} />
              {b.label}
            </span>
            <strong className="small">{b.trait.name}</strong>
          </div>
        ))}
      </div>

      <TraitBlock trait={card.strength} good />
      <TraitBlock trait={card.weakness} good={false} />

      <div className="money-tiles" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="money-tile">
          <span className="tiny muted">시작 현금</span>
          <strong className="num">{formatKrw(card.cash)}</strong>
        </div>
        <div className="money-tile">
          <span className="tiny muted">시작 빚</span>
          <strong className={`num ${card.debt > 0 ? 'neg' : ''}`}>{formatKrw(card.debt)}</strong>
        </div>
      </div>

      <details className="spec-more">
        <summary className="small">학력·전공 효과 자세히</summary>
        {backgrounds.map((b) => (
          <div key={b.label} style={{ marginTop: 8 }}>
            <strong className="small">
              {b.label} · {b.trait.name}
            </strong>
            <p className="tiny muted">{b.trait.description}</p>
            <EffectList effects={b.trait.effects} />
          </div>
        ))}
      </details>

      <button type="button" className={`btn ${on ? 'btn-primary' : ''}`} aria-pressed={on} onClick={onPick}>
        {on ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={18} /> 선택됨
          </span>
        ) : (
          `스펙 ${LETTERS[index]} 고르기`
        )}
      </button>
    </article>
  );
}

export function CharacterSelect({ view, busy, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <section className="screen">
      <h2>어떤 스펙으로 시작할까요?</h2>
      <p className="small muted">
        세 명 모두 {view.profile.displayName}({view.profile.genderLabel}), 24세입니다. 아래 효과는 모두 실제
        게임 규칙에서 계산된 값이에요. 영구 능력은 아직 아무도 없습니다.
      </p>

      <div className="spec-pager" role="tablist" aria-label="스펙 바로가기">
        {view.characterCards.map((card, i) => (
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
        <span className="tiny muted spec-swipe-hint">옆으로 넘겨 비교해 보세요</span>
      </div>

      <div className="spec-row">
        {view.characterCards.map((card, i) => (
          <SpecCard
            key={card.cardId}
            card={card}
            index={i}
            on={selected === card.cardId}
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
              ? `스펙 ${LETTERS[view.characterCards.findIndex((c) => c.cardId === selected)]}로 시작`
              : '스펙을 골라 주세요'}
        </button>
      </div>
    </section>
  );
}
