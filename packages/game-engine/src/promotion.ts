import {
  PLAYER_RANKS,
  RANK_LABELS,
  turnInfo,
  type GameRunState,
  type PlayerRank,
  type PromotionResult,
} from '@company-life/shared';
import { levelBonus } from './chance';
import { hasActiveFlag } from './conditions';
import { requireFrom, type ContentIndex } from './content-index';
import { clamp, clampStat, roundKrw } from './numbers';
import { currentTeamNpcs, reassignBossIfNeeded } from './npcs';
import { SeededRng } from './rng';

/**
 * S5 승진 심사. 자동 승진 없음 (§5.4):
 * 1월, 현 직급 최소 근속 + 필요 포인트를 채우면 심사가 열리고 서버 RNG로 판정한다.
 * PIP 경고 중에는 심사가 열리지 않는다.
 */

/** 승진 직후 3개월간 세워지는 RUN 플래그 (콘텐츠 검증기도 이 키를 안다) */
export const JUST_PROMOTED_FLAG = 'just_promoted';

export interface PromotionStatus {
  from: PlayerRank;
  /** 다음 직급 (최고 직급이면 null) */
  to: PlayerRank | null;
  yearsInRank: number;
  minYears: number;
  points: number;
  requiredPoints: number;
  blocked: boolean;
  eligible: boolean;
}

export function promotionStatus(state: GameRunState, content: ContentIndex): PromotionStatus | null {
  const job = state.employment.current;
  if (!job || state.employment.status !== 'EMPLOYED') return null;
  const { promotion } = content.pack.rules;
  const step = promotion.ladder.find((s) => s.from === job.rank);
  const yearsInRank = Math.floor((state.turnIndex - job.rankSinceTurn) / 12);
  const blocked = hasActiveFlag(
    state,
    { key: promotion.blockedByFlag, scope: 'COMPANY' },
    { participant: null },
  );
  if (!step) {
    return {
      from: job.rank,
      to: null,
      yearsInRank,
      minYears: 0,
      points: job.promotionPoints,
      requiredPoints: 0,
      blocked,
      eligible: false,
    };
  }
  return {
    from: job.rank,
    to: step.to,
    yearsInRank,
    minYears: step.minYears,
    points: job.promotionPoints,
    requiredPoints: step.points,
    blocked,
    eligible: !blocked && yearsInRank >= step.minYears && job.promotionPoints >= step.points,
  };
}

/** 심사 성공 확률 (서버 전용 — 공개 뷰에 내보내지 않는다) */
export function promotionChance(state: GameRunState, content: ContentIndex): number | null {
  const status = promotionStatus(state, content);
  const job = state.employment.current;
  if (!status || !status.eligible || !job) return null;
  const { rules } = content.pack;
  const p = rules.promotion;
  const company = requireFrom(content.companies, job.companyId, 'company');
  const boss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')?.npc;

  const step = p.ladder.find((s) => s.from === job.rank);
  let chance = p.baseChance + (step?.chanceAdjust ?? 0);
  chance += Math.min(p.maxExtraBonus, (status.points - status.requiredPoints) * p.perExtraPoint);
  switch (company.promotionPolicy) {
    case 'SENIORITY':
      chance += (status.yearsInRank - status.minYears) * p.policy.seniorityPerYear;
      break;
    case 'PERFORMANCE': {
      const last = [...state.annualReviews].reverse().find((r) => r.companyId === job.companyId);
      if (last) chance += p.policy.performanceByGrade[last.grade] ?? 0;
      break;
    }
    case 'POLITICS':
      if (boss && boss.favor >= p.policy.politicsFavorHigh) chance += p.policy.politicsBonus;
      else if (boss && boss.favor <= p.policy.politicsFavorLow) chance -= p.policy.politicsBonus;
      break;
  }
  if (boss && boss.trust >= p.bossTrustMin) chance += p.bossTrustBonus;
  for (const [traitId, levels] of Object.entries(p.traitAdjustments)) {
    const level = state.negativeTraits[traitId] ?? state.skills[traitId] ?? 0;
    chance += levelBonus(levels, level);
  }
  chance += job.promotionMisses * p.missBonus;
  return Math.round(clamp(chance, rules.chanceMin, rules.chanceMax) * 100) / 100;
}

/**
 * 1월 월 시작, 연봉 조정 다음·급여 정산 전에 실행.
 * 성공: 직급·근속 기준 갱신, 포인트·누락 초기화, 승진 인상, 상사 재배치(§21.2).
 * 누락: 정신력·평판·상사 호감 하락, 포인트 유지, 연속 누락이 기준에 닿으면 후속 사건 예약.
 */
export function processPromotion(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; result: PromotionResult | null } {
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const job = state.employment.current;
  if (info.monthOfYear !== 1 || info.yearIndex === 0 || !job) return { state, result: null };
  const chance = promotionChance(state, content);
  const status = promotionStatus(state, content);
  if (chance === null || !status?.to) return { state, result: null };

  const p = content.pack.rules.promotion;
  const rng = new SeededRng(state.rngState);
  const success = rng.nextFloat() < chance;
  const afterRoll = { ...state, rngState: rng.state };

  if (success) {
    const step = p.ladder.find((s) => s.from === job.rank)!;
    const salaryTo = roundKrw(
      Math.floor((job.annualSalary * (1000 + step.raisePermille)) / 1000),
      content.pack.rules.salary.roundingUnit,
    );
    const promoted: GameRunState = {
      ...afterRoll,
      employment: {
        ...afterRoll.employment,
        current: {
          ...job,
          rank: step.to,
          rankSinceTurn: state.turnIndex,
          promotionPoints: 0,
          promotionMisses: 0,
          annualSalary: salaryTo,
        },
      },
      statistics: {
        ...afterRoll.statistics,
        highestRank: higherRank(afterRoll.statistics.highestRank, step.to),
      },
      // 승진 직후 몇 달간 '승진 턱' 같은 후속 일상 사건의 조건이 된다
      flags: [
        ...afterRoll.flags.filter((f) => !(f.key === JUST_PROMOTED_FLAG && f.scope === 'RUN')),
        {
          key: JUST_PROMOTED_FLAG,
          scope: 'RUN' as const,
          ownerId: null,
          value: step.to,
          createdTurn: state.turnIndex,
          expiresTurn: state.turnIndex + 3,
          sourceEventId: null,
        },
      ],
      eventHistory: [
        ...afterRoll.eventHistory,
        {
          turnIndex: state.turnIndex,
          kind: 'PROMOTION',
          summary: `${RANK_LABELS[job.rank]} → ${RANK_LABELS[step.to]} 승진`,
          data: { from: job.rank, to: step.to },
        },
      ],
    };
    const reassigned = reassignBossIfNeeded(promoted, content);
    const newBoss = reassigned.replaced
      ? (currentTeamNpcs(reassigned.state).find((t) => t.role === 'BOSS')?.npc ?? null)
      : null;
    return {
      state: reassigned.state,
      result: {
        from: job.rank,
        to: step.to,
        success: true,
        salaryFrom: job.annualSalary,
        salaryTo,
        newBossName: newBoss ? `${newBoss.name} ${RANK_LABELS[newBoss.rank]}` : null,
        misses: 0,
      },
    };
  }

  const misses = job.promotionMisses + 1;
  const boss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')?.npc;
  const followUp = p.consecutiveMissEvent;
  const missed: GameRunState = {
    ...afterRoll,
    resources: {
      ...afterRoll.resources,
      mental: clampStat(afterRoll.resources.mental - p.missPenalty.mental),
      reputation: clampStat(afterRoll.resources.reputation - p.missPenalty.reputation),
    },
    npcs: boss
      ? afterRoll.npcs.map((n) =>
          n.npcId === boss.npcId ? { ...n, favor: clampStat(n.favor - p.missPenalty.bossFavor) } : n,
        )
      : afterRoll.npcs,
    employment: { ...afterRoll.employment, current: { ...job, promotionMisses: misses } },
    // 이번 달 업무 칸으로 바로 열리도록 이번 턴에 예약한다 (사건 선정은 이 처리 다음)
    scheduledEvents:
      misses === followUp.misses
        ? [
            ...afterRoll.scheduledEvents,
            {
              scheduleId: `promotion_miss_t${state.turnIndex}`,
              eventId: followUp.eventId,
              dueTurn: state.turnIndex,
              priority: 10,
              sourceOccurrenceId: null,
              participantNpcId: null,
              status: 'PENDING' as const,
            },
          ]
        : afterRoll.scheduledEvents,
  };
  return {
    state: missed,
    result: {
      from: job.rank,
      to: status.to,
      success: false,
      salaryFrom: null,
      salaryTo: null,
      newBossName: null,
      misses,
    },
  };
}

export function rankIndex(rank: PlayerRank): number {
  return PLAYER_RANKS.indexOf(rank);
}

export function higherRank(a: PlayerRank | null, b: PlayerRank): PlayerRank {
  return a !== null && rankIndex(a) >= rankIndex(b) ? a : b;
}
