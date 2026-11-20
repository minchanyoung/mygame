import { useEffect, useState, type ReactNode } from 'react';
import type { PublicChatLine } from '@company-life/shared';
import { Avatar } from './Avatar';

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * 메신저 대화를 한 줄씩 보여준다 (입력 중… 표시 → 말풍선).
 * 탭하면 전부 펼치고, 모션 줄이기 설정이면 처음부터 전부 보인다.
 * `resetKey`가 바뀌면 처음부터 다시 재생한다.
 */
export function useReveal(total: number, resetKey: string, stepMs = 650) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? total : Math.min(1, total)));
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setShown(prefersReducedMotion() ? total : Math.min(1, total));
  }
  useEffect(() => {
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), stepMs);
    return () => clearTimeout(t);
  }, [shown, total, stepMs]);
  return { shown, done: shown >= total, skip: () => setShown(total) };
}

/** S15 같은 사람이 이어서 말하면 이름·아바타를 생략한다 (실제 메신저처럼) */
export function ChatLine({
  line,
  delay = 0,
  continued = false,
}: {
  line: PublicChatLine;
  delay?: number;
  continued?: boolean;
}) {
  const style = { animationDelay: `${delay}ms` };
  switch (line.side) {
    case 'system':
      return (
        <p className="chat-system float-up" style={style}>
          {line.text}
        </p>
      );
    case 'narration':
      return (
        <p className="narration float-up" style={style}>
          {line.text}
        </p>
      );
    case 'self':
      return (
        <div className="bubble-row bubble-row-self float-up" style={style}>
          <span className="read-mark" aria-hidden="true">
            읽음
          </span>
          <p className="bubble bubble-self">{line.text}</p>
        </div>
      );
    default:
      return (
        <div className={`bubble-row float-up ${continued ? 'bubble-continued' : ''}`} style={style}>
          {continued || !line.name ? (
            <span className="avatar avatar-small" aria-hidden="true">
              {continued ? '' : (line.initial ?? '?')}
            </span>
          ) : (
            <Avatar name={line.name} initial={line.initial ?? undefined} small />
          )}
          <div className="bubble-col">
            {line.name && !continued && <span className="bubble-name">{line.name}</span>}
            <p className="bubble">{line.text}</p>
          </div>
        </div>
      );
  }
}

export function Typing() {
  return (
    <div className="bubble-row" aria-label="입력 중">
      <span className="avatar avatar-small" aria-hidden="true">
        …
      </span>
      <p className="bubble typing" aria-hidden="true">
        <span />
        <span />
        <span />
      </p>
    </div>
  );
}

/** 대화 목록을 순차 재생. 다 보이면 onDone 이후 children(선택지 등)을 보여준다. */
export function ChatThread({
  lines,
  resetKey,
  children,
}: {
  lines: PublicChatLine[];
  resetKey: string;
  children?: ReactNode;
}) {
  const { shown, done, skip } = useReveal(lines.length, resetKey);
  return (
    <>
      <div
        className="chat-thread"
        onClick={done ? undefined : skip}
        role={done ? undefined : 'button'}
        tabIndex={done ? undefined : 0}
        onKeyDown={(e) => {
          if (!done && (e.key === 'Enter' || e.key === ' ')) skip();
        }}
        aria-label={done ? undefined : '대화 건너뛰기'}
      >
        {lines.slice(0, shown).map((l, i) => (
          <ChatLine
            key={i}
            line={l}
            continued={
              l.side === 'other' && i > 0 && lines[i - 1]?.side === 'other' && lines[i - 1]?.name === l.name
            }
          />
        ))}
        {!done && lines[shown]?.side === 'other' && <Typing />}
        {!done && <span className="tiny muted chat-skip">탭해서 건너뛰기</span>}
      </div>
      {done && children}
    </>
  );
}
