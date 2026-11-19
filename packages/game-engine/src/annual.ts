import {
  eventSlot,
  turnInfo,
  type GameRunState,
  type ReviewDetail,
  type ReviewGrade,
} from '@company-life/shared';
import { levelBonus } from './chance';
import type { ContentIndex } from './content-index';
import { clamp, clampStat, roundKrw } from './numbers';
import { reputationSources } from './ledger';
import { currentTeamNpcs } from './npcs';

export type ReviewResult = ReviewDetail;

function gradeOf(score: number, content: ContentIndex): ReviewGrade {
  const t = content.pack.rules.annualReview.gradeThresholds;
  return score >= t.S ? 'S' : score >= t.A ? 'A' : score >= t.B ? 'B' : score >= t.C ? 'C' : 'D';
}

/**
 * §20.1 연말 인사평가표.
 * 항목: 업무 성과(올해 업무 사건 성공률) · 상사 평가(신뢰·호감) · 동료 협업(동료 신뢰 평균) · 평판 · 근태·컨디션(체력·집중력).
 * 가중 평균 + 특성 보정(레벨 치환형) → 0~100 → 등급. 성과급·상사 코멘트·경고(낮은 등급)를 함께 정한다.
 */
export function computeAnnualReview(state: GameRunState, content: ContentIndex): ReviewResult {
  const { annualReview } = content.pack.rules;
  const w = annualReview.weights;
  const year = Math.floor(state.turnIndex / 12);
  const team = currentTeamNpcs(state);
  const boss = team.find((t) => t.role === 'BOSS')?.npc;
  const peers = team.filter((t) => t.role === 'PEER').map((t) => t.npc);

  const workJudged = state.eventOccurrences.filter((o) => {
    const ev = content.events.get(o.eventId);
    return (
      Math.floor(o.turnIndex / 12) === year &&
      o.success !== null &&
      ev !== undefined &&
      eventSlot(ev) === 'work'
    );
  });
  const workWins = workJudged.filter((o) => o.success).length;
  const performance = workJudged.length > 0 ? Math.round((workWins / workJudged.length) * 100) : 50;
  const bossScore = boss ? Math.round(boss.trust * 0.7 + boss.favor * 0.3) : 50;
  const peerScore = peers.length > 0 ? Math.round(peers.reduce((s, p) => s + p.trust, 0) / peers.length) : 50;
  const condition = Math.round((state.resources.health + state.resources.focus) / 2);

  const raw = [
    {
      key: 'performance' as const,
      score: performance,
      weight: w.performance,
      note:
        workJudged.length > 0
          ? `올해 업무 ${workJudged.length}건 중 ${workWins}건 성공`
          : '결과가 갈리는 업무에 도전하지 않아 기본 50점 (확정 선택만 함)',
    },
    {
      key: 'boss' as const,
      score: bossScore,
      weight: w.boss,
      note: boss ? `${boss.name}의 신뢰·호감` : '직속 상사 없음',
    },
    { key: 'peers' as const, score: peerScore, weight: w.peers, note: `동료 ${peers.length}명의 신뢰 평균` },
    {
      key: 'reputation' as const,
      score: state.resources.reputation,
      weight: w.reputation,
      note: '사내 평판',
    },
    {
      key: 'condition' as const,
      score: condition,
      // S7: 나이가 들면 '근태·컨디션' 비중이 커진다
      weight:
        w.condition +
        (turnInfo(state.turnIndex, content.pack.rules.startAge).age >=
        annualReview.seniorConditionWeight.fromAge
          ? annualReview.seniorConditionWeight.bonus
          : 0),
      note: '체력·집중력 상태',
    },
  ];
  const totalWeight = raw.reduce((s, r) => s + r.weight, 0) || 1;
  const weighted = raw.reduce((s, r) => s + r.score * r.weight, 0) / totalWeight;

  let traitAdjustment = 0;
  for (const [traitId, levels] of Object.entries(annualReview.traitAdjustments)) {
    const level = state.negativeTraits[traitId] ?? state.skills[traitId] ?? 0;
    traitAdjustment += levelBonus(levels, level);
  }
  const score = Math.round(clamp(weighted + traitAdjustment, 0, 100));
  const grade = gradeOf(score, content);

  const monthly = Math.floor((state.employment.current?.annualSalary ?? 0) / 12);
  const bonus = roundKrw(Math.floor((monthly * annualReview.bonusPermilleByGrade[grade]) / 1000), 10_000);
  const pool = annualReview.comments[grade];
  const comment = (pool[year % pool.length] ?? '')
    .replaceAll('{boss}', boss?.name ?? '팀장')
    .replaceAll('{me}', state.profile.displayName);

  return {
    grade,
    score,
    reputationDelta: annualReview.reputationDeltaByGrade[grade],
    items: raw.map((r) => ({
      key: r.key,
      score: clamp(r.score, 0, 100),
      grade: gradeOf(r.score, content),
      note: r.note,
    })),
    traitAdjustment: Math.round(traitAdjustment),
    reputationSources: reputationSources(state),
    bonus,
    bossName: boss?.name ?? null,
    comment,
    warning: annualReview.warningFlag.grades.includes(grade),
  };
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
  const wf = content.pack.rules.annualReview.warningFlag;
  // 낮은 등급이면 회사 범위 경고 플래그 → 성과 개선 프로그램(PIP) 사건의 사전 징후 (§26.5)
  const flags = review.warning
    ? [
        ...state.flags.filter(
          (f) => !(f.key === wf.key && f.scope === 'COMPANY' && f.ownerId === job.companyId),
        ),
        {
          key: wf.key,
          scope: 'COMPANY' as const,
          ownerId: job.companyId,
          value: true,
          createdTurn: state.turnIndex,
          expiresTurn: state.turnIndex + wf.expiresInMonths,
          sourceEventId: null,
        },
      ]
    : state.flags;
  // 평가 등급만큼 승진 포인트 적립 (S5)
  const points = content.pack.rules.promotion.pointsByGrade[review.grade] ?? 0;
  return {
    review,
    state: {
      ...state,
      flags,
      employment: {
        ...state.employment,
        current: { ...job, promotionPoints: job.promotionPoints + points },
      },
      cash: state.cash + review.bonus,
      annualReviewProcessedYear: info.yearIndex,
      annualReviews: [
        ...state.annualReviews,
        {
          yearIndex: info.yearIndex,
          turnIndex: state.turnIndex,
          companyId: job.companyId,
          grade: review.grade,
          score: review.score,
          bonus: review.bonus,
        },
      ],
      resources: {
        ...state.resources,
        reputation: clampStat(state.resources.reputation + review.reputationDelta),
      },
      statistics: { ...state.statistics, totalEarned: state.statistics.totalEarned + review.bonus },
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
