import { newSeason, seasonAvailable } from './season';
import {
  eventSlot,
  type Choice,
  type Effect,
  type EventDefinition,
  type EventSlot,
  type GameRunState,
  type Npc,
  type RiskLevel,
} from '@company-life/shared';
import { calculateChoiceChance, riskLevel, type ChanceBreakdownItem, type ChanceResult } from './chance';
import { matchesConditions, npcMatches, type EvalContext } from './conditions';
import { requireFrom, type ContentIndex } from './content-index';
import { applyEffects, levelEffectsApplicable, type TraitChange } from './effects';
import { EngineError } from './errors';
import { currentTeamNpcs } from './npcs';
import { difficultyKnobs, priceIndex } from './economy';
import { generateTransferOffer } from './transfer';
import { cloneForEffects } from './numbers';
import { SeededRng } from './rng';
import { assertCommand, assertTransition } from './state-machine';

export interface ChoiceEvaluation {
  choice: Choice;
  /** visibleIf 충족 + 레벨 효과 적용 가능 */
  visible: boolean;
  /** enabledIf 충족 */
  enabled: boolean;
  selectable: boolean;
  chance: ChanceResult | null;
  risk: RiskLevel | null;
}

function allChoiceEffects(choice: Choice): Effect[] {
  return [
    ...(choice.guaranteedEffects ?? []),
    ...(choice.onSuccess?.effects ?? []),
    ...(choice.onFailure?.effects ?? []),
  ];
}

/** §21.3 선택지 유효성 포함 평가. 레벨 효과의 from이 현재 레벨과 다르면 숨긴다 (중복 지급 방지). */
export function evaluateChoices(
  state: GameRunState,
  event: EventDefinition,
  participant: Npc | null,
  content: ContentIndex,
): ChoiceEvaluation[] {
  const ctx: EvalContext = { participant };
  return event.choices.map((choice) => {
    const visible =
      matchesConditions(state, choice.visibleIf, ctx, content) &&
      levelEffectsApplicable(state, allChoiceEffects(choice));
    const enabled = matchesConditions(state, choice.enabledIf, ctx, content);
    const chance = calculateChoiceChance(state, choice, ctx, content);
    return {
      choice,
      visible,
      enabled,
      selectable: visible && enabled,
      chance,
      risk: chance ? riskLevel(chance.chance, content.pack.rules) : null,
    };
  });
}

/** §26.3 체력·정신력·집중력·평판 중 하나라도 경고 임계치 이하 */
export function isInCriticalZone(state: GameRunState, content: ContentIndex): boolean {
  const t = content.pack.rules.gameOver.warningThreshold;
  return Object.values(state.resources).some((v) => v <= t);
}

export interface EventCandidate {
  event: EventDefinition;
  /** NPC 사건이면 조건을 만족하는 참여 후보, 아니면 [null] */
  participants: Array<Npc | null>;
  weight: number;
}

/** 발생 이력 요약을 한 번만 계산한다 (이벤트마다 전체 이력을 다시 훑지 않도록). */
function occurrenceStats(state: GameRunState, content: ContentIndex) {
  const count = new Map<string, number>();
  const lastTurn = new Map<string, number>();
  const lastGroupTurn = new Map<string, number>();
  for (const o of state.eventOccurrences) {
    count.set(o.eventId, (count.get(o.eventId) ?? 0) + 1);
    lastTurn.set(o.eventId, Math.max(lastTurn.get(o.eventId) ?? -Infinity, o.turnIndex));
    const group = content.events.get(o.eventId)?.exclusiveGroup;
    if (group) lastGroupTurn.set(group, Math.max(lastGroupTurn.get(group) ?? -Infinity, o.turnIndex));
  }
  return { count, lastTurn, lastGroupTurn };
}

/**
 * §7.3 / §21.3 후보 검증 → 추첨용 목록. 조건·쿨다운·횟수 제한·독점 그룹·연속 고위험 제한을 적용하고,
 * 선택 가능한 선택지가 하나도 없는 이벤트는 제외한다. 폴백(quiet_month)은 후보에 넣지 않는다.
 */
export function getEligibleEvents(
  state: GameRunState,
  content: ContentIndex,
  slot?: EventSlot,
): EventCandidate[] {
  const { rules, fallbackEventId, workFallbackEventId } = content.pack;
  const team = currentTeamNpcs(state);
  const highRiskBlocked = state.statistics.consecutiveHighRiskMonths >= rules.highRiskStreakLimit;
  // §26.3 위험 구간이면 회복(recovery) 이벤트 가중치 가산
  const critical = isInCriticalZone(state, content);
  const stats = occurrenceStats(state, content);
  const candidates: EventCandidate[] = [];

  for (const event of content.pack.events) {
    if (
      event.status !== 'published' ||
      event.id === fallbackEventId ||
      event.id === workFallbackEventId ||
      event.scheduledOnly
    )
      continue;
    if (slot && eventSlot(event) !== slot) continue;
    if (highRiskBlocked && event.highRisk) continue;

    const count = stats.count.get(event.id) ?? 0;
    if (event.maxOccurrencesPerRun !== undefined && count >= event.maxOccurrencesPerRun) continue;

    const cooldown = event.cooldownMonths ?? rules.defaultCooldownMonths;
    const last = stats.lastTurn.get(event.id);
    if (last !== undefined && state.turnIndex - last <= cooldown) continue;

    if (event.exclusiveGroup) {
      const lastInGroup = stats.lastGroupTurn.get(event.exclusiveGroup);
      if (lastInGroup !== undefined && state.turnIndex - lastInGroup <= cooldown) continue;
    }

    const npcCond = event.conditions?.npc;
    const pool: Array<Npc | null> = npcCond
      ? team.map((t) => t.npc).filter((n) => npcMatches(n, npcCond))
      : [null];
    const participants = pool.filter(
      (p) =>
        matchesConditions(state, event.conditions, { participant: p }, content) &&
        evaluateChoices(state, event, p, content).some((c) => c.selectable),
    );
    if (participants.length === 0) continue;

    // §8.3-1 팀 NPC 성향에 따른 가중치 변화
    let weight = event.weight;
    for (const m of event.npcWeightModifiers ?? []) {
      if (
        team.some(
          (t) => t.role === m.role && m.personalityAny.some((tag) => t.npc.personalityTags.includes(tag)),
        )
      ) {
        weight += m.add;
      }
    }
    if (critical && event.tags?.includes('recovery')) weight += rules.gameOver.recoveryWeightBonus;
    candidates.push({ event, participants, weight: Math.max(1, weight) });
  }
  return candidates;
}

export interface EventSelection {
  eventId: string;
  participantNpcId: string | null;
  /** S16 예약 사건이면 예약을 만든 사건 기록 */
  sourceOccurrenceId?: string | null;
}

/** 가중치 추첨 (가중치 ≠ 발생 확률). 후보가 없으면 항상 가능한 폴백 이벤트를 반환한다 (§21.3). */
export function selectEvent(
  candidates: readonly EventCandidate[],
  rng: SeededRng,
  content: ContentIndex,
  slot: EventSlot = 'life',
): EventSelection {
  if (candidates.length === 0) {
    const fallback = slot === 'work' ? content.pack.workFallbackEventId : content.pack.fallbackEventId;
    return { eventId: fallback, participantNpcId: null };
  }
  const picked = candidates[rng.weightedIndex(candidates.map((c) => c.weight))] as EventCandidate;
  const participant =
    picked.participants.length > 1 ? rng.pick(picked.participants) : (picked.participants[0] ?? null);
  return { eventId: picked.event.id, participantNpcId: participant?.npcId ?? null };
}

/**
 * 선정된 이벤트를 활성 사건으로 연다 (EVENT_PENDING). 월 시작 처리(startMonth)가 사용하며,
 * 테스트 픽스처에서도 특정 이벤트를 강제로 열 때 쓴다. 이벤트 버전을 함께 고정한다.
 */
export function openEvent(
  state: GameRunState,
  selection: EventSelection,
  content: ContentIndex,
): GameRunState {
  const event = requireFrom(content.events, selection.eventId, 'event');
  return {
    ...state,
    phase: 'EVENT_PENDING',
    activeEvent: {
      occurrenceId: `occ_t${state.turnIndex}_${state.eventOccurrences.length + 1}`,
      eventId: event.id,
      eventVersion: event.version,
      participantNpcId: selection.participantNpcId,
      presentedTurn: state.turnIndex,
      sourceOccurrenceId: selection.sourceOccurrenceId ?? null,
    },
  };
}

export interface ChoiceResolution {
  occurrenceId: string;
  eventId: string;
  choiceId: string;
  /** 판정 없는 선택지는 null */
  success: boolean | null;
  chance: number | null;
  roll: number | null;
  traitChanges: TraitChange[];
  resultText: string | null;
  /** 판정에 작용한 요인 (기본 확률 제외) */
  factors: ChanceBreakdownItem[];
}

/**
 * EVENT_PENDING --choose--> MONTH_SUMMARY.
 * 1) 해결 직전 상태로 확률 계산 → 2) 주 RNG로 판정 → 3) 확정 효과 + 성공/실패 효과를 복제본에 원자적으로 적용.
 * 영구 특성 변화는 판정이 끝난 뒤 적용되므로 같은 선택에 소급되지 않는다.
 * 같은 사건을 두 번 해결하려 하면 활성 사건이 없으므로 INVALID_PHASE로 거부된다(중복 지급 방지).
 */
export function resolveChoice(
  state: GameRunState,
  choiceId: string,
  content: ContentIndex,
): { state: GameRunState; result: ChoiceResolution } {
  assertCommand(state.phase, 'choose');
  const active = state.activeEvent;
  if (!active) throw new EngineError('INVARIANT_VIOLATION', 'EVENT_PENDING without activeEvent');
  const event = requireFrom(content.events, active.eventId, 'event');
  if (event.version !== active.eventVersion) {
    throw new EngineError(
      'CONTENT_VERSION_MISMATCH',
      `event ${event.id} v${active.eventVersion} is not loaded`,
    );
  }
  const participant = active.participantNpcId
    ? (state.npcs.find((n) => n.npcId === active.participantNpcId) ?? null)
    : null;

  const evaluation = evaluateChoices(state, event, participant, content).find(
    (c) => c.choice.id === choiceId,
  );
  if (!evaluation || !evaluation.selectable) {
    throw new EngineError('CHOICE_NOT_AVAILABLE', `choice ${choiceId} is not available`, {
      eventId: event.id,
      choiceId,
    });
  }
  const { choice, chance } = evaluation;

  const rng = new SeededRng(state.rngState);
  let success: boolean | null = null;
  let roll: number | null = null;
  if (chance) {
    const r = rng.roll(chance.chance);
    success = r.success;
    roll = r.roll;
  }

  assertTransition(state.phase, 'choose', 'MONTH_SUMMARY');
  const draft = cloneForEffects(state);
  const effectCtx = {
    eventId: event.id,
    occurrenceId: active.occurrenceId,
    participantNpcId: active.participantNpcId,
    priceIndex: priceIndex(state, content),
    lossPermille: difficultyKnobs(state, content).lossPermille,
  };
  // 조건부 효과의 when은 해결 "직전" 상태로 평가한다 (이번 결과로 얻은 특성은 소급되지 않음)
  const conditional = (choice.conditionalEffects ?? [])
    .filter(
      (ce) =>
        (ce.on === 'ALWAYS' ||
          (ce.on === 'SUCCESS' && success === true) ||
          (ce.on === 'FAILURE' && success === false)) &&
        matchesConditions(state, ce.when, { participant }, content),
    )
    .flatMap((ce) => ce.effects);
  const applied = [
    ...(choice.guaranteedEffects ?? []),
    ...(success === true ? (choice.onSuccess?.effects ?? []) : []),
    ...(success === false ? (choice.onFailure?.effects ?? []) : []),
    ...conditional,
  ];
  const traitChanges = [
    ...applyEffects(draft, choice.guaranteedEffects ?? [], effectCtx),
    ...(success === true ? applyEffects(draft, choice.onSuccess?.effects ?? [], effectCtx) : []),
    ...(success === false ? applyEffects(draft, choice.onFailure?.effects ?? [], effectCtx) : []),
    ...applyEffects(draft, conditional, effectCtx),
  ];
  // S7 이직 제안서: 회사·연봉 추첨은 시드 고정 스트림 (주 판정 RNG와 분리)
  if (applied.some((e) => e.type === 'TRANSFER_OFFER')) {
    draft.transferOffer = generateTransferOffer(draft, content);
  }
  // S19 시즌 목표 시작 (진행 중이면 그대로)
  const season = applied.find((e) => e.type === 'SEASON_START');
  if (season?.type === 'SEASON_START' && !draft.season && seasonAvailable(draft, season.kind)) {
    draft.season = newSeason(draft, season.kind, content);
  }

  draft.rngState = rng.state;
  draft.activeEvent = null;
  draft.phase = 'MONTH_SUMMARY';
  draft.eventOccurrences.push({
    occurrenceId: active.occurrenceId,
    eventId: event.id,
    eventVersion: event.version,
    turnIndex: state.turnIndex,
    choiceId,
    participantNpcId: active.participantNpcId,
    success,
    chance: chance?.chance ?? null,
    roll,
    highRisk: event.highRisk ?? false,
    sourceOccurrenceId: active.sourceOccurrenceId ?? null,
  });
  // 연속 고위험 개월 수는 한 달(사건 2개)이 끝날 때 chooseInMonth가 갱신한다
  draft.eventHistory.push({
    turnIndex: state.turnIndex,
    kind: 'EVENT_RESOLVED',
    summary: `${event.title} — ${choice.label}${success === null ? '' : success ? ' (성공)' : ' (실패)'}`,
    data: { eventId: event.id, choiceId, success },
  });

  const resultText =
    (success === true
      ? choice.onSuccess?.resultText
      : success === false
        ? choice.onFailure?.resultText
        : undefined) ??
    choice.resultText ??
    null;

  return {
    state: draft,
    result: {
      occurrenceId: active.occurrenceId,
      eventId: event.id,
      choiceId,
      success,
      chance: chance?.chance ?? null,
      roll,
      traitChanges,
      resultText,
      factors: (chance?.breakdown ?? []).filter((b) => b.source !== 'BASE'),
    },
  };
}
