import {
  RESOURCE_KEYS,
  type ActionLogEntry,
  type Effect,
  type EventDefinition,
  type GameRunState,
  type MonthActionResult,
  type MonthlyAction,
  type MonthlyActionDefinition,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { difficultyKnobs, inflate, priceIndex } from './economy';
import { applyEffects } from './effects';
import { EngineError } from './errors';
import { currentTeamNpcs } from './npcs';
import { cloneForEffects, roundKrw } from './numbers';
import { SeededRng } from './rng';

/**
 * S11 월간 행동: 출근 화면에서 고른 '퇴근 후 행동'을 정산 직후에 적용한다.
 * 효과는 확정 수치(공개)이고, 난수는 부업 수입·들킴·호감 대상뿐이다 (판정 RNG와 분리된 스트림).
 */

export function actionDef(content: ContentIndex, id: MonthlyAction): MonthlyActionDefinition {
  const def = content.pack.monthlyActions.actions.find((a) => a.id === id);
  if (!def) throw new EngineError('UNKNOWN_REFERENCE', `unknown monthly action: ${id}`);
  return def;
}

/** turnIndex에서 끝나는 같은 행동의 연속 개월 수 */
export function streakOf(log: readonly ActionLogEntry[], id: MonthlyAction, turnIndex: number): number {
  const byTurn = new Map(log.map((e) => [e.turnIndex, e.actionId]));
  let n = 0;
  while (byTurn.get(turnIndex - n) === id) n++;
  return n;
}

export const totalOf = (log: readonly ActionLogEntry[], id: MonthlyAction): number =>
  log.filter((e) => e.actionId === id).length;

/** 최근 window개월(turnIndex 포함)에 이 행동을 한 달 수 */
function recentCount(log: readonly ActionLogEntry[], id: MonthlyAction, turnIndex: number, window: number) {
  return log.filter((e) => e.actionId === id && e.turnIndex <= turnIndex && e.turnIndex > turnIndex - window)
    .length;
}

/** 지금 켜진 습관들 (turnIndex 기준) */
export function activeHabits(
  state: GameRunState,
  content: ContentIndex,
  turnIndex = state.turnIndex,
): MonthlyActionDefinition[] {
  return content.pack.monthlyActions.actions.filter(
    (a) => a.habit && recentCount(state.actionLog, a.id, turnIndex, a.habit.window) >= a.habit.min,
  );
}

export function actionCost(def: MonthlyActionDefinition, state: GameRunState, content: ContentIndex): number {
  return def.cost > 0 ? inflate(def.cost, priceIndex(state, content)) : 0;
}

/** 고를 수 없는 이유. 비용은 지금 가진 현금으로 낼 수 있어야 한다 (행동으로 빚지지 않게) */
export function actionLockReason(
  def: MonthlyActionDefinition,
  state: GameRunState,
  content: ContentIndex,
): string | null {
  return actionCost(def, state, content) > state.cash ? '현금이 모자라요' : null;
}

/** 기본 선택: 지난달 행동 (잠겼으면 기본 행동) */
export function defaultActionId(state: GameRunState, content: ContentIndex): MonthlyAction {
  const fallback = content.pack.monthlyActions.defaultAction;
  const last = state.actionLog.at(-1)?.actionId;
  if (!last) return fallback;
  return actionLockReason(actionDef(content, last), state, content) ? fallback : last;
}

/** 그해(yearIndex) 행동으로 쌓인 성과 점수 (상한 적용) */
export function yearActionPerformance(state: GameRunState, content: ContentIndex, yearIndex: number): number {
  const { performanceCap, actions } = content.pack.monthlyActions;
  const sum = state.actionLog
    .filter((e) => Math.floor(e.turnIndex / 12) === yearIndex)
    .reduce((s, e) => s + (actions.find((a) => a.id === e.actionId)?.performance ?? 0), 0);
  return Math.min(performanceCap, sum);
}

/**
 * 이번 달 행동·습관에 맞는 사건의 가중치 배율 (‰). Q3: 약간 더 자주.
 * 사건 후보마다 부르므로 행동 기록은 한 번만 훑고 판정 함수를 돌려준다.
 */
export function actionAffinity(
  state: GameRunState,
  content: ContentIndex,
): (event: EventDefinition) => number {
  const { affinityPermille } = content.pack.monthlyActions;
  const last = state.actionLog.at(-1);
  const now = last && last.turnIndex === state.turnIndex ? actionDef(content, last.actionId) : null;
  const habitTags = activeHabits(state, content).flatMap((h) => h.habit?.eventTags ?? []);
  if (!now && habitTags.length === 0) return () => 1000;
  return (event) => {
    const tags = event.tags ?? [];
    let mult = 1000;
    if (now && (now.eventCategories.includes(event.category) || now.eventTags.some((t) => tags.includes(t))))
      mult = (mult * affinityPermille) / 1000;
    for (const t of habitTags) if (tags.includes(t)) mult = (mult * affinityPermille) / 1000;
    return mult;
  };
}

const resourceEffects = (r: MonthlyActionDefinition['resources'] | undefined): Effect[] =>
  RESOURCE_KEYS.flatMap((key) => {
    const amount = r?.[key];
    return amount ? [{ type: 'RESOURCE_DELTA' as const, key, amount }] : [];
  });

/**
 * 고를 수 있는지 검사. 화면이 보여 준 것과 같도록 **월 시작(정산 전)** 상태로 판단한다.
 * (정산 뒤 현금이 모자라면 비용 부족분은 다른 지출처럼 빚이 된다)
 */
export function assertActionAvailable(
  state: GameRunState,
  actionId: MonthlyAction,
  content: ContentIndex,
): void {
  const locked = actionLockReason(actionDef(content, actionId), state, content);
  if (locked) throw new EngineError('CHOICE_NOT_AVAILABLE', `action ${actionId} locked: ${locked}`);
}

/** 이번 달 행동 적용 (정산 직후, assertActionAvailable 통과 후). 같은 달에 두 번 적용하지 않는다. */
export function applyMonthlyAction(
  state: GameRunState,
  actionId: MonthlyAction,
  content: ContentIndex,
): { state: GameRunState; result: MonthActionResult } {
  const def = actionDef(content, actionId);
  if (state.actionLog.some((e) => e.turnIndex === state.turnIndex))
    throw new EngineError('INVARIANT_VIOLATION', 'monthly action already applied this month');

  const draft = cloneForEffects(state);
  const turn = state.turnIndex;
  draft.actionLog = [...state.actionLog, { turnIndex: turn, actionId }];
  const streak = streakOf(draft.actionLog, actionId, turn);
  const total = totalOf(draft.actionLog, actionId);
  const rng = SeededRng.derive(state.seed, 'action', turn);
  const notes: string[] = [];
  const before = { resources: { ...draft.resources }, net: draft.cash - draft.debt };

  const effects: Effect[] = resourceEffects(def.resources);
  if (def.fatigue && streak >= def.fatigue.from) {
    effects.push(...resourceEffects(def.fatigue.resources));
    notes.push(def.fatigue.note);
  }
  if (def.cost > 0) effects.push({ type: 'CASH_DELTA', amount: -def.cost });

  // 부업: 세전 월급의 일정 비율. 들키면 평판을 잃고 그달 수입은 없다
  let income = 0;
  if (def.income) {
    const caught =
      def.risk !== undefined &&
      rng.nextFloat() * 1000 <
        Math.min(def.risk.maxPermille, def.risk.basePermille + def.risk.perStreakPermille * (streak - 1));
    if (caught && def.risk) {
      effects.push(...resourceEffects(def.risk.resources));
      notes.push(def.risk.note);
    } else {
      const gross = Math.floor((state.employment.current?.annualSalary ?? 0) / 12);
      const permille = rng.int(def.income.minPermille, def.income.maxPermille);
      income = roundKrw(Math.floor((gross * permille) / 1000), 10_000);
    }
  }

  // 인맥: 팀 동료(상사 포함) 한 명과 가까워진다
  let participantNpcId: string | null = null;
  if (def.favor) {
    const team = currentTeamNpcs(draft);
    if (team.length > 0) {
      const npc = rng.pick(team).npc;
      participantNpcId = npc.npcId;
      effects.push({ type: 'NPC_RELATION_DELTA', target: 'PARTICIPANT', stat: 'favor', amount: def.favor });
      notes.push(`${npc.name} 님과 한층 가까워졌다`);
    }
  }

  // 누적·연속 보상: 특성을 얻을 기회(사건 예약) 또는 특성 한 단계 (이미 있으면 없음)
  const opportunities: string[] = [];
  for (const m of def.milestones ?? []) {
    if ((m.by === 'total' ? total : streak) !== m.at) continue;
    const levels = m.kind === 'SKILL' ? draft.skills : draft.negativeTraits;
    const from = levels[m.traitId] ?? 0;
    const max = content.traits.get(m.traitId)?.maxLevel ?? 0;
    if (m.viaEventId) {
      // 기회 사건은 0→1 단계를 주므로 이미 그 특성이 있으면 예약하지 않는다. 이번 달 사건 선정에서 바로 열린다
      if (from > 0) continue;
      opportunities.push(m.viaEventId);
      if (m.note) notes.push(m.note);
      continue;
    }
    if (from >= max) continue;
    effects.push({
      type: m.kind === 'SKILL' ? 'SKILL_SET_LEVEL' : 'NEGATIVE_TRAIT_SET_LEVEL',
      id: m.traitId,
      from: from as 0 | 1,
      to: (from + 1) as 1 | 2,
    } as Effect);
  }

  // 습관: 최근 기록으로 켜진 효과 (어떤 행동을 골랐든)
  for (const h of activeHabits(draft, content, turn)) effects.push(...resourceEffects(h.habit?.resources));

  const changes = applyEffects(draft, effects, {
    eventId: `evt_action_${actionId}`,
    occurrenceId: `act_t${turn}`,
    participantNpcId,
    priceIndex: priceIndex(state, content),
    lossPermille: difficultyKnobs(state, content).lossPermille,
  });
  // 기회 사건: 이번 달 사건 선정에서 예약 사건으로 먼저 열린다 (그 칸에 다른 예약이 있으면 다음 달)
  opportunities.forEach((eventId, i) =>
    draft.scheduledEvents.push({
      scheduleId: `act_t${turn}_s${i}`,
      eventId,
      dueTurn: turn,
      priority: 5,
      sourceOccurrenceId: `act_t${turn}`,
      participantNpcId: null,
      status: 'PENDING',
    }),
  );
  if (income > 0) {
    draft.cash += income;
    draft.statistics.totalEarned += income;
  }

  const resourceDelta: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) resourceDelta[key] = draft.resources[key] - before.resources[key];
  return {
    state: draft,
    result: {
      actionId,
      resourceDelta,
      cashDelta: draft.cash - draft.debt - before.net,
      performance: def.performance > 0 ? yearActionPerformance(draft, content, Math.floor(turn / 12)) : 0,
      traitChanges: changes.map(({ kind, id, from, to }) => ({ kind, id, from, to })),
      streak,
      notes,
    },
  };
}
