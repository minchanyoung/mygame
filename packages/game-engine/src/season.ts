import {
  turnInfo,
  type GameRunState,
  type SeasonKind,
  type SeasonRecord,
  type SeasonState,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { clampStat } from './numbers';
import { rankIndex } from './promotion';

/**
 * S19 3~5년 시즌 목표. 1월 일상 칸에 '새해 계획' 사건이 열리고, 고른 목표를 기한 안에 이루면 보상.
 * 판정은 매달 시작(연봉 조정·승진·인사평가 뒤)에 한다. 인생 목표(엔딩 판정)와 달리 중간 목표다.
 */
export const SEASON_INFO: Record<SeasonKind, { title: string; emoji: string }> = {
  PROMOTION: { title: '다음 직급 달기', emoji: '🪜' },
  SAVINGS: { title: '연봉 1년 치 모으기', emoji: '💰' },
  REVIEW: { title: '3년 연속 B 이상', emoji: '📋' },
  WELLBEING: { title: '좋은 컨디션으로 3년', emoji: '🌿' },
};

const netWorth = (s: GameRunState) => s.cash - s.debt;

/** 이번 달 일상 칸을 '새해 계획'으로 열어야 하는지 */
export function seasonOfferDue(state: GameRunState, content: ContentIndex): boolean {
  const rules = content.pack.rules.season;
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const job = state.employment.current;
  if (info.monthOfYear !== 1 || !job || state.employment.status !== 'EMPLOYED') return false;
  if (state.season) return false;
  if (info.age < rules.ageMin || info.age > rules.ageMax) return false;
  if (state.turnIndex - job.startedTurn < rules.tenureMonths) return false;
  const last = state.seasonHistory?.at(-1);
  return !last || state.turnIndex - last.endTurn >= rules.gapMonths;
}

/** 고를 수 없는 목표 (부장은 다음 직급이 없다) */
export function seasonAvailable(state: GameRunState, kind: SeasonKind): boolean {
  if (kind !== 'PROMOTION') return true;
  const rank = state.employment.current?.rank;
  return rank !== undefined && rank !== 'DEPARTMENT_HEAD';
}

export function newSeason(state: GameRunState, kind: SeasonKind, content: ContentIndex): SeasonState {
  const months = content.pack.rules.season.months[kind] ?? 36;
  const job = state.employment.current;
  const [baseline, target] =
    kind === 'PROMOTION'
      ? [rankIndex(job?.rank ?? 'STAFF'), rankIndex(job?.rank ?? 'STAFF') + 1]
      : kind === 'SAVINGS'
        ? [netWorth(state), netWorth(state) + (job?.annualSalary ?? 0)]
        : kind === 'REVIEW'
          ? [0, 3]
          : [0, months];
  return { kind, startTurn: state.turnIndex, deadlineTurn: state.turnIndex + months, baseline, target };
}

/** 진행도 (화면 표시). REVIEW는 기한 안에 받은 평가 수, WELLBEING은 버틴 개월 수 */
export function seasonProgress(
  state: GameRunState,
  season: SeasonState,
): { current: number; percent: number } {
  const pct = (cur: number, base: number, target: number) =>
    Math.max(0, Math.min(100, Math.floor(((cur - base) / Math.max(1, target - base)) * 100)));
  switch (season.kind) {
    case 'PROMOTION': {
      const cur = rankIndex(state.employment.current?.rank ?? 'STAFF');
      return { current: cur, percent: cur >= season.target ? 100 : 0 };
    }
    case 'SAVINGS': {
      const cur = netWorth(state);
      return { current: cur, percent: pct(cur, season.baseline, season.target) };
    }
    case 'REVIEW': {
      const n = state.annualReviews.filter((r) => r.turnIndex >= season.startTurn).length;
      return { current: n, percent: pct(n, 0, season.target) };
    }
    case 'WELLBEING': {
      const n = state.turnIndex - season.startTurn;
      return { current: n, percent: pct(n, 0, season.target) };
    }
  }
}

function verdict(state: GameRunState, season: SeasonState, content: ContentIndex): boolean | null {
  const due = state.turnIndex >= season.deadlineTurn;
  switch (season.kind) {
    case 'PROMOTION':
      if (rankIndex(state.employment.current?.rank ?? 'STAFF') >= season.target) return true;
      return due ? false : null;
    case 'SAVINGS':
      if (netWorth(state) >= season.target) return true;
      return due ? false : null;
    case 'REVIEW': {
      const reviews = state.annualReviews.filter((r) => r.turnIndex >= season.startTurn);
      if (reviews.some((r) => r.grade === 'C' || r.grade === 'D')) return false;
      if (reviews.length >= season.target) return true;
      return due ? false : null;
    }
    case 'WELLBEING': {
      const floor = content.pack.rules.season.wellbeingFloor;
      if (season.broken || Math.min(state.resources.health, state.resources.mental) < floor) return false;
      return due ? true : null;
    }
  }
}

/** 사건 직후: 버티기 목표는 그달 안에서 무너진 순간도 센다 (월초에는 자연 회복 뒤라 높게 보인다) */
export function markSeasonAfterEvent(state: GameRunState, content: ContentIndex): GameRunState {
  const season = state.season;
  if (!season || season.kind !== 'WELLBEING' || season.broken) return state;
  const floor = content.pack.rules.season.wellbeingFloor;
  if (Math.min(state.resources.health, state.resources.mental) >= floor) return state;
  return { ...state, season: { ...season, broken: true } };
}

/** 월 시작 판정. 끝났으면 보상(또는 작은 실망)을 적용하고 기록을 남긴다. 실직하면 조용히 끝낸다 */
export function processSeason(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; result: SeasonRecord | null } {
  const season = state.season;
  if (!season) return { state, result: null };
  const employed = state.employment.status === 'EMPLOYED';
  const achieved = employed ? verdict(state, season, content) : false;
  if (achieved === null) return { state, result: null };
  const record: SeasonRecord = {
    kind: season.kind,
    startTurn: season.startTurn,
    endTurn: state.turnIndex,
    achieved,
  };
  const { reward, failMental } = content.pack.rules.season;
  const resources = { ...state.resources };
  let employment = state.employment;
  if (achieved) {
    resources.mental = clampStat(resources.mental + reward.mental);
    resources.reputation = clampStat(resources.reputation + reward.reputation);
    const job = employment.current;
    // 승진 목표는 이미 승진으로 보상받았으니 포인트는 다른 목표에만
    if (job && season.kind !== 'PROMOTION' && reward.promotionPoints > 0) {
      employment = {
        ...employment,
        current: { ...job, promotionPoints: job.promotionPoints + reward.promotionPoints },
      };
    }
  } else if (employed) {
    resources.mental = clampStat(resources.mental + failMental);
  }
  return {
    state: {
      ...state,
      resources,
      employment,
      season: null,
      seasonHistory: [...(state.seasonHistory ?? []), record],
    },
    result: employed ? record : null,
  };
}
