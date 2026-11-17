import {
  RESOURCE_ENDING_CAUSE,
  RESOURCE_KEYS,
  turnInfo,
  type Ending,
  type EndingCause,
  type EndingText,
  type GameRunState,
} from '@company-life/shared';
import { matchesConditions } from './conditions';
import type { ContentIndex } from './content-index';
import { currentTeamNpcs } from './npcs';

/** 부채 한계선 = 연봉 × 배수 (§26.1). 재직 정보가 없으면 null. */
export function debtLimit(state: GameRunState, content: ContentIndex): number | null {
  const job = state.employment.current;
  return job ? job.annualSalary * content.pack.rules.gameOver.debtLimitSalaryMultiple : null;
}

/**
 * §26.2 이번 달 실직 원인 판정. 우선순위대로 **한 가지만** 반환한다:
 * 체력 0 → 정신력 0 → 집중력 0 → 평판 0 → 부채 한계 → 이벤트 실직. 입사 전에는 판정하지 않는다.
 */
export function detectJobLossCause(
  state: GameRunState,
  content: ContentIndex,
): { cause: EndingCause; sourceEventId: string | null } | null {
  if (!state.employment.current) return null;
  for (const key of RESOURCE_KEYS) {
    if (state.resources[key] <= 0) return { cause: RESOURCE_ENDING_CAUSE[key], sourceEventId: null };
  }
  const limit = debtLimit(state, content);
  if (limit !== null && state.debt >= limit) return { cause: 'DEBT_SPIRAL', sourceEventId: null };
  const loss = state.employment.jobLoss;
  if (state.employment.status === 'UNEMPLOYED' && loss)
    return { cause: loss.reason, sourceEventId: loss.eventId };
  return null;
}

function pickText(def: EndingText, state: GameRunState, content: ContentIndex): string {
  // 엔딩 변형의 NPC 조건은 현재 직속 상사를 기준으로 평가한다
  const boss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')?.npc ?? null;
  return (
    def.variants?.find((v) => matchesConditions(state, v.when, { participant: boss }, content))?.text ??
    def.text
  );
}

/**
 * 원인 → 엔딩. 50세 미만이면 실패 엔딩, 이상이면 조기 은퇴(정상)이고 원인은 보존한다 (§26.1).
 * 정년(RETIREMENT)은 항상 정상 엔딩.
 */
export function buildEnding(
  state: GameRunState,
  cause: EndingCause,
  sourceEventId: string | null,
  content: ContentIndex,
): Ending {
  const { rules, endings } = content.pack;
  const age = turnInfo(state.turnIndex, rules.startAge).age;
  const causeDef = endings.causes[cause];
  const causeText = pickText(causeDef, state, content);
  const base = { cause, age, turnIndex: state.turnIndex, sourceEventId };

  if (cause === 'RETIREMENT') {
    return { ...base, type: 'RETIREMENT', category: 'NORMAL', title: causeDef.title, text: causeText };
  }
  if (age < rules.gameOver.failureBeforeAge) {
    return { ...base, type: cause, category: 'FAILURE', title: causeDef.title, text: causeText };
  }
  const early = endings.earlyRetirement;
  return {
    ...base,
    type: 'EARLY_RETIREMENT',
    category: 'NORMAL',
    title: `${early.title} — ${causeDef.title}`,
    text: `${causeText} ${pickText(early, state, content)}`,
  };
}

/** MONTH_SUMMARY 진입 시 호출: 원인이 있으면 pendingEnding을 기록한다. */
export function withPendingEnding(state: GameRunState, content: ContentIndex): GameRunState {
  const found = detectJobLossCause(state, content);
  return {
    ...state,
    pendingEnding: found ? buildEnding(state, found.cause, found.sourceEventId, content) : null,
  };
}

/** GAME_OVER 확정: 고용·팀 배정을 종료하고 엔딩을 기록한다. NPC와 관계 이력은 보존한다. */
export function finalizeEnding(state: GameRunState, ending: Ending, now: string): GameRunState {
  const job = state.employment.current;
  return {
    ...state,
    phase: 'GAME_OVER',
    pendingEnding: null,
    ending,
    finishedAt: now,
    employment: {
      ...state.employment,
      status: ending.category === 'NORMAL' ? 'RETIRED' : 'ENDED',
      current: null,
    },
    npcAssignments: state.npcAssignments.map((a) =>
      job && a.companyId === job.companyId && a.teamId === job.teamId && a.toTurn === null
        ? { ...a, toTurn: state.turnIndex }
        : a,
    ),
    eventHistory: [
      ...state.eventHistory,
      {
        turnIndex: state.turnIndex,
        kind: 'ENDING',
        summary: `${ending.title} (${ending.age}세)`,
        data: { type: ending.type, cause: ending.cause, category: ending.category },
      },
    ],
  };
}
