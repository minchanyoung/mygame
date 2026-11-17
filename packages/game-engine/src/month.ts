import { RESOURCE_KEYS, turnInfo, type GameRunState, type ScheduledEvent } from '@company-life/shared';
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

export interface Settlement {
  netSalary: number;
  livingCost: number;
  interest: number;
}

/**
 * §6.1 월간 정산 (간략 게임 모델, 실제 세법·금융 아님): 세후 월급 → 생활비 → 부채 이자 → 자연 변화.
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
  const netSalary = gross - Math.floor((gross * monthly.taxPermille) / 1000);
  const interest = Math.floor((state.debt * monthly.debtInterestPermille) / 1000);
  const livingCost = monthly.livingCost;

  let cash = state.cash + netSalary - livingCost;
  let debt = state.debt + interest;
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
    settlement: { netSalary, livingCost, interest },
  };
}

/**
 * 이번 달 사건 선정: 기한이 된 예약 이벤트가 우선(dueTurn → priority 높은 순 → scheduleId),
 * 없으면 가중치 추첨, 후보가 없으면 폴백. 최대 지연을 넘긴 예약은 EXPIRED 처리한다.
 */
function pickMonthlyEvent(
  state: GameRunState,
  rng: SeededRng,
  content: ContentIndex,
): { selection: EventSelection; scheduledEvents: ScheduledEvent[] } {
  const scheduledEvents = state.scheduledEvents.map((s) =>
    s.status === 'PENDING' && state.turnIndex > s.dueTurn + MAX_SCHEDULE_DELAY_MONTHS
      ? { ...s, status: 'EXPIRED' as const }
      : s,
  );
  const due = scheduledEvents
    .filter((s) => s.status === 'PENDING' && s.dueTurn <= state.turnIndex)
    .sort(
      (a, b) => a.dueTurn - b.dueTurn || b.priority - a.priority || a.scheduleId.localeCompare(b.scheduleId),
    );
  for (const s of due) {
    const event = content.events.get(s.eventId);
    if (event && evaluateChoices(state, event, null, content).some((c) => c.selectable)) {
      return {
        selection: { eventId: s.eventId, participantNpcId: null },
        scheduledEvents: scheduledEvents.map((x) =>
          x.scheduleId === s.scheduleId ? { ...x, status: 'DONE' as const } : x,
        ),
      };
    }
  }
  return { selection: selectEvent(getEligibleEvents(state, content), rng, content), scheduledEvents };
}

/** MONTH_START --startMonth--> EVENT_PENDING: 정산과 사건 선정을 한 번에 원자적으로 처리 (§20.1). */
export function startMonth(
  state: GameRunState,
  content: ContentIndex,
  forced?: EventSelection,
): GameRunState {
  assertCommand(state.phase, 'startMonth');
  assertTransition(state.phase, 'startMonth', 'EVENT_PENDING');
  const start = { resources: { ...state.resources }, cash: state.cash, debt: state.debt };
  const settled = applyMonthlySettlement(state, content);
  const rng = new SeededRng(settled.state.rngState);
  // forced는 플레이테스트 도구 전용 (추첨을 건너뛰고 지정 사건을 연다)
  const { selection, scheduledEvents } = forced
    ? { selection: forced, scheduledEvents: settled.state.scheduledEvents }
    : pickMonthlyEvent(settled.state, rng, content);
  const opened = openEvent({ ...settled.state, scheduledEvents, rngState: rng.state }, selection, content);
  return {
    ...opened,
    currentMonth: { turnIndex: state.turnIndex, start, settlement: settled.settlement, eventResult: null },
  };
}

/** EVENT_PENDING --choose--> MONTH_SUMMARY: 사건 판정 후 실직 원인을 판정해 pendingEnding에 기록 (§26.2). */
export function chooseInMonth(
  state: GameRunState,
  choiceId: string,
  content: ContentIndex,
): { state: GameRunState; result: ChoiceResolution } {
  const resolved = resolveChoice(state, choiceId, content);
  const r = resolved.result;
  const withLog: GameRunState = {
    ...resolved.state,
    currentMonth: resolved.state.currentMonth && {
      ...resolved.state.currentMonth,
      eventResult: {
        eventId: r.eventId,
        choiceId: r.choiceId,
        success: r.success,
        resultText: r.resultText,
        traitChanges: r.traitChanges.map(({ kind, id, from, to }) => ({ kind, id, from, to })),
      },
    },
  };
  return { state: withPendingEnding(withLog, content), result: r };
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
