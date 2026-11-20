import type { EventDefinition, GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';

/** S16 '그때 그 선택': 예약 사건을 만든 원래 사건과 선택 */
export interface EchoSource {
  turnIndex: number;
  eventTitle: string;
  choiceLabel: string;
}

/**
 * 예약으로 열린 사건의 원인. 연재의 다음 화는 연재 표시가 따로 있으므로 제외하고,
 * 원인 기록이 없거나(사내 소식·승진 누락 예약, 옛 세이브) 찾을 수 없으면 null.
 */
export function echoSource(
  state: GameRunState,
  event: EventDefinition,
  sourceOccurrenceId: string | null | undefined,
  content: ContentIndex,
): EchoSource | null {
  if (!sourceOccurrenceId || event.series) return null;
  const source = state.eventOccurrences.find((o) => o.occurrenceId === sourceOccurrenceId);
  const sourceEvent = source && content.events.get(source.eventId);
  if (!source || !sourceEvent) return null;
  const choice = sourceEvent.choices.find((c) => c.id === source.choiceId);
  return {
    turnIndex: source.turnIndex,
    eventTitle: sourceEvent.title,
    choiceLabel: (choice?.label ?? source.choiceId).replace(/^"|"$/g, ''),
  };
}
