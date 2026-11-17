import type { PublicChatLine, PublicStory } from '@company-life/shared';
import { ChatThread } from '../components/Chat';
import { Icon } from '../components/Icons';

interface Props {
  story: PublicStory;
  meName: string;
  nextLabel: string;
  onContinue: () => void;
}

export const verdictOf = (s: PublicStory) =>
  s.success === true ? '승인' : s.success === false ? '반려' : '확정';

/** 이야기 결과 블록: 판정 도장 + 결과 문장 + 요인 + 변화 */
export function StoryOutcome({ story }: { story: PublicStory }) {
  const verdict = verdictOf(story);
  return (
    <div className="story-outcome float-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className={`stamp stamp-small ${verdict === '확정' ? 'stamp-navy' : ''}`} aria-hidden="true">
          {verdict}
        </span>
        <p className="story-result" style={{ margin: 0 }}>
          {story.resultText || `${story.verdictLabel} — ${story.choiceLabel}`}
        </p>
      </div>
      {story.factors.length > 0 && (
        <ul className="fx-list" aria-label="판정에 작용한 요인">
          {story.factors.map((f) => (
            <li key={f.label} className="factor" style={{ flexDirection: 'row' }}>
              <span style={{ color: f.positive ? 'var(--good)' : 'var(--danger)' }}>
                <Icon name={f.positive ? 'thumbUp' : 'thumbDown'} size={14} />
              </span>
              {f.label}
            </li>
          ))}
        </ul>
      )}
      {(story.effects.length > 0 || story.relationChanges.length > 0) && (
        <div className="choice-meta">
          {story.effects.map((e) => (
            <span key={e.text} className={`fx fx-${e.tone}`}>
              {e.text}
            </span>
          ))}
          {story.relationChanges.map((r) => (
            <span key={r} className="fx fx-neutral">
              {r}
            </span>
          ))}
        </div>
      )}
      {story.traitChanges.map((t) => (
        <span key={t} className="trait-line">
          <Icon name="star" size={14} /> {t}
        </span>
      ))}
      {story.followUpHint && (
        <p className="small" style={{ color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="warning" size={14} /> {story.followUpHint}
        </p>
      )}
    </div>
  );
}

/** 선택 직후: 내 답장 → 이어진 대화 → 판정 → 변화 */
export function StoryResult({ story, meName, nextLabel, onContinue }: Props) {
  const isLife = story.slot === 'life';
  const lines: PublicChatLine[] = [
    isLife
      ? { side: 'narration', name: null, initial: null, text: `나는 — ${story.choiceLabel}` }
      : { side: 'self', name: meName, initial: null, text: story.reply },
    ...story.aftermath,
  ];

  return (
    <section className={isLife ? 'screen life-screen' : 'messenger'}>
      {isLife ? (
        <div className="life-head">
          <span className="life-tag">
            <Icon name="story" size={14} /> 오늘의 일상 · {story.title}
          </span>
        </div>
      ) : (
        <header className="msg-head">
          <span className="avatar" aria-hidden="true">
            <Icon name="company" />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
            <strong className="msg-channel">{story.channelName}</strong>
            <span className="msg-sub">{story.title}</span>
          </div>
        </header>
      )}
      <div className={isLife ? 'life-card' : 'msg-body'}>
        <ChatThread lines={lines} resetKey={story.occurrenceId}>
          <StoryOutcome story={story} />
          <div className="action-bar">
            <button type="button" className="btn btn-primary" onClick={onContinue} autoFocus>
              {nextLabel}
            </button>
          </div>
        </ChatThread>
      </div>
    </section>
  );
}
