import {
  type GameRunState,
  type PlaytestCatalog,
  type PlaytestDebugView,
  type PlaytestPatchRequest,
  type TraitLevels,
} from '@company-life/shared';
import { npcMatches } from './conditions';
import { requireFrom, type ContentIndex } from './content-index';
import { debtLimit } from './ending';
import { EngineError } from './errors';
import { higherRank } from './promotion';
import { evaluateChoices, getEligibleEvents } from './events';
import { startMonth } from './month';
import { currentTeamNpcs } from './npcs';
import { assertCommand } from './state-machine';

/**
 * 플레이테스트 도구 (개발·검수 전용). API에서 PLAYTEST_TOOLS=1일 때만 노출된다.
 * 모든 조작은 MONTH_START에서만 허용하고, run에 playtestModified를 영구 표시한다.
 */

function markModified(state: GameRunState, summary: string): GameRunState {
  return {
    ...state,
    playtestModified: true,
    eventHistory: [...state.eventHistory, { turnIndex: state.turnIndex, kind: 'PLAYTEST_OVERRIDE', summary }],
  };
}

function checkTraits(levels: TraitLevels, polarity: 'POSITIVE' | 'NEGATIVE', content: ContentIndex): void {
  for (const [id, level] of Object.entries(levels)) {
    const def = requireFrom(content.traits, id, 'trait');
    if (def.polarity !== polarity) throw new EngineError('UNKNOWN_REFERENCE', `${id} is ${def.polarity}`);
    if (level > def.maxLevel) throw new EngineError('LEVEL_MISMATCH', `${id} max level is ${def.maxLevel}`);
  }
}

export type PlaytestPatch = Omit<PlaytestPatchRequest, 'idempotencyKey' | 'expectedRevision'>;

export function applyPlaytestPatch(
  state: GameRunState,
  patch: PlaytestPatch,
  content: ContentIndex,
): GameRunState {
  assertCommand(state.phase, 'startMonth'); // = MONTH_START에서만
  const { rules } = content.pack;
  let turnIndex = state.turnIndex;
  if (patch.age !== undefined) {
    if (patch.age < rules.startAge || patch.age >= rules.retireAge) {
      throw new EngineError('INVALID_TRANSITION', `age must be ${rules.startAge}..${rules.retireAge - 1}`);
    }
    turnIndex = (patch.age - rules.startAge) * 12 + (state.turnIndex % 12);
  }
  // 월 지정 (예: 1월로 옮겨 승진 심사 확인)
  if (patch.month !== undefined) turnIndex = Math.floor(turnIndex / 12) * 12 + (patch.month - 1);
  if (patch.skills) checkTraits(patch.skills, 'POSITIVE', content);
  if (patch.negativeTraits) checkTraits(patch.negativeTraits, 'NEGATIVE', content);

  // S5 승진 조정: 직급·포인트·현 직급 근속(년)
  const job = state.employment.current;
  const current =
    job &&
    (patch.rank !== undefined || patch.promotionPoints !== undefined || patch.yearsInRank !== undefined)
      ? {
          ...job,
          rank: patch.rank ?? job.rank,
          promotionPoints: patch.promotionPoints ?? job.promotionPoints,
          rankSinceTurn:
            patch.yearsInRank !== undefined
              ? Math.max(0, turnIndex - patch.yearsInRank * 12)
              : job.rankSinceTurn,
        }
      : job;

  const changed = Object.keys(patch).join(', ');
  return markModified(
    {
      ...state,
      turnIndex,
      employment: { ...state.employment, current },
      statistics:
        patch.rank !== undefined
          ? { ...state.statistics, highestRank: higherRank(state.statistics.highestRank, patch.rank) }
          : state.statistics,
      resources: { ...state.resources, ...patch.resources },
      cash: patch.cash ?? state.cash,
      debt: patch.debt ?? state.debt,
      skills: patch.skills ? { ...patch.skills } : state.skills,
      negativeTraits: patch.negativeTraits ? { ...patch.negativeTraits } : state.negativeTraits,
    },
    `플레이테스트 조정: ${changed}`,
  );
}

/** 월 시작 처리(정산 포함)를 하되 추첨 대신 지정 사건을 연다. NPC 사건이면 조건에 맞는 첫 팀원을 참여자로. */
export function playtestStartMonthWithEvent(
  state: GameRunState,
  eventId: string,
  content: ContentIndex,
): GameRunState {
  assertCommand(state.phase, 'startMonth');
  const event = requireFrom(content.events, eventId, 'event');
  const npcCond = event.conditions?.npc;
  let participantNpcId: string | null = null;
  if (npcCond) {
    const match = currentTeamNpcs(state).find((t) => npcMatches(t.npc, npcCond));
    if (!match) {
      throw new EngineError(
        'CHOICE_NOT_AVAILABLE',
        `팀에 이 사건 조건(${npcCond.role})에 맞는 NPC가 없습니다`,
      );
    }
    participantNpcId = match.npc.npcId;
  }
  const started = startMonth(state, content, { eventId, participantNpcId });
  const participant = participantNpcId
    ? (started.npcs.find((n) => n.npcId === participantNpcId) ?? null)
    : null;
  if (!evaluateChoices(started, event, participant, content).some((c) => c.selectable)) {
    throw new EngineError('CHOICE_NOT_AVAILABLE', '현재 상태에서 고를 수 있는 선택지가 없는 사건입니다');
  }
  return markModified(started, `플레이테스트 강제 사건: ${eventId}`);
}

export function playtestDebugView(state: GameRunState, content: ContentIndex): PlaytestDebugView {
  const active = state.activeEvent;
  const event = active ? content.events.get(active.eventId) : undefined;
  const participant = active?.participantNpcId
    ? (state.npcs.find((n) => n.npcId === active.participantNpcId) ?? null)
    : null;
  const label = (source: string, id: string | null) => {
    if (source === 'BASE') return '기본';
    if ((source === 'SKILL' || source === 'NEGATIVE_TRAIT') && id) return content.traits.get(id)?.name ?? id;
    if (source === 'NPC') return '참여 NPC';
    return `${source}${id ? `:${id}` : ''}`;
  };
  const candidates =
    state.phase === 'MONTH_START' && state.employment.current ? getEligibleEvents(state, content) : [];
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  return {
    seed: state.seed,
    rngState: state.rngState,
    playtestModified: state.playtestModified,
    activeEventChoices: event
      ? evaluateChoices(state, event, participant, content).map((c) => ({
          id: c.choice.id,
          label: c.choice.label,
          visible: c.visible,
          enabled: c.enabled,
          exactChancePercent: c.chance ? Math.round(c.chance.chance * 1000) / 10 : null,
          breakdown: (c.chance?.breakdown ?? []).map(
            (b) => `${label(b.source, b.id)} ${b.bonus >= 0 ? '+' : ''}${Math.round(b.bonus * 100)}%p`,
          ),
        }))
      : [],
    eligibleEvents: candidates
      .map((c) => ({
        eventId: c.event.id,
        title: c.event.title,
        weight: c.weight,
        chancePercent: Math.round((c.weight / total) * 1000) / 10,
      }))
      .sort((a, b) => b.weight - a.weight),
    npcs: currentTeamNpcs(state).map(({ npc }) => ({
      name: npc.name,
      role: npc.role,
      personalityTags: npc.personalityTags,
      favor: npc.favor,
      trust: npc.trust,
      rivalry: npc.rivalry,
      competence: npc.competence,
    })),
    flags: state.flags.map((f) => ({ key: f.key, scope: f.scope, expiresTurn: f.expiresTurn })),
    debtLimit: debtLimit(state, content),
  };
}

export function playtestCatalog(content: ContentIndex): PlaytestCatalog {
  return {
    events: content.pack.events.map((e) => ({
      id: e.id,
      title: e.title,
      special: e.special ?? false,
      highRisk: e.highRisk ?? false,
      tags: e.tags ?? [],
    })),
    traits: content.pack.traits.map((t) => ({
      id: t.id,
      name: t.name,
      polarity: t.polarity,
      active: t.active,
    })),
  };
}
