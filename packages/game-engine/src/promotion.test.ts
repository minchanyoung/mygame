import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, type GameRunState } from '@company-life/shared';
import { processAnnualReview } from './annual';
import { buildEnding } from './ending';
import { judgeLifeGoal, lifeGoalProgress, updateLifeGoalMilestone } from './goals';
import { startMonth } from './month';
import { currentTeamNpcs } from './npcs';
import { processPromotion, promotionChance, promotionStatus } from './promotion';
import { ALWAYS_FAIL, ALWAYS_SUCCEED, content, employedRun, withTraits } from './test-fixtures';
import { toPublicView } from './view';

const base = employedRun();

/** 1월(입사 2년 뒤), 사원 → 대리 심사 자격을 채운 상태 */
function eligible(patch: Partial<NonNullable<GameRunState['employment']['current']>> = {}): GameRunState {
  return {
    ...base,
    turnIndex: 24,
    resources: { health: 80, mental: 80, focus: 80, reputation: 60 },
    employment: {
      ...base.employment,
      current: { ...base.employment.current!, rankSinceTurn: 0, promotionPoints: 6, ...patch },
    },
  };
}

describe('S5 승진 심사', () => {
  it('근속이나 포인트가 모자라면 심사가 열리지 않는다 (자동 승진 없음)', () => {
    expect(processPromotion(eligible({ promotionPoints: 3 }), content).result).toBeNull();
    expect(processPromotion({ ...eligible(), turnIndex: 12 }, content).result).toBeNull();
    // 1월이 아니면 열리지 않는다
    expect(processPromotion({ ...eligible(), turnIndex: 25 }, content).result).toBeNull();
    expect(promotionStatus(eligible(), content)).toMatchObject({
      to: 'ASSISTANT_MANAGER',
      yearsInRank: 2,
      minYears: 2,
      points: 6,
      requiredPoints: 4,
      eligible: true,
    });
  });

  it('PIP 경고 중에는 심사 자체가 막힌다', () => {
    const s = eligible();
    const warned: GameRunState = {
      ...s,
      flags: [
        {
          key: 'performance_warning',
          scope: 'COMPANY',
          ownerId: s.employment.current!.companyId,
          value: true,
          createdTurn: 23,
          expiresTurn: 30,
          sourceEventId: null,
        },
      ],
    };
    expect(promotionStatus(warned, content)).toMatchObject({ blocked: true, eligible: false });
    expect(processPromotion(warned, content).result).toBeNull();
  });

  it('성공: 직급·근속 기준·포인트·누락 초기화, 승진 인상, 최고 직급·이력·승진 턱 플래그', () => {
    const s = { ...eligible({ promotionMisses: 1 }), rngState: ALWAYS_SUCCEED };
    const { state, result } = processPromotion(s, content);
    const job = state.employment.current!;
    expect(result).toMatchObject({ from: 'STAFF', to: 'ASSISTANT_MANAGER', success: true, misses: 0 });
    expect(job).toMatchObject({
      rank: 'ASSISTANT_MANAGER',
      rankSinceTurn: 24,
      promotionPoints: 0,
      promotionMisses: 0,
    });
    expect(job.annualSalary).toBe(result!.salaryTo);
    expect(result!.salaryTo).toBeGreaterThan(result!.salaryFrom!);
    expect(state.statistics.highestRank).toBe('ASSISTANT_MANAGER');
    expect(state.eventHistory.at(-1)?.kind).toBe('PROMOTION');
    expect(state.flags.some((f) => f.key === 'just_promoted' && f.scope === 'RUN')).toBe(true);
    expect(GameRunStateSchema.safeParse(state).success).toBe(true);
  });

  it('상사 직급을 따라잡으면 새 상사가 배치되고, 기존 상사는 전 상사로 기억이 남는다 (§21.2)', () => {
    const s = eligible();
    const boss = currentTeamNpcs(s).find((t) => t.role === 'BOSS')!.npc;
    const lowBoss = {
      ...s,
      rngState: ALWAYS_SUCCEED,
      npcs: s.npcs.map((n) => (n.npcId === boss.npcId ? { ...n, rank: 'ASSISTANT_MANAGER' as const } : n)),
    };
    const { state, result } = processPromotion(lowBoss, content);
    expect(result?.newBossName).not.toBeNull();
    const newBoss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')!.npc;
    expect(newBoss.npcId).not.toBe(boss.npcId);
    expect(state.npcs.some((n) => n.npcId === boss.npcId)).toBe(true);
    expect(state.npcAssignments.some((a) => a.npcId === boss.npcId && a.role === 'FORMER_BOSS')).toBe(true);
  });

  it('누락(무겁게): 정신력 −8 · 평판 −5 · 상사 호감 −8, 포인트 유지, 다음 심사 확률 보정', () => {
    const s = { ...eligible(), rngState: ALWAYS_FAIL };
    const boss = currentTeamNpcs(s).find((t) => t.role === 'BOSS')!.npc;
    const { state, result } = processPromotion(s, content);
    expect(result).toMatchObject({ success: false, misses: 1, salaryTo: null });
    expect(state.resources.mental).toBe(72);
    expect(state.resources.reputation).toBe(55);
    expect(state.npcs.find((n) => n.npcId === boss.npcId)!.favor).toBe(Math.max(0, boss.favor - 8));
    expect(state.employment.current).toMatchObject({ rank: 'STAFF', promotionPoints: 6, promotionMisses: 1 });
    expect(state.scheduledEvents).toHaveLength(0);
    // 누락 1회당 missBonus(S13: +3%p)만큼 (상한 안쪽에서)
    const again = { ...state, resources: s.resources };
    expect(promotionChance(again, content)!).toBeCloseTo(
      Math.min(
        content.pack.rules.chanceMax,
        promotionChance(s, content)! + content.pack.rules.promotion.missBonus,
      ),
      5,
    );
  });

  it('2연속 누락이면 "후배가 먼저 달았다" 사건이 그달 업무 칸으로 열린다', () => {
    const s = { ...eligible({ promotionMisses: 1 }), rngState: ALWAYS_FAIL };
    // 확률 보정으로 성공하지 않도록 ALWAYS_FAIL(roll ≥ 0.95) 사용
    const opened = startMonth(s, content);
    expect(opened.currentMonth?.promotion).toMatchObject({ success: false, misses: 2 });
    expect(opened.activeEvent?.eventId).toBe('evt_promotion_passed_over');
    const view = toPublicView(opened, content);
    expect(view.activeEvent?.slot).toBe('work');
  });

  it('확률: 초과 포인트는 유리, 사내 낙인 Lv.2는 불리', () => {
    const plain = promotionChance(eligible({ promotionPoints: 4 }), content)!;
    expect(promotionChance(eligible({ promotionPoints: 6 }), content)!).toBeGreaterThan(plain);
    expect(
      promotionChance(withTraits(eligible({ promotionPoints: 4 }), {}, { officeStigma: 2 }), content)!,
    ).toBeLessThan(plain);
  });

  it('12월 평가 등급만큼 승진 포인트가 쌓인다', () => {
    const s = { ...base, turnIndex: 11 };
    const { state, review } = processAnnualReview(s, content);
    expect(state.employment.current!.promotionPoints).toBe(
      s.employment.current!.promotionPoints + content.pack.rules.promotion.pointsByGrade[review!.grade],
    );
  });

  it('공개 뷰: 승진 진행(근속·포인트)은 보이고 확률은 보이지 않는다', () => {
    const view = toPublicView(eligible(), content);
    expect(view.employment.promotion).toMatchObject({
      nextRankLabel: '대리',
      points: 6,
      requiredPoints: 4,
      eligible: true,
    });
    expect(JSON.stringify(view.employment.promotion)).not.toMatch(/chance|0\.\d/);
  });
});

describe('S5 인생 목표', () => {
  const withGoal = (goalId: string, patch: Partial<GameRunState> = {}): GameRunState => ({
    ...base,
    lifeGoal: { goalId, milestones: [] },
    ...patch,
  });
  const atAge = (age: number) => (age - content.pack.rules.startAge) * 12;

  it('실패 엔딩(50세 전 실직)은 어떤 목표든 자동 미달성', () => {
    const s = withGoal('goal_full_tenure', { resources: { ...base.resources, health: 0 } });
    const ending = buildEnding(s, 'OVERWORK_DISMISSAL', null, content);
    expect(ending.category).toBe('FAILURE');
    expect(ending.goal).toMatchObject({ goalId: 'goal_full_tenure', achieved: false });
  });

  it('정년 완주는 정년 은퇴일 때만, 조기 은퇴는 미달성', () => {
    const s = withGoal('goal_full_tenure', { turnIndex: atAge(60) });
    expect(buildEnding(s, 'RETIREMENT', null, content).goal?.achieved).toBe(true);
    const early = withGoal('goal_full_tenure', { turnIndex: atAge(55) });
    expect(buildEnding(early, 'RESTRUCTURING', null, content)).toMatchObject({
      type: 'EARLY_RETIREMENT',
      goal: { achieved: false },
    });
  });

  it('부장 달기·내 집 마련·빚 없는 인생·에이스·워라밸 판정', () => {
    const normal = { category: 'NORMAL' as const, type: 'RETIREMENT' as const };
    const head = withGoal('goal_department_head', {
      statistics: { ...base.statistics, highestRank: 'DEPARTMENT_HEAD' },
    });
    expect(judgeLifeGoal(head, normal, content)?.achieved).toBe(true);
    expect(judgeLifeGoal(withGoal('goal_department_head'), normal, content)?.achieved).toBe(false);

    const home = content.pack.lifeGoals.find((g) => g.id === 'goal_own_home')!.amount!;
    expect(
      judgeLifeGoal(withGoal('goal_own_home', { cash: home + 10, debt: 10 }), normal, content)?.achieved,
    ).toBe(true);
    expect(
      judgeLifeGoal(withGoal('goal_own_home', { cash: home, debt: 10 }), normal, content)?.achieved,
    ).toBe(false);

    const free = content.pack.lifeGoals.find((g) => g.id === 'goal_debt_free')!.amount!;
    expect(
      judgeLifeGoal(withGoal('goal_debt_free', { cash: free, debt: 0 }), normal, content)?.achieved,
    ).toBe(true);
    expect(
      judgeLifeGoal(withGoal('goal_debt_free', { cash: free * 2, debt: 1 }), normal, content)?.achieved,
    ).toBe(false);

    const count = content.pack.lifeGoals.find((g) => g.id === 'goal_ace')!.count!;
    const reviews = Array.from({ length: count }, (_, i) => ({
      yearIndex: i,
      turnIndex: i * 12 + 11,
      companyId: base.employment.current!.companyId,
      grade: 'S' as const,
      score: 90,
      bonus: 0,
    }));
    expect(judgeLifeGoal(withGoal('goal_ace', { annualReviews: reviews }), normal, content)?.achieved).toBe(
      true,
    );

    const stat = content.pack.lifeGoals.find((g) => g.id === 'goal_work_life_balance')!.stat!;
    const fit = withGoal('goal_work_life_balance', {
      resources: { ...base.resources, health: stat, mental: stat },
    });
    expect(judgeLifeGoal(fit, normal, content)?.achieved).toBe(true);
    const tired = withGoal('goal_work_life_balance', {
      resources: { ...base.resources, health: stat, mental: stat - 1 },
    });
    expect(judgeLifeGoal(tired, normal, content)?.achieved).toBe(false);
  });

  it('진행 구간(25/50/75%)은 한 번씩만 축하하고 정신력 +3', () => {
    const s = withGoal('goal_full_tenure', {
      turnIndex: atAge(42),
      resources: { ...base.resources, mental: 50 },
    });
    expect(lifeGoalProgress(s, content)!.percent).toBeGreaterThanOrEqual(50);
    const once = updateLifeGoalMilestone(s, content);
    expect(once.milestone).toBe(50);
    expect(once.state.lifeGoal!.milestones).toEqual([25, 50]);
    expect(once.state.resources.mental).toBe(53);
    const twice = updateLifeGoalMilestone(once.state, content);
    expect(twice.milestone).toBeNull();
    expect(twice.state.resources.mental).toBe(53);
  });

  it('공개 뷰: 목표 진행 문구와 엔딩의 목표 판정', () => {
    const s = withGoal('goal_department_head');
    expect(toPublicView(s, content).lifeGoal).toMatchObject({
      title: '부장 달기',
      progressLabel: '현재 사원 / 목표 부장',
    });
  });
});
