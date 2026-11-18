import {
  eventSlot,
  RESOURCE_KEYS,
  turnInfo,
  type EventResult,
  type EventSlot,
  type GameRunState,
  type MonthlyAction,
  type ScheduledEvent,
} from '@company-life/shared';
import { processAnnualReview, processSalaryAdjustment } from './annual';
import type { ContentIndex } from './content-index';
import { withYearlyRecord } from './chronicle';
import { buildEnding, debtLimit, finalizeEnding, withPendingEnding } from './ending';
import { difficultyKnobs, inflate, priceIndex } from './economy';
import { EngineError } from './errors';
import { updateLifeGoalMilestone } from './goals';
import { rollNpcLife } from './npc-life';
import { currentTeamNpcs } from './npcs';
import { applyMonthlyAction, assertActionAvailable, defaultActionId } from './monthly-actions';
import { processPromotion } from './promotion';
import {
  evaluateChoices,
  getEligibleEvents,
  openEvent,
  resolveChoice,
  selectEvent,
  type ChoiceResolution,
  type EventSelection,
} from './events';
import { clampStat } from './numbers';
import { SeededRng } from './rng';
import { assertCommand, assertTransition } from './state-machine';

/** §20.1 예약 이벤트 최대 지연 */
export const MAX_SCHEDULE_DELAY_MONTHS = 3;

/** S9 '무너지기 직전'으로 세는 월말 체력·정신력 */
export const NEAR_COLLAPSE = 10;

/** 한 달에 열리는 사건 칸 순서: 업무 → 일상 */
export const MONTH_SLOTS: readonly EventSlot[] = ['work', 'life'];

export interface Settlement {
  grossSalary: number;
  tax: number;
  netSalary: number;
  livingCost: number;
  livingBreakdown: { housing: number; food: number; transport: number; misc: number };
  interest: number;
  debtRepayment: number;
}

/**
 * §6.1 월간 정산 (간략 게임 모델, 실제 세법·금융 아님):
 * 세후 월급 → 생활비(주거·식비·교통통신·기타) → 부채 이자 → 원금 상환 → 자연 변화.
 * 모든 금액은 원화 정수. 현금이 모자라면 부족분만 부채로 전환한다 (§20.2).
 */
export function applyMonthlySettlement(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; settlement: Settlement } {
  const { monthly } = content.pack.rules;
  const job = state.employment.current;
  if (state.employment.status !== 'EMPLOYED' || !job) {
    throw new EngineError('INVARIANT_VIOLATION', 'monthly settlement requires employment');
  }
  const gross = Math.floor(job.annualSalary / 12);
  const tax = Math.floor((gross * monthly.taxPermille) / 1000);
  const netSalary = gross - tax;
  // 물가 상승: 해마다 복리로 오른 생활비 (천 원 단위)
  // S10 난이도는 생활비 배율로 물가 지수에 곱한다
  const prices = priceIndex(state, content);
  const index = (prices * difficultyKnobs(state, content).livingCostPermille) / 1000;
  const grow = (n: number) => inflate(n, index);
  const livingBreakdown = {
    housing: grow(monthly.livingCosts.housing),
    food: grow(monthly.livingCosts.food),
    transport: grow(monthly.livingCosts.transport),
    misc: grow(monthly.livingCosts.misc),
  };
  const livingCost =
    livingBreakdown.housing + livingBreakdown.food + livingBreakdown.transport + livingBreakdown.misc;
  const interest = Math.floor((state.debt * monthly.debtInterestPermille) / 1000);

  let cash = state.cash + netSalary - livingCost;
  let debt = state.debt + interest;
  // 원금 상환은 실제로 낼 현금이 있을 때만 (빚으로 빚을 갚지 않는다)
  // 상환 상한도 물가를 따라 오른다 (고정이면 후반에 이자를 못 따라가 빚이 저절로 불어남)
  const debtRepayment = Math.max(0, Math.min(debt, inflate(monthly.debtRepayment, prices), cash));
  cash -= debtRepayment;
  debt -= debtRepayment;
  if (cash < 0) {
    debt += -cash;
    cash = 0;
  }
  // 자연 변화 + 직급 부담 (과장 이상은 회복이 줄어든다)
  const burden = content.pack.rules.promotion.rankBurden[job.rank] ?? {};
  // S7 나이 듦: 50세·55세부터 체력 회복 감소 (누적)
  const age = turnInfo(state.turnIndex, content.pack.rules.startAge).age;
  const aging = content.pack.rules.aging.filter((a) => age >= a.fromAge);
  const resources = { ...state.resources };
  for (const key of RESOURCE_KEYS) {
    const agingDelta = aging.reduce((s, a) => s + (a.naturalChange[key] ?? 0), 0);
    resources[key] = clampStat(
      resources[key] + (monthly.naturalChange[key] ?? 0) + (burden[key] ?? 0) + agingDelta,
    );
  }
  return {
    state: {
      ...state,
      cash,
      debt,
      resources,
      statistics: {
        ...state.statistics,
        totalEarned: state.statistics.totalEarned + netSalary,
        totalSpent: state.statistics.totalSpent + livingCost + interest,
      },
    },
    settlement: { grossSalary: gross, tax, netSalary, livingCost, livingBreakdown, interest, debtRepayment },
  };
}

/**
 * 이번 달 사건 2개 선정 (업무 칸 → 일상 칸).
 * 칸마다: 기한이 된 예약 사건 우선(dueTurn → priority 높은 순 → scheduleId), 없으면 그 칸의 가중치 추첨,
 * 후보가 없으면 그 칸의 폴백. 최대 지연을 넘긴 예약은 EXPIRED 처리한다.
 */
function pickMonthlyEvents(
  state: GameRunState,
  rng: SeededRng,
  content: ContentIndex,
): { selections: EventSelection[]; scheduledEvents: ScheduledEvent[] } {
  let scheduledEvents = state.scheduledEvents.map((s) =>
    s.status === 'PENDING' && state.turnIndex > s.dueTurn + MAX_SCHEDULE_DELAY_MONTHS
      ? { ...s, status: 'EXPIRED' as const }
      : s,
  );
  const selections: EventSelection[] = [];
  for (const slot of MONTH_SLOTS) {
    const due = scheduledEvents
      .filter((s) => s.status === 'PENDING' && s.dueTurn <= state.turnIndex)
      .filter((s) => {
        const ev = content.events.get(s.eventId);
        return ev !== undefined && eventSlot(ev) === slot;
      })
      .sort(
        (a, b) =>
          a.dueTurn - b.dueTurn || b.priority - a.priority || a.scheduleId.localeCompare(b.scheduleId),
      );
    const npcOf = (id: string | null) => (id ? (state.npcs.find((n) => n.npcId === id) ?? null) : null);
    const scheduled = due.find((s) => {
      const ev = content.events.get(s.eventId)!;
      return evaluateChoices(state, ev, npcOf(s.participantNpcId), content).some((c) => c.selectable);
    });
    if (scheduled) {
      // S8 연재: 참여 동료를 이어받는다. 그 동료가 팀을 떠났으면 연재의 정리 화로 대신한다.
      const ev = content.events.get(scheduled.eventId)!;
      const stillHere =
        !scheduled.participantNpcId ||
        currentTeamNpcs(state).some((t) => t.npc.npcId === scheduled.participantNpcId);
      const farewell = ev.series?.farewellEventId;
      selections.push({
        eventId: !stillHere && farewell ? farewell : scheduled.eventId,
        participantNpcId: scheduled.participantNpcId,
      });
      scheduledEvents = scheduledEvents.map((x) =>
        x.scheduleId === scheduled.scheduleId ? { ...x, status: 'DONE' as const } : x,
      );
      continue;
    }
    const taken = new Set(selections.map((s) => s.eventId));
    const candidates = getEligibleEvents(state, content, slot).filter((c) => !taken.has(c.event.id));
    // S12 보장 사건(직무 연재 1화): 기한이 지났고 조건이 맞으면 추첨 없이 연다
    const guaranteed = candidates.find(
      (c) => c.event.guaranteeFromTurn !== undefined && state.turnIndex >= c.event.guaranteeFromTurn,
    );
    selections.push(selectEvent(guaranteed ? [guaranteed] : candidates, rng, content, slot));
  }
  return { selections, scheduledEvents };
}

export interface StartMonthOptions {
  /** S11 이번 달 행동 (생략하면 지난달 행동, 잠겼으면 기본 행동) */
  actionId?: MonthlyAction;
  /** 플레이테스트 도구 전용 (추첨을 건너뛰고 지정 사건 1개만 연다) */
  forced?: EventSelection;
}

/** MONTH_START --startMonth--> EVENT_PENDING: 정산·정기 처리·행동·사건 선정을 한 번에 원자적으로 (§20.1). */
export function startMonth(
  state: GameRunState,
  content: ContentIndex,
  options: StartMonthOptions = {},
): GameRunState {
  const { forced } = options;
  assertCommand(state.phase, 'startMonth');
  assertTransition(state.phase, 'startMonth', 'EVENT_PENDING');
  const start = { resources: { ...state.resources }, cash: state.cash, debt: state.debt };
  const actionId = options.actionId ?? defaultActionId(state, content);
  assertActionAvailable(state, actionId, content);
  // §20.1 순서: 1월 연봉 조정 → 1월 승진 심사(직급·상사 재배치) → 정산 → 12월 인사평가 → 사건 선정
  const adjusted = processSalaryAdjustment(state, content);
  const promoted = processPromotion(adjusted.state, content);
  const settled = applyMonthlySettlement(promoted.state, content);
  // S11 퇴근 후 행동: 정산 직후, 12월 평가 전 (12월 행동도 그해 성과에 들어간다)
  const acted = applyMonthlyAction(settled.state, actionId, content);
  const reviewed0 = processAnnualReview(acted.state, content);
  // S9 연간 기록: 인사평가가 처리된 달(12월)에 한 줄 남긴다
  const annual = reviewed0.review
    ? { ...reviewed0, state: withYearlyRecord(reviewed0.state, content, reviewed0.review.grade) }
    : reviewed0;
  // S8 동료의 인생: 소식과 그에 따른 후속 사건 예약 (사건 선정 전)
  const life = rollNpcLife(annual.state, content);
  const reviewed = { state: life.state, review: annual.review };
  const rng = new SeededRng(reviewed.state.rngState);
  // forced는 플레이테스트 도구 전용 (추첨을 건너뛰고 지정 사건 1개만 연다)
  const { selections, scheduledEvents } = forced
    ? { selections: [forced], scheduledEvents: reviewed.state.scheduledEvents }
    : pickMonthlyEvents(reviewed.state, rng, content);
  const [first, ...rest] = selections;
  if (!first) throw new EngineError('INVARIANT_VIOLATION', 'no event selected');
  const opened = openEvent(
    { ...reviewed.state, scheduledEvents, rngState: rng.state, pendingEvents: rest },
    first,
    content,
  );
  return {
    ...opened,
    currentMonth: {
      turnIndex: state.turnIndex,
      start,
      settlement: settled.settlement,
      annualReview: reviewed.review,
      salaryAdjustment: adjusted.adjustment,
      promotion: promoted.result,
      news: life.news,
      goalMilestone: null,
      eventResults: [],
      action: acted.result,
    },
  };
}

/**
 * EVENT_PENDING --choose--> EVENT_PENDING(다음 사건) | MONTH_SUMMARY.
 * 사건마다 결과 이야기를 기록하고 실직 원인을 판정한다. 실직이 예고되면 남은 사건은 열지 않는다 (§26.2).
 */
export function chooseInMonth(
  state: GameRunState,
  choiceId: string,
  content: ContentIndex,
): { state: GameRunState; result: ChoiceResolution } {
  const participantNpcId = state.activeEvent?.participantNpcId ?? null;
  const resolved = resolveChoice(state, choiceId, content);
  const r = resolved.result;
  const after = resolved.state;

  // 이 사건만으로 생긴 변화 (정산은 이미 startMonth에서 반영됨)
  const resourceDelta: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) resourceDelta[key] = after.resources[key] - state.resources[key];
  const npcChanges = after.npcs.flatMap((npc) => {
    const before = state.npcs.find((n) => n.npcId === npc.npcId);
    return npc.relationshipHistory
      .slice(before?.relationshipHistory.length ?? 0)
      .map((h) => ({ npcId: npc.npcId, stat: h.stat, delta: h.to - h.from }))
      .filter((c) => c.delta !== 0);
  });

  const result: EventResult = {
    occurrenceId: r.occurrenceId,
    eventId: r.eventId,
    choiceId: r.choiceId,
    participantNpcId,
    success: r.success,
    resultText: r.resultText,
    traitChanges: r.traitChanges.map(({ kind, id, from, to }) => ({ kind, id, from, to })),
    resourceDelta,
    cashDelta: after.cash - state.cash,
    debtDelta: after.debt - state.debt,
    factors: r.factors
      .filter((f) => f.source !== 'BASE')
      .map((f) => ({
        source: f.source as EventResult['factors'][number]['source'],
        id: f.id ?? '',
        level: f.level ?? null,
        positive: f.bonus > 0,
      })),
    npcChanges,
    followUpScheduled: after.scheduledEvents.some((s) => s.sourceOccurrenceId === r.occurrenceId),
  };

  const logged = withPendingEnding(
    {
      ...after,
      currentMonth: after.currentMonth && {
        ...after.currentMonth,
        eventResults: [...after.currentMonth.eventResults, result],
      },
    },
    content,
  );

  // 다음 사건이 남아 있고 실직 예고가 없으면 이어서 연다
  const [next, ...rest] = logged.pendingEvents;
  if (next && !logged.pendingEnding) {
    assertTransition(state.phase, 'choose', 'EVENT_PENDING');
    return { state: openEvent({ ...logged, pendingEvents: rest }, next, content), result: r };
  }

  // 달이 끝남: 이번 달 고위험 사건이 있었는지로 연속 고위험 개월 수를 갱신 (§21.3)
  const thisMonthHighRisk = logged.eventOccurrences.some(
    (o) => o.turnIndex === state.turnIndex && o.highRisk,
  );
  // 인생 목표 축하 구간 (실직이 예고된 달은 생략)
  const goal = logged.pendingEnding
    ? { state: logged, milestone: null }
    : updateLifeGoalMilestone(logged, content);
  const closed = {
    ...goal.state,
    currentMonth: goal.state.currentMonth && { ...goal.state.currentMonth, goalMilestone: goal.milestone },
  };
  const streak = thisMonthHighRisk ? state.statistics.consecutiveHighRiskMonths + 1 : 0;
  const wellbeing = Math.min(closed.resources.health, closed.resources.mental);
  const limit = debtLimit(closed, content);
  const debtPermille = limit ? Math.floor((closed.debt * 1000) / limit) : 0;
  return {
    state: {
      ...closed,
      pendingEvents: [],
      statistics: {
        ...closed.statistics,
        consecutiveHighRiskMonths: streak,
        lowestWellbeing: Math.min(closed.statistics.lowestWellbeing, wellbeing),
        // S9 별명 판정용 커리어 통계
        nearCollapseMonths: closed.statistics.nearCollapseMonths + (wellbeing <= NEAR_COLLAPSE ? 1 : 0),
        maxHighRiskStreak: Math.max(closed.statistics.maxHighRiskStreak, streak),
        peakDebtPermille: Math.max(closed.statistics.peakDebtPermille, debtPermille),
      },
    },
    result: r,
  };
}

/**
 * MONTH_SUMMARY --nextMonth--> GAME_OVER | MONTH_START.
 * 예고된 엔딩이 있으면 턴을 올리지 않고 확정한다. 아니면 턴 +1, 은퇴 연령 도달 시 정년 은퇴.
 */
export function nextMonth(state: GameRunState, content: ContentIndex, now: string): GameRunState {
  assertCommand(state.phase, 'nextMonth');
  if (state.pendingEnding) {
    assertTransition(state.phase, 'nextMonth', 'GAME_OVER');
    return finalizeEnding(withYearlyRecord(state, content, null), state.pendingEnding, now);
  }
  // 받지 않은 이직 제안서는 이달로 만료
  const advanced: GameRunState = {
    ...state,
    turnIndex: state.turnIndex + 1,
    currentMonth: null,
    transferOffer: null,
  };
  if (turnInfo(advanced.turnIndex, content.pack.rules.startAge).age >= content.pack.rules.retireAge) {
    assertTransition(state.phase, 'nextMonth', 'GAME_OVER');
    return finalizeEnding(
      withYearlyRecord(advanced, content, null),
      buildEnding(advanced, 'RETIREMENT', null, content),
      now,
    );
  }
  assertTransition(state.phase, 'nextMonth', 'MONTH_START');
  return { ...advanced, phase: 'MONTH_START' };
}
