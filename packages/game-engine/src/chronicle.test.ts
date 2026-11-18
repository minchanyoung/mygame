import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { buildChronicle, ERA_ITEM_LIMIT, withYearlyRecord } from './chronicle';
import { buildEnding } from './ending';
import { migrateRunState } from './migrate';
import { autoPlay } from './simulation';
import { content, employedRun } from './test-fixtures';
import { judgeTitles, matchesTitleRule, TITLE_SUB_COUNT } from './titles';
import { toPublicView } from './view';

const base = employedRun();
const atAge = (s: GameRunState, age: number): GameRunState => ({
  ...s,
  turnIndex: (age - content.pack.rules.startAge) * 12,
});
const title = (id: string) => content.pack.titles.find((t) => t.id === id)!;
const normalAt = (age: number) => ({
  category: 'NORMAL' as const,
  type: 'RETIREMENT' as const,
  cause: 'RETIREMENT' as const,
  age,
});

function finishedRun(seed: string, policy: 'cautious' | 'random' = 'cautious'): GameRunState {
  let final: GameRunState | null = null;
  autoPlay(seed, policy, content, (s) => (final = s));
  return final!;
}

describe('S9 연간 기록', () => {
  it('끝까지 간 판은 매년 12월 기록 + 엔딩 기록이 쌓이고 나이순이다', () => {
    const s = finishedRun('chron-1');
    expect(s.phase).toBe('GAME_OVER');
    const ages = s.yearlyRecords.map((r) => r.age);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
    expect(new Set(s.yearlyRecords.map((r) => r.yearIndex)).size).toBe(s.yearlyRecords.length);
    // 엔딩 시점 기록이 마지막 줄
    expect(s.yearlyRecords.at(-1)!.age).toBe(s.ending!.age);
    // 인사평가를 받은 해는 등급이 남는다
    for (const r of s.annualReviews) {
      expect(s.yearlyRecords.find((y) => y.yearIndex === r.yearIndex)?.reviewGrade).toBe(r.grade);
    }
  });

  it('같은 해에 다시 기록하면 덮어쓰되 평가 등급은 유지한다', () => {
    const once = withYearlyRecord(atAge(base, 30), content, 'S');
    const twice = withYearlyRecord({ ...once, cash: once.cash + 1_000_000 }, content, null);
    expect(twice.yearlyRecords).toHaveLength(1);
    expect(twice.yearlyRecords[0]).toMatchObject({
      reviewGrade: 'S',
      netWorth: once.yearlyRecords[0]!.netWorth + 1_000_000,
    });
  });
});

describe('S9 인생 연대기', () => {
  it('시대별 최대 4개, 시대 안에서는 오래된 순, 연봉 그래프는 재직한 해에 연봉이 있다', () => {
    for (const seed of ['chron-2', 'chron-3', 'chron-4']) {
      const s = finishedRun(seed, 'random');
      const c = buildChronicle(s, content);
      expect(c.eras.length).toBeGreaterThan(0);
      for (const era of c.eras) {
        expect(era.items.length).toBeLessThanOrEqual(ERA_ITEM_LIMIT);
        const order = era.items.map((i) => i.age * 12 + i.month);
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }
      // 엔딩은 항상 연대기에 들어간다
      expect(c.eras.flatMap((e) => e.items).some((i) => i.kind === 'ENDING')).toBe(true);
      for (const y of c.yearly) if (y.companyName) expect(y.salary).toBeGreaterThan(0);
      expect(c.bonds.length).toBeLessThanOrEqual(2);
    }
  });

  it('공개 뷰: 별명·연대기는 확정된 엔딩에만 있고 NPC 수치는 드러나지 않는다', () => {
    const s = finishedRun('chron-5');
    const view = toPublicView(s, content);
    expect(view.ending!.titles!.main.id).toMatch(/^title_/);
    expect(view.ending!.titles!.subs.length).toBeLessThanOrEqual(TITLE_SUB_COUNT);
    expect(view.ending!.chronicle).not.toBeNull();
    const json = JSON.stringify(view.ending!.chronicle);
    for (const key of ['favor', 'trust', 'rivalry', 'competence']) expect(json).not.toContain(key);
  });
});

describe('S9 별명', () => {
  it('임원 엔딩은 언제나 대표 별명이 ⭐ 별을 단 사람', () => {
    const exec = { ...base, employment: { ...base.employment, promotedToExecutive: true } };
    const e = buildEnding(atAge(exec, 55), 'EXECUTIVE_PROMOTION', null, content);
    expect(e.titles![0]).toBe('title_star');
  });

  it('아무 조건도 없으면 기본 별명 하나, 다른 별명이 있으면 기본 별명은 빠진다', () => {
    const plain: GameRunState = {
      ...atAge(base, 45),
      statistics: { ...base.statistics, lowestWellbeing: 20, transfers: 1 },
    };
    expect(
      judgeTitles(plain, { category: 'NORMAL', type: 'EARLY_RETIREMENT', cause: 'LAYOFF', age: 52 }, content),
    ).toEqual(['title_default']);
    const healthy = { ...plain, statistics: { ...plain.statistics, lowestWellbeing: 80 } };
    const ids = judgeTitles(healthy, normalAt(60), content);
    expect(ids).toContain('title_work_life');
    expect(ids).not.toContain('title_default');
  });

  it('원클럽맨은 이직 없이 정년일 때만', () => {
    const rule = title('title_one_club').rule;
    const s = { ...base, statistics: { ...base.statistics, transfers: 0 } };
    expect(matchesTitleRule(s, normalAt(60), rule, content)).toBe(true);
    expect(
      matchesTitleRule({ ...s, statistics: { ...s.statistics, transfers: 1 } }, normalAt(60), rule, content),
    ).toBe(false);
    expect(
      matchesTitleRule(
        s,
        { category: 'NORMAL', type: 'EARLY_RETIREMENT', cause: 'LAYOFF', age: 55 },
        rule,
        content,
      ),
    ).toBe(false);
  });

  it('오뚝이: D 다음에 S를 받아야 한다 (순서가 중요)', () => {
    const rule = title('title_comeback').rule;
    const reviews = (grades: Array<'S' | 'A' | 'B' | 'C' | 'D'>) => ({
      ...base,
      annualReviews: grades.map((grade, i) => ({
        yearIndex: i,
        turnIndex: i * 12 + 11,
        companyId: base.employment.current!.companyId,
        grade,
        score: 50,
        bonus: 0,
      })),
    });
    expect(matchesTitleRule(reviews(['B', 'D', 'C', 'S']), normalAt(60), rule, content)).toBe(true);
    expect(matchesTitleRule(reviews(['S', 'D', 'A']), normalAt(60), rule, content)).toBe(false);
  });

  it('순자산 기준은 물가를 반영한다 (같은 금액이라도 늦게 은퇴하면 더 필요)', () => {
    const rule = title('title_rich').rule;
    const rich = { ...base, cash: 900_000_000, debt: 0 };
    expect(matchesTitleRule(rich, normalAt(24), rule, content)).toBe(true);
    expect(matchesTitleRule(atAge(rich, 60), normalAt(60), rule, content)).toBe(false);
  });

  it('선택 기록 별명: 라이벌 연재에서 손잡은 사람은 환상의 콤비', () => {
    const s: GameRunState = {
      ...base,
      eventOccurrences: [
        {
          occurrenceId: 'o1',
          eventId: 'evt_arc_rival_4',
          eventVersion: 1,
          turnIndex: 100,
          choiceId: 'toast_together',
          participantNpcId: null,
          success: null,
          chance: null,
          roll: null,
          highRisk: false,
        },
      ],
    };
    expect(matchesTitleRule(s, normalAt(60), title('title_duo').rule, content)).toBe(true);
    expect(matchesTitleRule(s, normalAt(60), title('title_rival').rule, content)).toBe(false);
  });
});

describe('S9 세이브 호환', () => {
  it('연간 기록·새 통계·엔딩 별명이 없던 세이브도 불러온다', () => {
    const old = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & {
      statistics: Record<string, unknown>;
    };
    delete old.yearlyRecords;
    delete old.statistics.nearCollapseMonths;
    delete old.statistics.maxHighRiskStreak;
    delete old.statistics.peakDebtPermille;
    const m = migrateRunState(old);
    expect(m.yearlyRecords).toEqual([]);
    expect(m.statistics).toMatchObject({ nearCollapseMonths: 0, peakDebtPermille: 0 });
  });
});
