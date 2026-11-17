import {
  JOB_IDS,
  JOB_LABELS,
  type CharacterCard,
  type CompanyDefinition,
  type CompanyGrade,
  type GameRunState,
  type JobId,
  type JobOffer,
  type Resources,
} from '@company-life/shared';
import { requireFrom, type ContentIndex } from './content-index';
import { EngineError } from './errors';
import { clamp, clampStat, roundKrw } from './numbers';
import { ensureCompanyTeam } from './npcs';
import { SeededRng } from './rng';
import { assertCommand, assertTransition } from './state-machine';

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%p`;

export interface HireChanceInput {
  character: CharacterCard;
  resources: Resources;
  grade: CompanyGrade;
  jobId: JobId;
}

/**
 * §3.2 합격확률 = clamp(등급 기본 + 전공 적합 + 대학군/강점/약점 보정 + 평판 보정, min, max).
 * 이름·성별은 입력에 포함되지 않는다 (§3.1). 0.01 단위로 반올림한 값을 공개하고 그대로 판정에 쓴다.
 */
export function calculateHireChance(
  input: HireChanceInput,
  content: ContentIndex,
): { chance: number; reasons: string[] } {
  const { hiring, chanceMin, chanceMax } = content.pack.rules;
  const reasons: string[] = [];
  let chance = hiring.baseChanceByGrade[input.grade];
  reasons.push(`${input.grade}등급 기본 ${Math.round(chance * 100)}%`);

  const major = requireFrom(content.backgrounds, input.character.majorId, 'background');
  if (major.fitsJobs?.includes(input.jobId)) {
    chance += hiring.majorFitBonus;
    reasons.push(`전공 적합(${major.name}) ${pct(hiring.majorFitBonus)}`);
  }

  for (const id of input.character.backgroundTraits) {
    const bg = requireFrom(content.backgrounds, id, 'background');
    const bonus = (bg.hireBonus?.all ?? 0) + (bg.hireBonus?.byJob?.[input.jobId] ?? 0);
    if (bonus !== 0) {
      chance += bonus;
      reasons.push(`${bg.name} ${pct(bonus)}`);
    }
  }

  const repBonus = Math.round((input.resources.reputation - 50) * hiring.reputationFactor * 100) / 100;
  if (repBonus !== 0) {
    chance += repBonus;
    reasons.push(`평판 ${pct(repBonus)}`);
  }

  return { chance: Math.round(clamp(chance, chanceMin, chanceMax) * 100) / 100, reasons };
}

export function calculateOfferSalary(
  company: CompanyDefinition,
  jobId: JobId,
  content: ContentIndex,
): number {
  const { salary } = content.pack.rules;
  // 정수 연산: 기본 연봉 × 직무계수(‰) / 1000
  const raw = Math.floor(
    (salary.baseAnnualByGrade[company.grade] * salary.jobCoefficientPermille[jobId]) / 1000,
  );
  const range = salary.rangeByGrade[company.grade];
  return clamp(roundKrw(raw, salary.roundingUnit), range.min, range.max);
}

/** 입사 이력이 한 번도 없는 첫 구직인가 (§26.4) */
export function isFirstJobSearch(state: GameRunState): boolean {
  return state.statistics.highestRank === null;
}

/**
 * §3.2 지원 카드 3장. 티어별(도전/적정/안전) 등급에서 서로 다른 회사를 뽑는다.
 * §26.4 첫 구직에서는 세 번째 카드가 항상 규칙의 확정 등급(F) + 합격 확정(100%)이다.
 */
export function generateJobOffers(state: GameRunState, content: ContentIndex): JobOffer[] {
  const character = state.selectedCharacter;
  if (!character) throw new EngineError('INVARIANT_VIOLATION', 'character not selected');
  const { hiring } = content.pack.rules;
  const rng = SeededRng.derive(state.seed, 'jobOffers', state.turnIndex, state.jobSearch.round);
  const major = requireFrom(content.backgrounds, character.majorId, 'background');
  const usedCompanies = new Set<string>();
  const firstSearch = isFirstJobSearch(state);

  // 첫 구직: S 없음 + 높은 등급일수록 낮은 가중치, 세 번째는 F 확정 (§26.4)
  const tiers: Array<Partial<Record<CompanyGrade, number>>> = firstSearch
    ? [...hiring.firstJobOfferTiers, { [hiring.firstJobGuaranteedGrade]: 1 }]
    : hiring.offerTiers;

  return tiers.map((weights, tier) => {
    const guaranteed = firstSearch && tier === 2;
    // 등급을 가중치로 먼저 뽑고(남은 회사가 있는 등급만), 그 등급에서 회사를 고른다
    const available = (Object.entries(weights) as Array<[CompanyGrade, number]>).filter(([g]) =>
      content.pack.companies.some((c) => c.grade === g && !usedCompanies.has(c.id)),
    );
    if (available.length === 0) {
      throw new EngineError('UNKNOWN_REFERENCE', `no company available for tier ${tier}`);
    }
    const grade = available[rng.weightedIndex(available.map(([, w]) => w))]![0];
    const candidates = content.pack.companies.filter((c) => c.grade === grade && !usedCompanies.has(c.id));
    const company = rng.pick(candidates);
    usedCompanies.add(company.id);

    const fitJobs = major.fitsJobs ?? [];
    const jobId: JobId = tier === 1 && fitJobs.length > 0 ? rng.pick(fitJobs) : rng.pick(JOB_IDS);
    const { chance, reasons } = guaranteed
      ? { chance: 1, reasons: ['첫 직장 합격 확정'] }
      : calculateHireChance({ character, resources: state.resources, grade: company.grade, jobId }, content);
    return {
      offerId: `offer_r${state.jobSearch.round}_${tier + 1}`,
      companyId: company.id,
      grade: company.grade,
      jobId,
      hireChance: chance,
      annualSalary: calculateOfferSalary(company, jobId, content),
      guaranteed,
      reasons,
    };
  });
}

export interface JobApplicationResult {
  /** 지원한 카드의 합격 여부 */
  hired: boolean;
  appliedOffer: JobOffer;
  /** 실제 입사한 카드 (불합격 시 확정 카드) */
  joinedOffer: JobOffer;
  autoAssigned: boolean;
  roll: number;
  npcTeamCreated: boolean;
}

/**
 * §23.3 JOB_OFFERS --apply--> MONTH_START.
 * 판정은 주 RNG 스트림(rngState)을 사용한다. §26.4 첫 구직에서 불합격하면 정신력 비용을 치르고
 * 화면에 보였던 확정 카드의 회사로 자동 입사한다 — 첫 구직은 반복되지 않는다.
 */
export function applyForJob(
  state: GameRunState,
  offerId: string,
  content: ContentIndex,
): { state: GameRunState; result: JobApplicationResult } {
  assertCommand(state.phase, 'apply');
  const offer = state.jobOffers.find((o) => o.offerId === offerId);
  if (!offer) throw new EngineError('OFFER_NOT_FOUND', `unknown offerId: ${offerId}`, { offerId });

  const rng = new SeededRng(state.rngState);
  const { success: hired, roll } = rng.roll(offer.hireChance);
  const fallback = state.jobOffers.find((o) => o.guaranteed);
  const joined = hired ? offer : fallback;
  if (!joined) {
    throw new EngineError('INVARIANT_VIOLATION', 'job offers without a guaranteed card', { offerId });
  }
  const autoAssigned = !hired;
  assertTransition(state.phase, 'apply', 'MONTH_START');

  const applied = requireFrom(content.companies, offer.companyId, 'company');
  const company = requireFrom(content.companies, joined.companyId, 'company');
  const resources = autoAssigned
    ? {
        ...state.resources,
        mental: clampStat(state.resources.mental - content.pack.rules.hiring.rejectionMentalCost),
      }
    : state.resources;

  let next: GameRunState = {
    ...state,
    rngState: rng.state,
    phase: 'MONTH_START',
    resources,
    jobOffers: [],
    jobSearch: {
      round: state.jobSearch.round + 1,
      consecutiveRejections: 0,
      lastResult: {
        offerId,
        companyId: offer.companyId,
        hired,
        autoAssignedCompanyId: autoAssigned ? joined.companyId : null,
        turnIndex: state.turnIndex,
      },
    },
    employment: {
      status: 'EMPLOYED',
      current: {
        companyId: joined.companyId,
        teamId: joined.jobId,
        jobId: joined.jobId,
        rank: 'STAFF',
        annualSalary: joined.annualSalary,
        startedTurn: state.turnIndex,
        rankSinceTurn: state.turnIndex,
        promotionPoints: 0,
        promotionMisses: 0,
      },
      jobLoss: null,
    },
    statistics: { ...state.statistics, highestRank: state.statistics.highestRank ?? 'STAFF' },
    eventHistory: [
      ...state.eventHistory,
      {
        turnIndex: state.turnIndex,
        kind: 'JOB_APPLICATION',
        summary: hired
          ? `${applied.name} ${JOB_LABELS[offer.jobId]} 합격`
          : `${applied.name} 불합격 → ${company.name} ${JOB_LABELS[joined.jobId]} 입사`,
        data: { offerId, companyId: offer.companyId, chance: offer.hireChance, roll, hired, autoAssigned },
      },
    ],
  };

  const team = ensureCompanyTeam(next, joined.companyId, joined.jobId, content);
  next = team.state;
  if (team.created) {
    next = {
      ...next,
      eventHistory: [
        ...next.eventHistory,
        {
          turnIndex: state.turnIndex,
          kind: 'NPC_TEAM_CREATED',
          summary: `${company.name} ${JOB_LABELS[joined.jobId]}팀 상사·동료 배정`,
          data: { companyId: joined.companyId, teamId: joined.jobId },
        },
      ],
    };
  }
  return {
    state: next,
    result: {
      hired,
      appliedOffer: offer,
      joinedOffer: joined,
      autoAssigned,
      roll,
      npcTeamCreated: team.created,
    },
  };
}
