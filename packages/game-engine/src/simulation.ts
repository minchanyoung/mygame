import type { EndingType, GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { EngineError } from './errors';
import { evaluateChoices } from './events';
import { applyForJob } from './jobs';
import { chooseInMonth, nextMonth, startMonth } from './month';
import { SeededRng } from './rng';
import { chooseCharacter, createRun } from './run';
import { toPublicActiveEvent } from './view';

/**
 * §13.3 자동 플레이 봇. 정책 선택용 난수는 게임 판정 RNG와 분리된 스트림을 쓴다.
 * - random: 고를 수 있는 선택지 중 무작위
 * - cautious: 확정 비용으로 실직하는 선택지를 피하고, 그중 확정 자원 변화 합이 가장 큰 선택지
 */
export type AutoPlayPolicy = 'random' | 'cautious';

export interface AutoPlayResult {
  seed: string;
  endingType: EndingType | null;
  category: 'FAILURE' | 'NORMAL' | null;
  age: number | null;
  months: number;
  /** 진행 불능(고를 선택지가 없음 등) 발생 시 사유 */
  stuck: string | null;
}

function pickChoice(
  state: GameRunState,
  policy: AutoPlayPolicy,
  rng: SeededRng,
  content: ContentIndex,
): string | null {
  const active = state.activeEvent;
  if (!active) return null;
  const event = content.events.get(active.eventId);
  if (!event) return null;
  const participant = active.participantNpcId
    ? (state.npcs.find((n) => n.npcId === active.participantNpcId) ?? null)
    : null;
  const selectable = evaluateChoices(state, event, participant, content).filter((c) => c.selectable);
  if (selectable.length === 0) return null;
  if (policy === 'random') return rng.pick(selectable).choice.id;

  const view = toPublicActiveEvent(state, content);
  const fatal = new Set(view?.choices.filter((c) => c.fatalWarning).map((c) => c.id));
  const safe = selectable.filter((c) => !fatal.has(c.choice.id));
  const pool = safe.length > 0 ? safe : selectable;
  const score = (id: string) =>
    (pool.find((c) => c.choice.id === id)?.choice.guaranteedEffects ?? []).reduce(
      (sum, e) => sum + (e.type === 'RESOURCE_DELTA' ? e.amount : 0),
      0,
    ) +
    (pool.find((c) => c.choice.id === id)?.chance?.chance ?? 0.5) * 5;
  return [...pool].sort((a, b) => score(b.choice.id) - score(a.choice.id))[0]!.choice.id;
}

export function autoPlay(seed: string, policy: AutoPlayPolicy, content: ContentIndex): AutoPlayResult {
  const policyRng = SeededRng.derive(seed, 'policy');
  const now = '2026-11-17T00:00:00.000Z';
  let state = createRun(
    {
      runId: `sim-${seed}`,
      guestOwnerId: 'sim',
      seed,
      profile: { displayName: '시뮬', gender: 'UNSPECIFIED' },
      now,
    },
    content,
  );
  state = chooseCharacter(state, policyRng.pick(state.characterCards).cardId, content);
  state = applyForJob(state, policyRng.pick(state.jobOffers).offerId, content).state;

  const maxMonths = (content.pack.rules.retireAge - content.pack.rules.startAge) * 12 + 1;
  for (let i = 0; i <= maxMonths; i++) {
    if (state.phase === 'GAME_OVER') break;
    try {
      state = startMonth(state, content);
      const choiceId = pickChoice(state, policy, policyRng, content);
      if (!choiceId) {
        return {
          seed,
          endingType: null,
          category: null,
          age: null,
          months: i,
          stuck: `no choice in ${state.activeEvent?.eventId}`,
        };
      }
      state = chooseInMonth(state, choiceId, content).state;
      state = nextMonth(state, content, now);
    } catch (err) {
      const msg = err instanceof EngineError ? `${err.code}: ${err.message}` : String(err);
      return { seed, endingType: null, category: null, age: null, months: i, stuck: msg };
    }
  }
  const e = state.ending;
  return {
    seed,
    endingType: e?.type ?? null,
    category: e?.category ?? null,
    age: e?.age ?? null,
    months: state.turnIndex,
    stuck: e ? null : 'did not finish',
  };
}
