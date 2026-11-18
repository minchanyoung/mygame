import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, JOB_IDS, type GameRunState } from '@company-life/shared';
import { migrateRunState } from './migrate';
import { autoPlay } from './simulation';
import { content, employedRun } from './test-fixtures';
import { matchesTitleRule } from './titles';

const base = employedRun();
const normalAt60 = {
  category: 'NORMAL' as const,
  type: 'RETIREMENT' as const,
  cause: 'RETIREMENT' as const,
  age: 60,
};
const title = (id: string) => content.pack.titles.find((t) => t.id === id)!;

function picked(eventId: string, choiceId: string, n: number): GameRunState['eventOccurrences'] {
  return Array.from({ length: n }, (_, i) => ({
    occurrenceId: `${eventId}-${i}`,
    eventId,
    eventVersion: 1,
    turnIndex: 10 + i * 7,
    choiceId,
    participantNpcId: null,
    success: null,
    chance: null,
    roll: null,
    highRisk: false,
  }));
}

describe('S13 퇴근 후 행동 제거', () => {
  it('행동 기록이 있던 S11 세이브도 기록을 버리고 불러온다', () => {
    const old = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & {
      currentMonth: Record<string, unknown> | null;
    };
    old.actionLog = [{ turnIndex: 0, actionId: 'study' }];
    if (old.currentMonth) old.currentMonth.action = { actionId: 'study' };
    const m = migrateRunState(old) as unknown as Record<string, unknown>;
    expect(m.actionLog).toBeUndefined();
    expect(GameRunStateSchema.safeParse(m).success).toBe(true);
  });

  it('별명 4종은 퇴근 후 일상 사건 선택 횟수로 받는다 (여러 사건 합산)', () => {
    const rule = title('title_iron_body').rule;
    const need = rule.choiceCount!.min;
    const some = picked('evt_life_running_crew', 'join', need - 1);
    expect(matchesTitleRule({ ...base, eventOccurrences: some }, normalAt60, rule, content)).toBe(false);
    const more = [...some, ...picked('evt_life_gym', 'register', 1)];
    expect(matchesTitleRule({ ...base, eventOccurrences: more }, normalAt60, rule, content)).toBe(true);
    // 다른 선택지는 세지 않는다
    const other = [...some, ...picked('evt_life_gym', 'later', 3)];
    expect(matchesTitleRule({ ...base, eventOccurrences: other }, normalAt60, rule, content)).toBe(false);
  });
});

describe('S13 직무 간 난이도', () => {
  it('신중 봇 직무별 50세 전 실패율이 서로 크게 벌어지지 않는다 (시드 고정, 느슨한 회귀 방지)', () => {
    const runs = 300;
    const byJob = new Map<string, { n: number; fail: number }>();
    for (let i = 0; i < runs; i++) {
      const r = autoPlay(`jobgap-${i}`, 'cautious', content);
      const row = byJob.get(r.jobId!) ?? { n: 0, fail: 0 };
      row.n++;
      if (r.category === 'FAILURE') row.fail++;
      byJob.set(r.jobId!, row);
    }
    const rates = JOB_IDS.map((j) => {
      const row = byJob.get(j)!;
      return row.fail / row.n;
    });
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThanOrEqual(0.2);
  }, 120_000);
});
