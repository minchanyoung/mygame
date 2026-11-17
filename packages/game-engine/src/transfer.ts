import {
  COMPANY_GRADES,
  JOB_LABELS,
  type CompanyGrade,
  type GameRunState,
  type NpcAssignment,
  type TransferOffer,
} from '@company-life/shared';
import { requireFrom, type ContentIndex } from './content-index';
import { EngineError } from './errors';
import { roundKrw } from './numbers';
import { ensureCompanyTeam } from './npcs';
import { SeededRng } from './rng';
import { assertCommand, assertTransition } from './state-machine';

/**
 * S7 이직. 헤드헌터 사건 성공 → 이직 제안서 1장 → 그달 결산에서 [옮긴다]/[남는다].
 * 옮기면 연봉은 오르지만 승진 포인트·근속은 초기화(Q1), 직급은 유지(Q2), 새 팀과 수습 기간.
 * 자발적 퇴사가 아니라 회사를 옮기는 것이므로 실직 판정과 무관하다 (§26 Q3).
 */

const gradeIndex = (g: CompanyGrade) => COMPANY_GRADES.indexOf(g);

/** 지금 회사보다 등급이 높은 회사 하나와 인상된 연봉 (시드·턴 고정) */
export function generateTransferOffer(state: GameRunState, content: ContentIndex): TransferOffer | null {
  const job = state.employment.current;
  if (!job) return null;
  const rules = content.pack.rules;
  const t = rules.transfer;
  const current = requireFrom(content.companies, job.companyId, 'company');
  const rng = SeededRng.derive(state.seed, 'transfer', state.turnIndex, state.statistics.transfers);

  const cur = gradeIndex(current.grade);
  const pool = (minUp: number, maxUp: number) =>
    content.pack.companies.filter((c) => {
      const up = cur - gradeIndex(c.grade);
      return c.id !== job.companyId && up >= minUp && up <= maxUp;
    });
  // 한두 등급 위, 없으면(이미 최상위 근처) 같은 등급의 다른 회사
  const candidates =
    pool(t.gradeUp.min, t.gradeUp.max).length > 0 ? pool(t.gradeUp.min, t.gradeUp.max) : pool(0, 0);
  if (candidates.length === 0) return null;
  const company = rng.pick(candidates);

  const permille = rng.int(t.raisePermille.min, t.raisePermille.max);
  const raised = Math.floor((job.annualSalary * (1000 + permille)) / 1000);
  const gradeFloor = rules.salary.rangeByGrade[company.grade].min;
  return {
    offerId: `transfer_t${state.turnIndex}`,
    companyId: company.id,
    grade: company.grade,
    jobId: job.jobId,
    annualSalary: roundKrw(Math.max(raised, gradeFloor), rules.salary.roundingUnit),
    turnIndex: state.turnIndex,
  };
}

function validOffer(state: GameRunState): TransferOffer {
  const offer = state.transferOffer;
  if (!offer || offer.turnIndex !== state.turnIndex) {
    throw new EngineError('OFFER_NOT_FOUND', 'no transfer offer this month');
  }
  return offer;
}

/** MONTH_SUMMARY --acceptTransfer--> MONTH_SUMMARY. 실직이 예고된 달에는 옮길 수 없다. */
export function acceptTransfer(state: GameRunState, content: ContentIndex): GameRunState {
  assertCommand(state.phase, 'acceptTransfer');
  const offer = validOffer(state);
  const job = state.employment.current;
  if (!job || state.pendingEnding) throw new EngineError('INVALID_TRANSITION', 'cannot transfer now');
  assertTransition(state.phase, 'acceptTransfer', 'MONTH_SUMMARY');
  const t = content.pack.rules.transfer;
  const from = requireFrom(content.companies, job.companyId, 'company');
  const to = requireFrom(content.companies, offer.companyId, 'company');

  // 기존 팀 배정 종료 (NPC와 관계 기억은 보존)
  const npcAssignments = state.npcAssignments.map((a): NpcAssignment =>
    a.companyId === job.companyId && a.teamId === job.teamId && a.toTurn === null
      ? { ...a, toTurn: state.turnIndex }
      : a,
  );
  const moved: GameRunState = {
    ...state,
    transferOffer: null,
    npcAssignments,
    resources: { ...state.resources, reputation: t.startingReputation },
    employment: {
      ...state.employment,
      current: {
        companyId: to.id,
        teamId: offer.jobId,
        jobId: offer.jobId,
        rank: job.rank,
        annualSalary: offer.annualSalary,
        startedTurn: state.turnIndex,
        rankSinceTurn: state.turnIndex,
        promotionPoints: 0,
        promotionMisses: 0,
        probationUntilTurn: state.turnIndex + t.probationMonths,
      },
    },
    flags: [
      ...state.flags.filter((f) => !(f.key === t.probationFlag && f.scope === 'RUN')),
      {
        key: t.probationFlag,
        scope: 'RUN',
        ownerId: null,
        value: true,
        createdTurn: state.turnIndex,
        expiresTurn: state.turnIndex + t.probationMonths,
        sourceEventId: null,
      },
    ],
    statistics: {
      ...state.statistics,
      transfers: state.statistics.transfers + 1,
      jobChanges: state.statistics.jobChanges + 1,
    },
    eventHistory: [
      ...state.eventHistory,
      {
        turnIndex: state.turnIndex,
        kind: 'TRANSFER',
        summary: `${from.name} → ${to.name} ${JOB_LABELS[offer.jobId]}팀 이직`,
        data: { from: from.id, to: to.id, salary: offer.annualSalary },
      },
    ],
  };
  return ensureCompanyTeam(moved, to.id, offer.jobId, content).state;
}

/** MONTH_SUMMARY --declineTransfer--> MONTH_SUMMARY */
export function declineTransfer(state: GameRunState): GameRunState {
  assertCommand(state.phase, 'declineTransfer');
  validOffer(state);
  assertTransition(state.phase, 'declineTransfer', 'MONTH_SUMMARY');
  return { ...state, transferOffer: null };
}
