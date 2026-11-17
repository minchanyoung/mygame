import type { GameRunState } from '@company-life/shared';

/** GameRunState는 계약상 JSON 직렬화 가능하므로 JSON 왕복으로 깊은 복제한다 (런타임 API 비의존). */
export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * applyEffects가 변경하는 부분만 복제한 작업용 사본. 이력 배열의 기존 항목은 변경하지 않고 push만 하므로
 * 배열만 새로 만들면 원본이 보존된다. (전체 JSON 복제 대비 긴 플레이에서 수십 배 빠름)
 */
export function cloneForEffects(state: GameRunState): GameRunState {
  return {
    ...state,
    resources: { ...state.resources },
    skills: { ...state.skills },
    negativeTraits: { ...state.negativeTraits },
    skillHistory: [...state.skillHistory],
    traitHistory: [...state.traitHistory],
    flags: state.flags.map((f) => ({ ...f })),
    scheduledEvents: state.scheduledEvents.map((s) => ({ ...s })),
    npcs: state.npcs.map((n) => ({
      ...n,
      personalityTags: [...n.personalityTags],
      memoryFlags: [...n.memoryFlags],
      relationshipHistory: [...n.relationshipHistory],
    })),
    npcAssignments: state.npcAssignments.map((a) => ({ ...a })),
    employment: {
      ...state.employment,
      current: state.employment.current && { ...state.employment.current },
      jobLoss: state.employment.jobLoss && { ...state.employment.jobLoss },
    },
    statistics: { ...state.statistics },
    eventOccurrences: [...state.eventOccurrences],
    eventHistory: [...state.eventHistory],
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0~100 단기 자원 정수 clamp (§4.4) */
export function clampStat(value: number): number {
  return clamp(Math.round(value), 0, 100);
}

/** 부동소수점 오차 제거용: 확률을 0.0001 단위로 반올림 */
export function roundChance(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** 원화 정수를 단위로 반올림 */
export function roundKrw(value: number, unit: number): number {
  return Math.round(value / unit) * unit;
}
