import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, type GameRunState } from '@company-life/shared';
import { computeAnnualReview } from './annual';
import { LEDGER_KEEP_MONTHS, reputationSources } from './ledger';
import { nextMonth, startMonth } from './month';
import { migrateRunState } from './migrate';
import { content, employedRun, finishEvents } from './test-fixtures';
import { toPublicView } from './view';

const NOW = '2026-11-17T00:00:00.000Z';

/** 한 달을 진행하고 그달 시작·끝 자원을 돌려준다 */
function month(s: GameRunState) {
  const before = { ...s.resources };
  const done = finishEvents(startMonth(s, content));
  const after = { ...done.resources };
  return {
    state: done.pendingEnding ? done : nextMonth(done, content, NOW),
    before,
    after,
    turn: s.turnIndex,
  };
}

describe('S14 자원 증감 장부', () => {
  it('달마다 장부 줄의 합 = 그달 자원 전체 변화', () => {
    let s = employedRun('ledger-1');
    for (let i = 0; i < 14 && !s.pendingEnding; i++) {
      const m = month(s);
      s = m.state;
      if (s.pendingEnding) break;
      const rows = s.resourceLedger.filter((e) => e.turnIndex === m.turn);
      expect(rows.length).toBeGreaterThan(0);
      for (const k of RESOURCE_KEYS) {
        const sum = rows.reduce((acc, e) => acc + (e.delta[k] ?? 0), 0);
        expect(sum, `${k} @${m.turn}`).toBe(m.after[k] - m.before[k]);
      }
      // 사건 줄은 그달 사건 수만큼 이하 (변화 없는 사건은 줄이 없다), 자연 변화는 최대 1줄
      expect(rows.filter((e) => e.source === 'MONTHLY').length).toBeLessThanOrEqual(1);
    }
  });

  it(`최근 ${LEDGER_KEEP_MONTHS}개월만 남긴다`, () => {
    let s = employedRun('ledger-2');
    for (let i = 0; i < LEDGER_KEEP_MONTHS + 6 && !s.pendingEnding; i++) s = month(s).state;
    const turns = new Set(s.resourceLedger.map((e) => e.turnIndex));
    expect(turns.size).toBeLessThanOrEqual(LEDGER_KEEP_MONTHS);
    expect(Math.min(...turns)).toBeGreaterThan(s.turnIndex - LEDGER_KEEP_MONTHS - 1);
  });

  it('옛 세이브는 빈 장부로 이어진다 (평가표 출처도 빈 배열)', () => {
    const s = employedRun('ledger-3');
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    delete raw.resourceLedger;
    const migrated = migrateRunState(raw);
    expect(migrated.resourceLedger).toEqual([]);
    expect(toPublicView(migrated, content).resourceTrail).toEqual({ entries: [], lastMonth: {} });
  });

  it('공개 내역은 최근 3개월, 최신순, 사건은 "제목 → 선택" 라벨', () => {
    let s = employedRun('ledger-4');
    for (let i = 0; i < 6 && !s.pendingEnding; i++) s = month(s).state;
    const trail = toPublicView(s, content).resourceTrail;
    const months = new Set(trail.entries.map((e) => `${e.age}-${e.month}`));
    expect(months.size).toBeLessThanOrEqual(3);
    expect(trail.entries.length).toBeGreaterThan(0);
    for (const e of trail.entries.filter((x) => x.kind === 'EVENT')) expect(e.label).toContain(' → ');
    expect(trail.entries.find((e) => e.kind === 'MONTHLY')?.label).toBe('매달 자연 변화');
    // lastMonth = 가장 최근 달 줄들의 합
    const last = s.resourceLedger.filter((e) => e.turnIndex === s.turnIndex - 1);
    for (const k of RESOURCE_KEYS) {
      const sum = last.reduce((acc, e) => acc + (e.delta[k] ?? 0), 0);
      expect(trail.lastMonth[k] ?? 0).toBe(sum);
    }
  });
});

describe('S14 평가표 평판 출처', () => {
  const s = employedRun('ledger-5');
  const year = Math.floor(s.turnIndex / 12) * 12;
  const ev = (turnIndex: number, eventId: string, choiceId: string, reputation: number) => ({
    turnIndex,
    source: 'EVENT' as const,
    eventId,
    choiceId,
    delta: { reputation },
  });
  const ledger = [
    ev(year, 'evt_office_dinner_crisis', 'leave_early', -3),
    ev(year + 2, 'evt_office_dinner_crisis', 'leave_early', -3),
    ev(year + 4, 'evt_office_dinner_crisis', 'leave_early', -3),
    ev(year + 1, 'evt_office_gossip', 'confront', -9),
    ev(year + 3, 'evt_life_flu', 'rest', -3),
    ev(year + 5, 'evt_meeting_marathon', 'skip_one', -7),
    ev(year + 6, 'evt_server_outage', 'routine_fix', 5),
    ev(year + 7, 'evt_office_dinner_crisis', 'mediate', 5),
    ev(year + 7, 'evt_office_dinner_crisis', 'mediate', 5),
    // 작년 기록은 세지 않는다
    ev(year - 1, 'evt_office_gossip', 'ignore', -40),
    {
      turnIndex: year + 8,
      source: 'MONTHLY' as const,
      eventId: null,
      choiceId: null,
      delta: { reputation: -30 },
    },
  ];
  const at = { ...s, turnIndex: year + 11, resourceLedger: ledger };

  it('깎인 곳 TOP 3(같은 선택은 묶음) → 오른 곳 TOP 1, 그해 사건만', () => {
    expect(reputationSources(at)).toEqual([
      { eventId: 'evt_office_dinner_crisis', choiceId: 'leave_early', delta: -9, count: 3 },
      { eventId: 'evt_office_gossip', choiceId: 'confront', delta: -9, count: 1 },
      { eventId: 'evt_meeting_marathon', choiceId: 'skip_one', delta: -7, count: 1 },
      { eventId: 'evt_office_dinner_crisis', choiceId: 'mediate', delta: 10, count: 2 },
    ]);
  });

  it('인사평가표에 실리고 공개 뷰는 라벨로 바꾼다', () => {
    const review = computeAnnualReview(at, content);
    expect(review.reputationSources).toHaveLength(4);
    const view = toPublicView(
      {
        ...at,
        phase: 'MONTH_SUMMARY',
        currentMonth: {
          turnIndex: at.turnIndex,
          start: { resources: at.resources, cash: at.cash, debt: at.debt },
          settlement: {
            grossSalary: 0,
            tax: 0,
            netSalary: 0,
            livingCost: 0,
            livingBreakdown: { housing: 0, food: 0, transport: 0, misc: 0 },
            interest: 0,
            debtRepayment: 0,
          },
          annualReview: review,
          salaryAdjustment: null,
          promotion: null,
          news: [],
          goalMilestone: null,
          eventResults: [],
        },
      },
      content,
    );
    const src = view.monthSummary!.annualReview!.reputationSources;
    expect(src[0]).toMatchObject({ delta: -9, count: 3 });
    expect(src[0]!.label).toMatch(/ → /);
  });
});
