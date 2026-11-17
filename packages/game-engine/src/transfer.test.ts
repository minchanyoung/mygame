import { describe, expect, it } from 'vitest';
import { COMPANY_GRADES, GameRunStateSchema, type GameRunState } from '@company-life/shared';
import { buildEnding } from './ending';
import { EngineError } from './errors';
import { getEligibleEvents, resolveChoice } from './events';
import { applyMonthlySettlement, chooseInMonth, nextMonth } from './month';
import { currentTeamNpcs } from './npcs';
import { ALWAYS_SUCCEED, content, employedRun, open } from './test-fixtures';
import { acceptTransfer, declineTransfer, generateTransferOffer } from './transfer';
import { toPublicView } from './view';

const NOW = '2026-11-17T00:00:00.000Z';
const base = employedRun();
const atAge = (age: number) => (age - content.pack.rules.startAge) * 12;
const gradeIdx = (g: string) => COMPANY_GRADES.indexOf(g as (typeof COMPANY_GRADES)[number]);

/** 헤드헌터 조건을 채운 상태 (28세, 재직 4년, 평판 80) */
function seasoned(patch: Partial<GameRunState> = {}): GameRunState {
  return {
    ...base,
    turnIndex: 48,
    resources: { health: 80, mental: 80, focus: 80, reputation: 80 },
    ...patch,
  };
}

/** 헤드헌터 사건 성공 → 결산(MONTH_SUMMARY)에 이직 제안서가 있는 상태 */
function withOffer(): GameRunState {
  const opened = { ...open(seasoned(), 'evt_headhunter_call'), rngState: ALWAYS_SUCCEED };
  return chooseInMonth(opened, 'send_resume', content).state;
}

const workIds = (s: GameRunState) => getEligibleEvents(s, content, 'work').map((c) => c.event.id);

describe('S7 이직', () => {
  it('헤드헌터는 재직 2년·평판 60 이상·이직 1회 이하일 때만', () => {
    expect(workIds(seasoned())).toContain('evt_headhunter_call');
    expect(workIds(seasoned({ turnIndex: 12 }))).not.toContain('evt_headhunter_call');
    expect(
      workIds(seasoned({ resources: { health: 80, mental: 80, focus: 80, reputation: 50 } })),
    ).not.toContain('evt_headhunter_call');
    expect(workIds(seasoned({ statistics: { ...base.statistics, transfers: 2 } }))).not.toContain(
      'evt_headhunter_call',
    );
  });

  it('성공하면 지금보다 높은 등급 회사·15% 이상 인상된 연봉의 제안서가 생긴다 (시드 고정)', () => {
    const s = withOffer();
    const offer = s.transferOffer!;
    const job = s.employment.current!;
    const cur = content.companies.get(job.companyId)!;
    expect(offer.companyId).not.toBe(job.companyId);
    expect(gradeIdx(offer.grade)).toBeLessThan(gradeIdx(cur.grade));
    expect(offer.annualSalary).toBeGreaterThanOrEqual(Math.floor(job.annualSalary * 1.15) - 100_000);
    expect(offer.jobId).toBe(job.jobId);
    expect(generateTransferOffer(s, content)).toEqual(offer);
  });

  it('수락: 새 회사·새 팀, 직급 유지, 포인트·근속 초기화, 수습 3개월, 평판 50, 기존 팀 기억 보존', () => {
    const before = withOffer();
    // 한 달 사건을 모두 끝내 결산 상태로
    let s = before;
    while (s.phase === 'EVENT_PENDING') {
      const view = toPublicView(s, content).activeEvent!;
      s = chooseInMonth(s, view.choices.find((c) => c.enabled && !c.fatalWarning)!.id, content).state;
    }
    expect(s.phase).toBe('MONTH_SUMMARY');
    const oldJob = s.employment.current!;
    const oldBoss = currentTeamNpcs(s).find((t) => t.role === 'BOSS')!.npc;
    const offer = s.transferOffer!;
    const moved = acceptTransfer(
      { ...s, employment: { ...s.employment, current: { ...oldJob, promotionPoints: 7 } } },
      content,
    );
    const job = moved.employment.current!;
    expect(job).toMatchObject({
      companyId: offer.companyId,
      rank: oldJob.rank,
      annualSalary: offer.annualSalary,
      promotionPoints: 0,
      promotionMisses: 0,
      rankSinceTurn: s.turnIndex,
      probationUntilTurn: s.turnIndex + 3,
    });
    expect(moved.resources.reputation).toBe(50);
    expect(moved.statistics.transfers).toBe(1);
    expect(moved.transferOffer).toBeNull();
    expect(moved.phase).toBe('MONTH_SUMMARY');
    const team = currentTeamNpcs(moved);
    expect(team.every((t) => t.npc.companyId === offer.companyId)).toBe(true);
    expect(team).toHaveLength(3);
    expect(moved.npcs.some((n) => n.npcId === oldBoss.npcId)).toBe(true);
    expect(moved.flags.some((f) => f.key === 'new_hire_probation')).toBe(true);
    expect(moved.eventHistory.at(-1)?.kind).toBe('TRANSFER');
    expect(GameRunStateSchema.safeParse(moved).success).toBe(true);
    const view = toPublicView(moved, content);
    expect(view.employment.probationMonthsLeft).toBe(3);
    expect(view.transferOffer).toBeNull();
  });

  it('거절하거나 다음 달로 넘어가면 제안서는 사라진다, 제안서 없이 수락하면 오류', () => {
    let s = withOffer();
    while (s.phase === 'EVENT_PENDING') {
      const view = toPublicView(s, content).activeEvent!;
      s = chooseInMonth(s, view.choices.find((c) => c.enabled && !c.fatalWarning)!.id, content).state;
    }
    expect(toPublicView(s, content).transferOffer).not.toBeNull();
    expect(declineTransfer(s).transferOffer).toBeNull();
    const next = nextMonth(s, content, NOW);
    expect(next.transferOffer).toBeNull();
    expect(() => acceptTransfer({ ...s, transferOffer: null }, content)).toThrow(EngineError);
  });

  it('카운터 오퍼: 남는 대신 연봉 인상, 상사 신뢰 하락', () => {
    const s = { ...open(seasoned(), 'evt_headhunter_call'), rngState: ALWAYS_SUCCEED };
    const salary = s.employment.current!.annualSalary;
    const after = resolveChoice(s, 'counter_offer', content).state;
    expect(after.employment.current!.annualSalary).toBe(Math.floor((salary * 1.08) / 100_000) * 100_000);
    expect(after.transferOffer).toBeNull();
  });
});

describe('S7 50대', () => {
  it('나이 듦: 50세부터 체력 회복 −1, 55세부터 한 번 더', () => {
    const health = (age: number) => {
      const s = { ...base, turnIndex: atAge(age), resources: { ...base.resources, health: 50 } };
      return applyMonthlySettlement(s, content).state.resources.health - 50;
    };
    const natural = content.pack.rules.monthly.naturalChange.health ?? 0;
    expect(health(49)).toBe(natural);
    expect(health(50)).toBe(natural - 1);
    expect(health(55)).toBe(natural - 2);
  });

  it('임원 후보: 성공하면 "별을 달다" 정상 엔딩, 부장 달기 목표 달성', () => {
    const head: GameRunState = {
      ...base,
      turnIndex: atAge(52),
      resources: { health: 80, mental: 80, focus: 80, reputation: 90 },
      lifeGoal: { goalId: 'goal_department_head', milestones: [] },
      statistics: { ...base.statistics, highestRank: 'DEPARTMENT_HEAD' },
      employment: { ...base.employment, current: { ...base.employment.current!, rank: 'DEPARTMENT_HEAD' } },
    };
    expect(workIds(head)).toContain('evt_senior_executive_review');
    const s = { ...open(head, 'evt_senior_executive_review'), rngState: ALWAYS_SUCCEED };
    const done = chooseInMonth(s, 'go_for_it', content).state;
    expect(done.pendingEnding).toMatchObject({
      type: 'EXECUTIVE_PROMOTION',
      category: 'NORMAL',
      goal: { achieved: true },
    });
    expect(done.pendingEnding?.retirementTier).not.toBeNull();
  });

  it('건강검진을 미루면 넉 달 뒤 "미뤄둔 결과지"가 예약된다', () => {
    const s = { ...open({ ...base, turnIndex: atAge(46) }, 'evt_senior_health_check') };
    const after = resolveChoice(s, 'ignore', content).state;
    expect(after.scheduledEvents.at(-1)).toMatchObject({
      eventId: 'evt_senior_health_recheck',
      dueTurn: atAge(46) + 4,
      status: 'PENDING',
    });
  });

  it('노후 등급: 정상 엔딩에만, 물가 지수를 반영한 순자산 기준', () => {
    const retire = { ...base, turnIndex: atAge(60) };
    expect(buildEnding({ ...retire, cash: 0, debt: 0 }, 'RETIREMENT', null, content).retirementTier).toBe(
      'TIGHT',
    );
    expect(
      buildEnding({ ...retire, cash: 100_000_000_000, debt: 0 }, 'RETIREMENT', null, content).retirementTier,
    ).toBe('COMFORTABLE');
    const failed = buildEnding({ ...base, turnIndex: atAge(30) }, 'OUSTED', null, content);
    expect(failed.retirementTier).toBeNull();
    expect(
      toPublicView(
        { ...retire, phase: 'GAME_OVER', ending: buildEnding(retire, 'RETIREMENT', null, content) },
        content,
      ).ending?.retirement?.title,
    ).toBeTruthy();
  });
});
