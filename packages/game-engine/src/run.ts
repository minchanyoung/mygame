import { ENGINE_VERSION, type GameRunState, type PlayerProfile } from '@company-life/shared';
import { generateCharacterCards } from './characters';
import type { ContentIndex } from './content-index';
import { EngineError } from './errors';
import { goalDef, offerLifeGoals } from './goals';
import { generateJobOffers } from './jobs';
import { deriveSeed } from './rng';
import { assertCommand, assertTransition } from './state-machine';

export interface CreateRunInput {
  runId: string;
  guestOwnerId: string;
  seed: string;
  profile: PlayerProfile;
  /** ISO 시각. 엔진은 시계를 직접 읽지 않는다. */
  now: string;
}

/**
 * 새 게임 생성. PROFILE_INPUT --createCards--> CHARACTER_SELECTION 을 한 번에 수행한다 (§23.3).
 * 프로필은 호출 전에 validateProfileInput으로 검증되어 있어야 한다.
 * 카드 3장과 시드는 상태에 고정 저장되며, 재조회해도 다시 굴리지 않는다.
 */
export function createRun(input: CreateRunInput, content: ContentIndex): GameRunState {
  assertTransition('PROFILE_INPUT', 'createCards', 'CHARACTER_SELECTION');
  const { rules } = content.pack;
  const cards = generateCharacterCards(input.profile, input.seed, content);
  return {
    schemaVersion: 1,
    runId: input.runId,
    guestOwnerId: input.guestOwnerId,
    seed: input.seed,
    rngState: deriveSeed(input.seed, 'main'),
    engineVersion: ENGINE_VERSION,
    contentVersion: content.pack.contentVersion,
    stateRevision: 0,
    turnIndex: 0,
    phase: 'CHARACTER_SELECTION',
    profile: { ...input.profile },
    characterCards: cards,
    selectedCharacter: null,
    lifeGoalOffers: [],
    lifeGoal: null,
    jobOffers: [],
    transferOffer: null,
    jobSearch: { round: 0, consecutiveRejections: 0, lastResult: null },
    employment: { status: 'UNEMPLOYED', current: null, jobLoss: null, promotedToExecutive: false },
    resources: { ...rules.character.baseResources },
    cash: 0,
    debt: 0,
    skills: {},
    negativeTraits: {},
    skillHistory: [],
    traitHistory: [],
    backgroundTraits: [],
    flags: [],
    scheduledEvents: [],
    eventOccurrences: [],
    activeEvent: null,
    pendingEvents: [],
    npcs: [],
    npcAssignments: [],
    eventHistory: [{ turnIndex: 0, kind: 'RUN_CREATED', summary: '새 인생 시작' }],
    annualReviews: [],
    yearlyRecords: [],
    annualReviewProcessedYear: null,
    salaryAdjustedYear: null,
    statistics: {
      totalEarned: 0,
      totalSpent: 0,
      jobChanges: 0,
      highestRank: null,
      consecutiveHighRiskMonths: 0,
      lowestWellbeing: 100,
      transfers: 0,
      nearCollapseMonths: 0,
      maxHighRiskStreak: 0,
      peakDebtPermille: 0,
    },
    currentMonth: null,
    pendingEnding: null,
    ending: null,
    playtestModified: false,
    createdAt: input.now,
    finishedAt: null,
  };
}

/**
 * CHARACTER_SELECTION --chooseCharacter(cardId)--> GOAL_SELECTION.
 * 서버가 발급해 상태에 고정한 cardId만 허용한다 (클라이언트가 보낸 인물 데이터는 받지 않는다).
 * 인생 목표 후보 3장과 첫 구직 카드도 이때 고정한다.
 */
export function chooseCharacter(state: GameRunState, cardId: string, content: ContentIndex): GameRunState {
  assertCommand(state.phase, 'chooseCharacter');
  const card = state.characterCards.find((c) => c.cardId === cardId);
  if (!card) throw new EngineError('CARD_NOT_FOUND', `unknown cardId: ${cardId}`, { cardId });
  assertTransition(state.phase, 'chooseCharacter', 'GOAL_SELECTION');

  const selected: GameRunState = {
    ...state,
    phase: 'GOAL_SELECTION',
    selectedCharacter: card,
    resources: { ...card.resources },
    cash: card.cash,
    debt: card.debt,
    // 영구 특성은 카드와 무관하게 항상 빈 상태로 시작한다 (§4.2, §4.2.2).
    skills: {},
    negativeTraits: {},
    backgroundTraits: [...card.backgroundTraits],
    eventHistory: [
      ...state.eventHistory,
      { turnIndex: state.turnIndex, kind: 'CHARACTER_SELECTED', summary: '캐릭터 확정', data: { cardId } },
    ],
  };
  return {
    ...selected,
    lifeGoalOffers: offerLifeGoals(selected, content),
    jobOffers: generateJobOffers(selected, content),
  };
}

/** GOAL_SELECTION --chooseGoal(goalId)--> JOB_OFFERS. 제시된 3장 중에서만 고를 수 있다. */
export function chooseGoal(state: GameRunState, goalId: string, content: ContentIndex): GameRunState {
  assertCommand(state.phase, 'chooseGoal');
  if (!state.lifeGoalOffers.includes(goalId)) {
    throw new EngineError('GOAL_NOT_OFFERED', `goal not offered: ${goalId}`, { goalId });
  }
  assertTransition(state.phase, 'chooseGoal', 'JOB_OFFERS');
  const def = goalDef(content, goalId);
  return {
    ...state,
    phase: 'JOB_OFFERS',
    lifeGoal: { goalId, milestones: [] },
    eventHistory: [
      ...state.eventHistory,
      {
        turnIndex: state.turnIndex,
        kind: 'GOAL_SELECTED',
        summary: `인생 목표: ${def.title}`,
        data: { goalId },
      },
    ],
  };
}
