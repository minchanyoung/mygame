import {
  turnInfo,
  type Ending,
  type GameRunState,
  type PlayerRank,
  type TitleRule,
} from '@company-life/shared';
import { inRange } from './conditions';
import type { ContentIndex } from './content-index';
import { priceIndex } from './economy';
import { rankIndex } from './promotion';

/** 별명 판정용 관계 기준 (공개하지 않는다) */
const RELATION_HIGH = 70;
/** 대표 1 + 보조 최대 2 (S9 Q1) */
export const TITLE_SUB_COUNT = 2;

type EndingPart = Pick<Ending, 'category' | 'type' | 'cause' | 'age'>;

function promotions(state: GameRunState, content: ContentIndex) {
  return state.eventHistory
    .filter((h) => h.kind === 'PROMOTION')
    .map((h) => ({
      age: turnInfo(h.turnIndex, content.pack.rules.startAge).age,
      to: h.data?.['to'] as PlayerRank | undefined,
    }));
}

/** 규칙 하나를 판정한다. 모든 항목이 맞아야 true (빈 규칙은 항상 true). */
export function matchesTitleRule(
  state: GameRunState,
  ending: EndingPart,
  rule: TitleRule,
  content: ContentIndex,
): boolean {
  const s = state.statistics;
  if (rule.category && ending.category !== rule.category) return false;
  if (rule.endingTypes && !rule.endingTypes.includes(ending.type)) return false;
  if (rule.endingCauses && !rule.endingCauses.includes(ending.cause)) return false;
  if (rule.endAge && !inRange(ending.age, rule.endAge)) return false;
  if (rule.transfers && !inRange(s.transfers, rule.transfers)) return false;
  if (rule.highestRanks && (!s.highestRank || !rule.highestRanks.includes(s.highestRank))) return false;
  if (rule.rankYears) {
    const years = state.yearlyRecords.filter((r) => r.rank === rule.rankYears!.rank).length;
    if (years < rule.rankYears.min) return false;
  }
  if (rule.rankBeforeAge) {
    const { rank, age } = rule.rankBeforeAge;
    const ok = promotions(state, content).some(
      (p) => p.to !== undefined && rankIndex(p.to) >= rankIndex(rank) && p.age < age,
    );
    if (!ok) return false;
  }
  if (rule.promotedFromAge !== undefined) {
    if (!promotions(state, content).some((p) => p.age >= rule.promotedFromAge!)) return false;
  }
  const grades = state.annualReviews.map((r) => r.grade);
  if (rule.reviewCount) {
    const n = grades.filter((g) => rule.reviewCount!.grades.includes(g)).length;
    if (n < rule.reviewCount.min) return false;
  }
  if (rule.reviewsWithin) {
    const { grades: within, minCount } = rule.reviewsWithin;
    if (grades.length < minCount || grades.some((g) => !within.includes(g))) return false;
  }
  if (rule.comeback) {
    const fromAt = grades.findIndex((g) => rule.comeback!.from.includes(g));
    if (fromAt < 0 || !grades.slice(fromAt + 1).some((g) => rule.comeback!.to.includes(g))) return false;
  }
  if (rule.netWorth) {
    // 첫해 물가 기준 금액을 은퇴 시점 물가로 환산해 비교
    const index = priceIndex(state, content);
    const net = state.cash - state.debt;
    if (rule.netWorth.min !== undefined && net < rule.netWorth.min * index) return false;
    if (rule.netWorth.max !== undefined && net > rule.netWorth.max * index) return false;
  }
  if (rule.lowestWellbeing && !inRange(s.lowestWellbeing, rule.lowestWellbeing)) return false;
  if (rule.nearCollapseMonths && !inRange(s.nearCollapseMonths, rule.nearCollapseMonths)) return false;
  if (rule.maxHighRiskStreak && !inRange(s.maxHighRiskStreak, rule.maxHighRiskStreak)) return false;
  if (rule.peakDebtPermille && !inRange(s.peakDebtPermille, rule.peakDebtPermille)) return false;
  if (rule.debtAtEnd && !inRange(state.debt, rule.debtAtEnd)) return false;
  if (rule.choicesAny) {
    const made = rule.choicesAny.some((pick) =>
      state.eventOccurrences.some((o) => o.eventId === pick.eventId && o.choiceId === pick.choiceId),
    );
    if (!made) return false;
  }
  if (rule.friends) {
    const n = state.npcs.filter((n) => n.favor >= RELATION_HIGH).length;
    if (!inRange(n, rule.friends)) return false;
  }
  if (rule.choiceCount) {
    const { picks, min } = rule.choiceCount;
    const n = state.eventOccurrences.filter((o) =>
      picks.some((p) => p.eventId === o.eventId && p.choiceId === o.choiceId),
    ).length;
    if (n < min) return false;
  }
  if (rule.trustedBosses) {
    const n = state.npcs.filter((n) => n.role === 'BOSS' && n.trust >= RELATION_HIGH).length;
    if (!inRange(n, rule.trustedBosses)) return false;
  }
  return true;
}

/**
 * S9 별명 판정: 맞는 별명을 우선순위 높은 순으로 [대표, 보조…] 최대 1 + TITLE_SUB_COUNT개.
 * 기본 별명(빈 규칙)은 다른 별명이 하나도 없을 때만 붙는다.
 */
export function judgeTitles(state: GameRunState, ending: EndingPart, content: ContentIndex): string[] {
  const isDefault = (rule: TitleRule) => Object.keys(rule).length === 0;
  const matched = content.pack.titles
    .filter((t) => matchesTitleRule(state, ending, t.rule, content))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const real = matched.filter((t) => !isDefault(t.rule));
  return (real.length > 0 ? real : matched).slice(0, 1 + TITLE_SUB_COUNT).map((t) => t.id);
}
