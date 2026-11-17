import { turnInfo, type Ending, type GameRunState, type LifeGoalDefinition } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { EngineError } from './errors';
import { clamp, clampStat } from './numbers';
import { rankIndex } from './promotion';
import { SeededRng } from './rng';

/**
 * S5 인생 목표. 캐릭터 확정 직후 무작위 3장(1장은 배경과 어울리는 목표)을 고정 제시하고 1장을 고른다.
 * 판정은 엔딩 시점에 정상 엔딩(조기 은퇴·정년)만 — 실패 엔딩은 자동 미달성 (S5 Q3).
 */

export function goalDef(content: ContentIndex, goalId: string): LifeGoalDefinition {
  const def = content.pack.lifeGoals.find((g) => g.id === goalId);
  if (!def) throw new EngineError('INVARIANT_VIOLATION', `unknown life goal ${goalId}`);
  return def;
}

/** 목표 후보 (시드 고정, 재조회해도 다시 굴리지 않도록 상태에 저장해 쓴다) */
export function offerLifeGoals(state: GameRunState, content: ContentIndex): string[] {
  const rng = SeededRng.derive(state.seed, 'life-goals');
  const goals = content.pack.lifeGoals;
  const count = Math.min(content.pack.rules.lifeGoal.offerCount, goals.length);
  const picked: string[] = [];
  const fitting = goals.filter((g) => g.affinity?.some((id) => state.backgroundTraits.includes(id)));
  if (fitting.length > 0) picked.push(rng.pick(fitting).id);
  const rest = goals.filter((g) => !picked.includes(g.id));
  while (picked.length < count && rest.length > 0) {
    const [g] = rest.splice(rng.int(0, rest.length - 1), 1);
    picked.push(g!.id);
  }
  return picked;
}

export interface GoalProgress {
  percent: number;
  current: number;
  target: number;
}

/** 진행도 0~100. 화면 표시와 축하 구간 판정에 쓴다 (달성 판정은 judgeLifeGoal). */
export function lifeGoalProgress(state: GameRunState, content: ContentIndex): GoalProgress | null {
  if (!state.lifeGoal) return null;
  const def = goalDef(content, state.lifeGoal.goalId);
  const { rules } = content.pack;
  const age = turnInfo(state.turnIndex, rules.startAge).age;
  const pct = (cur: number, target: number) =>
    Math.floor(clamp(target > 0 ? (cur / target) * 100 : 0, 0, 100));
  switch (def.kind) {
    case 'NET_WORTH':
    case 'DEBT_FREE': {
      const cur = state.cash - state.debt;
      return { percent: pct(cur, def.amount!), current: cur, target: def.amount! };
    }
    case 'RANK': {
      const rank = state.employment.current?.rank ?? state.statistics.highestRank ?? 'STAFF';
      return {
        percent: pct(rankIndex(rank), rankIndex(def.rank!)),
        current: rankIndex(rank),
        target: rankIndex(def.rank!),
      };
    }
    case 'FULL_TENURE':
      return {
        percent: pct(age - rules.startAge, rules.retireAge - rules.startAge),
        current: age,
        target: rules.retireAge,
      };
    case 'WELLBEING': {
      const cur = Math.min(state.resources.health, state.resources.mental);
      // 진행 = 50세까지 버틴 정도. 현재 상태가 기준 미만이면 절반만 인정
      const tenure = pct(age - rules.startAge, rules.gameOver.failureBeforeAge - rules.startAge);
      return { percent: cur >= def.stat! ? tenure : Math.floor(tenure / 2), current: cur, target: def.stat! };
    }
    case 'ACE': {
      const sCount = state.annualReviews.filter((r) => r.grade === 'S').length;
      return { percent: pct(sCount, def.count!), current: sCount, target: def.count! };
    }
  }
}

/** 엔딩 시점 판정. 실패 엔딩은 자동 미달성. */
export function judgeLifeGoal(
  state: GameRunState,
  ending: Pick<Ending, 'category' | 'type'>,
  content: ContentIndex,
): Ending['goal'] {
  if (!state.lifeGoal) return null;
  const def = goalDef(content, state.lifeGoal.goalId);
  let achieved = false;
  if (ending.category === 'NORMAL') {
    switch (def.kind) {
      case 'NET_WORTH':
        achieved = state.cash - state.debt >= def.amount!;
        break;
      case 'DEBT_FREE':
        achieved = state.debt === 0 && state.cash >= def.amount!;
        break;
      case 'RANK': {
        const best = state.statistics.highestRank ?? state.employment.current?.rank ?? 'STAFF';
        achieved = rankIndex(best) >= rankIndex(def.rank!);
        break;
      }
      case 'FULL_TENURE':
        achieved = ending.type === 'RETIREMENT';
        break;
      case 'WELLBEING':
        achieved = state.resources.health >= def.stat! && state.resources.mental >= def.stat!;
        break;
      case 'ACE':
        achieved = state.annualReviews.filter((r) => r.grade === 'S').length >= def.count!;
        break;
    }
  }
  return { goalId: def.id, achieved, text: achieved ? def.achievedText : def.failedText };
}

/** 달 마무리에 호출: 새로 넘은 축하 구간이 있으면 기록하고 작은 보상(정신력)을 준다. */
export function updateLifeGoalMilestone(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; milestone: number | null } {
  const progress = lifeGoalProgress(state, content);
  if (!state.lifeGoal || !progress) return { state, milestone: null };
  const cfg = content.pack.rules.lifeGoal;
  const reached = cfg.milestones.filter(
    (m) => progress.percent >= m && !state.lifeGoal!.milestones.includes(m),
  );
  if (reached.length === 0) return { state, milestone: null };
  const top = Math.max(...reached);
  return {
    milestone: top,
    state: {
      ...state,
      lifeGoal: {
        ...state.lifeGoal,
        milestones: [...state.lifeGoal.milestones, ...reached].sort((a, b) => a - b),
      },
      resources: { ...state.resources, mental: clampStat(state.resources.mental + cfg.milestoneMental) },
    },
  };
}
