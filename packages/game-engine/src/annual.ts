import { turnInfo, type GameRunState, type ReviewGrade } from '@company-life/shared';
import { levelBonus } from './chance';
import type { ContentIndex } from './content-index';
import { clamp, clampStat, roundKrw } from './numbers';
import { currentTeamNpcs } from './npcs';

export interface ReviewResult {
  grade: ReviewGrade;
  score: number;
  reputationDelta: number;
}

/**
 * §20.1 연말 인사평가 점수 (0~100).
 * 가중 평균(평판, 직속 상사 신뢰·호감, 올해 판정 사건 성공률%) + 특성 보정(레벨 치환형).
 * 올해 판정 사건이 없으면 성공률은 50%로 본다.
 */
export function computeAnnualReview(state: GameRunState, content: ContentIndex): ReviewResult {
  const { annualReview } = content.pack.rules;
  const w = annualReview.weights;
  const year = Math.floor(state.turnIndex / 12);
  const boss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')?.npc;
  const judged = state.eventOccurrences.filter(
    (o) => Math.floor(o.turnIndex / 12) === year && o.success !== null,
  );
  const successPct = judged.length > 0 ? (judged.filter((o) => o.success).length / judged.length) * 100 : 50;
  const totalWeight = w.reputation + w.bossTrust + w.bossFavor + w.successRate || 1;
  const weighted =
    (state.resources.reputation * w.reputation +
      (boss?.trust ?? 50) * w.bossTrust +
      (boss?.favor ?? 50) * w.bossFavor +
      successPct * w.successRate) /
    totalWeight;

  let adjustment = 0;
  for (const [traitId, levels] of Object.entries(annualReview.traitAdjustments)) {
    const level = state.negativeTraits[traitId] ?? state.skills[traitId] ?? 0;
    adjustment += levelBonus(levels, level);
  }
  const score = Math.round(clamp(weighted + adjustment, 0, 100));
  const t = annualReview.gradeThresholds;
  const grade: ReviewGrade =
    score >= t.S ? 'S' : score >= t.A ? 'A' : score >= t.B ? 'B' : score >= t.C ? 'C' : 'D';
  return { grade, score, reputationDelta: annualReview.reputationDeltaByGrade[grade] };
}

/**
 * 12월 월 시작에 정확히 1번 실행 (annualReviewProcessedYear 체크포인트).
 * 그 달의 랜덤 사건과 별개인 정기 처리라 예약·강제 사건이 있어도 누락되지 않는다.
 */
export function processAnnualReview(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; review: ReviewResult | null } {
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const job = state.employment.current;
  if (info.monthOfYear !== 12 || !job || state.employment.status !== 'EMPLOYED')
    return { state, review: null };
  if (state.annualReviewProcessedYear === info.yearIndex) return { state, review: null };

  const review = computeAnnualReview(state, content);
  return {
    review,
    state: {
      ...state,
      annualReviewProcessedYear: info.yearIndex,
      annualReviews: [
        ...state.annualReviews,
        {
          yearIndex: info.yearIndex,
          turnIndex: state.turnIndex,
          companyId: job.companyId,
          grade: review.grade,
          score: review.score,
        },
      ],
      resources: {
        ...state.resources,
        reputation: clampStat(state.resources.reputation + review.reputationDelta),
      },
    },
  };
}

/**
 * 1월 월 시작에 정확히 1번, 급여 정산 **전에** 실행 (salaryAdjustedYear 체크포인트).
 * 첫 해 1월은 직전 평가가 없으므로 조정하지 않는다. 직전 평가가 현재 회사 것이 아니면 조정하지 않는다.
 */
export function processSalaryAdjustment(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; adjustment: { grade: ReviewGrade | null; from: number; to: number } | null } {
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const job = state.employment.current;
  if (info.monthOfYear !== 1 || info.yearIndex === 0 || !job) return { state, adjustment: null };
  if (state.salaryAdjustedYear === info.yearIndex) return { state, adjustment: null };

  const last = state.annualReviews.find(
    (r) => r.yearIndex === info.yearIndex - 1 && r.companyId === job.companyId,
  );
  const checkpointed = { ...state, salaryAdjustedYear: info.yearIndex };
  if (!last) return { state: checkpointed, adjustment: null };

  const permille = content.pack.rules.annualReview.raisePermilleByGrade[last.grade];
  const to = Math.max(
    content.pack.rules.salary.roundingUnit,
    roundKrw(
      Math.floor((job.annualSalary * (1000 + permille)) / 1000),
      content.pack.rules.salary.roundingUnit,
    ),
  );
  return {
    state: { ...checkpointed, employment: { ...state.employment, current: { ...job, annualSalary: to } } },
    adjustment: { grade: last.grade, from: job.annualSalary, to },
  };
}
