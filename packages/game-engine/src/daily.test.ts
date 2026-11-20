import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { dailyDate, dailyScore, dailySeed } from './daily';
import { content, employedRun } from './test-fixtures';
import { toPublicView } from './view';

describe('S21 오늘의 출근', () => {
  it('날짜는 한국 시간 기준', () => {
    expect(dailyDate(new Date('2026-11-20T14:59:00.000Z'))).toBe('2026-11-20');
    expect(dailyDate(new Date('2026-11-20T15:00:00.000Z'))).toBe('2026-11-21');
    expect(dailySeed('2026-11-21')).toBe('daily-2026-11-21');
  });

  it('점수는 엔딩 뒤에만, 항목 합계', () => {
    const base = employedRun();
    expect(dailyScore(base, content)).toBeNull();
    const ended: GameRunState = {
      ...base,
      turnIndex: 36 * 12,
      cash: 500_000_000,
      debt: 0,
      daily: '2026-11-21',
      statistics: { ...base.statistics, highestRank: 'DEPARTMENT_HEAD' },
      ending: {
        ...(base.ending ?? ({} as NonNullable<GameRunState['ending']>)),
        type: 'RETIREMENT',
        category: 'NORMAL',
        title: '정년 퇴직',
        age: 60,
        goal: null,
      } as NonNullable<GameRunState['ending']>,
    };
    const score = dailyScore(ended, content)!;
    // 36년 × 10 + 부장 4 × 80 + 순자산 50 + 정상 엔딩 200
    expect(score.total).toBe(360 + 320 + 50 + 200);
    expect(score.parts.map((p) => p.label)).toContain('정상 엔딩');
    expect(toPublicView(employedRun(), content).daily).toBeNull();
  });
});
