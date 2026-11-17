import {
  turnInfo,
  type Effect,
  type EndingType,
  type GameRunState,
  type PlayerRank,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { inflate, priceIndex } from './economy';
import { EngineError } from './errors';
import { evaluateChoices, type ChoiceEvaluation } from './events';
import { applyForJob } from './jobs';
import { chooseInMonth, nextMonth, startMonth } from './month';
import { SeededRng } from './rng';
import { chooseCharacter, chooseGoal, createRun } from './run';
import { acceptTransfer, declineTransfer } from './transfer';
import { toPublicActiveEvent } from './view';

/**
 * §13.3 자동 플레이 봇. 정책 선택용 난수는 게임 판정 RNG와 분리된 스트림을 쓴다.
 * - random: 고를 수 있는 선택지 중 무작위
 * - cautious: 확정 비용으로 실직하는 선택지를 피하고, 자원 변화 기댓값(성공·실패 확률 반영,
 *   위험 구간 자원 손실 가중)이 가장 큰 선택지. 사람보다 정보가 많다(정확한 확률을 안다)는 점에 유의.
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
  /** S5: 최고 직급, 첫 승진 나이, 인생 목표와 달성 여부 */
  highestRank: PlayerRank | null;
  firstPromotionAge: number | null;
  goalId: string | null;
  goalAchieved: boolean | null;
  /** 종료 시점 자산·컨디션·S등급 횟수 (목표 수치 조정용) */
  finalCash: number;
  finalDebt: number;
  finalWellbeing: number;
  sGrades: number;
  /** S7 이직 횟수, 노후 등급 */
  transfers: number;
  retirementTier: string | null;
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

  // 자원 변화의 기댓값. 위험 구간(30 이하) 자원의 손실은 3배로 무겁게 본다.
  const weight = (key: keyof GameRunState['resources'], amount: number) =>
    amount < 0 && state.resources[key] <= 30 ? amount * 3 : amount;
  // 실직은 게임오버이므로 어떤 자원 손실보다 무겁게 본다
  const JOB_LOSS_PENALTY = -600;
  // 돈: 월 실수령 한 달 치 = 자원 8점으로 환산. 빚이 있거나 현금이 바닥이면 지출을 2배로 무겁게
  const monthly = Math.max(1, Math.floor((state.employment.current?.annualSalary ?? 0) / 12));
  const index = priceIndex(state, content);
  const tight = state.debt > 0 || state.cash < monthly * 2;
  const money = (won: number) => {
    const pts = (won / monthly) * 8;
    return pts < 0 && tight ? pts * 2 : pts;
  };
  const sum = (effects: readonly Effect[] | undefined) =>
    (effects ?? []).reduce(
      (s, e) =>
        s +
        (e.type === 'RESOURCE_DELTA'
          ? weight(e.key, e.amount)
          : e.type === 'EMPLOYMENT_CHANGE'
            ? JOB_LOSS_PENALTY
            : e.type === 'CASH_DELTA'
              ? money(inflate(e.amount, index))
              : e.type === 'SALARY_MONTHS'
                ? money(monthly * e.months)
                : e.type === 'COUNTER_OFFER'
                  ? money(((monthly * e.raisePermille) / 1000) * 24)
                  : // 이직 제안·임원 승진은 커리어 기회로 높게 본다 (사람도 노리는 목표)
                    e.type === 'TRANSFER_OFFER'
                    ? 25
                    : e.type === 'EXECUTIVE_PROMOTION'
                      ? 120
                      : 0),
      0,
    );
  const expected = (c: ChoiceEvaluation) => {
    const p = c.chance?.chance ?? 1;
    const outcome = c.chance
      ? p * sum(c.choice.onSuccess?.effects) + (1 - p) * sum(c.choice.onFailure?.effects)
      : 0;
    return sum(c.choice.guaranteedEffects) + outcome;
  };
  return [...pool].sort((a, b) => expected(b) - expected(a))[0]!.choice.id;
}

function careerStats(
  state: GameRunState,
  content: ContentIndex,
): Omit<AutoPlayResult, 'seed' | 'endingType' | 'category' | 'age' | 'months' | 'stuck'> {
  const first = state.eventHistory.find((h) => h.kind === 'PROMOTION');
  return {
    highestRank: state.statistics.highestRank,
    firstPromotionAge: first ? turnInfo(first.turnIndex, content.pack.rules.startAge).age : null,
    goalId: state.lifeGoal?.goalId ?? null,
    goalAchieved: state.ending?.goal?.achieved ?? null,
    finalCash: state.cash,
    finalDebt: state.debt,
    finalWellbeing: Math.min(state.resources.health, state.resources.mental),
    sGrades: state.annualReviews.filter((r) => r.grade === 'S').length,
    transfers: state.statistics.transfers,
    retirementTier: state.ending?.retirementTier ?? null,
  };
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
  state = chooseGoal(state, policyRng.pick(state.lifeGoalOffers), content);
  state = applyForJob(state, policyRng.pick(state.jobOffers).offerId, content).state;

  const maxMonths = (content.pack.rules.retireAge - content.pack.rules.startAge) * 12 + 1;
  for (let i = 0; i <= maxMonths; i++) {
    if (state.phase === 'GAME_OVER') break;
    try {
      state = startMonth(state, content);
      // 한 달에 사건이 여러 개 (업무 → 일상)
      for (let guard = 0; state.phase === 'EVENT_PENDING' && guard < 5; guard++) {
        const choiceId = pickChoice(state, policy, policyRng, content);
        if (!choiceId) {
          return {
            ...careerStats(state, content),
            seed,
            endingType: null,
            category: null,
            age: null,
            months: i,
            stuck: `no choice in ${state.activeEvent?.eventId}`,
          };
        }
        state = chooseInMonth(state, choiceId, content).state;
      }
      // S7 이직 제안서: 무작위 봇은 동전 던지기, 신중 봇은 포인트가 거의 다 찼으면 남고 아니면 옮긴다
      if (state.phase === 'MONTH_SUMMARY' && state.transferOffer && !state.pendingEnding) {
        const job = state.employment.current!;
        const step = content.pack.rules.promotion.ladder.find((s) => s.from === job.rank);
        const nearPromotion = step !== undefined && job.promotionPoints >= step.points - 1;
        const take = policy === 'random' ? policyRng.nextFloat() < 0.5 : !nearPromotion;
        state = take ? acceptTransfer(state, content) : declineTransfer(state);
      }
      state = nextMonth(state, content, now);
    } catch (err) {
      const msg = err instanceof EngineError ? `${err.code}: ${err.message}` : String(err);
      return {
        ...careerStats(state, content),
        seed,
        endingType: null,
        category: null,
        age: null,
        months: i,
        stuck: msg,
      };
    }
  }
  const e = state.ending;
  return {
    ...careerStats(state, content),
    seed,
    endingType: e?.type ?? null,
    category: e?.category ?? null,
    age: e?.age ?? null,
    months: state.turnIndex,
    stuck: e ? null : 'did not finish',
  };
}
