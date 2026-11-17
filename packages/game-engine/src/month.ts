import {
  eventSlot,
  RESOURCE_KEYS,
  turnInfo,
  type EventResult,
  type EventSlot,
  type GameRunState,
  type ScheduledEvent,
} from '@company-life/shared';
import { processAnnualReview, processSalaryAdjustment } from './annual';
import type { ContentIndex } from './content-index';
import { buildEnding, finalizeEnding, withPendingEnding } from './ending';
import { EngineError } from './errors';
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
  const livingBreakdown = { ...monthly.livingCosts };
  const livingCost =
    livingBreakdown.housing + livingBreakdown.food + livingBreakdown.transport + livingBreakdown.misc;
  const interest = Math.floor((state.debt * monthly.debtInterestPermille) / 1000);

  let cash = state.cash + netSalary - livingCost;
  let debt = state.debt + interest;
  // 원금 상환은 실제로 낼 현금이 있을 때만 (빚으로 빚을 갚지 않는다)
  const debtRepayment = Math.max(0, Math.min(debt, monthly.debtRepayment, cash));
  cash -= debtRepayment;
  debt -= debtRepayment;
  if (cash < 0) {
    debt += -cash;
    cash = 0;
  }
  const resources = { ...state.resources };
  for (const key of RESOURCE_KEYS) {
    resources[key] = clampStat(resources[key] + (monthly.naturalChange[key] ?? 0));
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
    const scheduled = due.find((s) => {
      const ev = content.events.get(s.eventId)!;
      return evaluateChoices(state, ev, null, content).some((c) => c.selectable);
    });
    if (scheduled) {
      selections.push({ eventId: scheduled.eventId, participantNpcId: null });
      scheduledEvents = scheduledEvents.map((x) =>
        x.scheduleId === scheduled.scheduleId ? { ...x, status: 'DONE' as const } : x,
      );
      continue;
    }
    const taken = new Set(selections.map((s) => s.eventId));
    const candidates = getEligibleEvents(state, content, slot).filter((c) => !taken.has(c.event.id));
    selections.push(selectEvent(candidates, rng, content, slot));
  }
  return { selections, scheduledEvents };
}

/** MONTH_START --startMonth--> EVENT_PENDING: 정산·정기 처리·사건 선정을 한 번에 원자적으로 (§20.1). */
export function startMonth(
  state: GameRunState,
  content: ContentIndex,
  forced?: EventSelection,
): GameRunState {
  assertCommand(state.phase, 'startMonth');
  assertTransition(state.phase, 'startMonth', 'EVENT_PENDING');
  const start = { resources: { ...state.resources }, cash: state.cash, debt: state.debt };
  // §20.1 순서: 1월 연봉 조정(급여 정산 전) → 정산 → 12월 인사평가 → 사건 선정
  const adjusted = processSalaryAdjustment(state, content);
  const settled = applyMonthlySettlement(adjusted.state, content);
  const reviewed = processAnnualReview(settled.state, content);
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
      eventResults: [],
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
  return {
    state: {
      ...logged,
      pendingEvents: [],
      statistics: {
        ...logged.statistics,
        consecutiveHighRiskMonths: thisMonthHighRisk ? state.statistics.consecutiveHighRiskMonths + 1 : 0,
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
    return finalizeEnding(state, state.pendingEnding, now);
  }
  const advanced: GameRunState = { ...state, turnIndex: state.turnIndex + 1, currentMonth: null };
  if (turnInfo(advanced.turnIndex, content.pack.rules.startAge).age >= content.pack.rules.retireAge) {
    assertTransition(state.phase, 'nextMonth', 'GAME_OVER');
    return finalizeEnding(advanced, buildEnding(advanced, 'RETIREMENT', null, content), now);
  }
  assertTransition(state.phase, 'nextMonth', 'MONTH_START');
  return { ...advanced, phase: 'MONTH_START' };
}
