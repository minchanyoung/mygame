import type { GameRunState, LegacyState } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { clampStat } from './numbers';

/**
 * S22 선배의 유산 (B3 대물림): 지난 판의 대표 별명이 다음 판의 작은 출발 보너스가 된다.
 * 별명 희귀도만큼. 오늘의 출근(같은 조건 경쟁)에는 붙지 않는다.
 */
const PERKS = {
  COMMON: { cash: 2_000_000, reputation: 0, mental: 0 },
  RARE: { cash: 3_000_000, reputation: 3, mental: 0 },
  LEGENDARY: { cash: 5_000_000, reputation: 5, mental: 5 },
} as const;

export interface LegacySource {
  titleId: string;
  /** 지난 판 엔딩 나이 */
  age: number;
}

/** 지난 판 기록으로 유산을 정한다. 알 수 없는 별명이면 없음 */
export function legacyFrom(
  source: LegacySource | null | undefined,
  content: ContentIndex,
): LegacyState | null {
  if (!source) return null;
  const title = content.pack.titles.find((t) => t.id === source.titleId);
  if (!title) return null;
  return { titleId: title.id, fromAge: source.age, ...PERKS[title.rarity] };
}

/** 캐릭터를 고른 직후 유산을 더한다 */
export function applyLegacy(state: GameRunState): GameRunState {
  const legacy = state.legacy;
  if (!legacy) return state;
  return {
    ...state,
    cash: state.cash + legacy.cash,
    resources: {
      ...state.resources,
      reputation: clampStat(state.resources.reputation + legacy.reputation),
      mental: clampStat(state.resources.mental + legacy.mental),
    },
  };
}

/** 화면용 한 줄: "현금 +300만 · 평판 +3" */
export function legacyPerkLabel(legacy: LegacyState): string {
  return [
    legacy.cash > 0 ? `현금 +${legacy.cash / 10_000}만` : null,
    legacy.reputation > 0 ? `평판 +${legacy.reputation}` : null,
    legacy.mental > 0 ? `정신력 +${legacy.mental}` : null,
  ]
    .filter((x) => x !== null)
    .join(' · ');
}
