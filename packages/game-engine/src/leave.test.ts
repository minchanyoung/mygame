import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { processAnnualReview } from './annual';
import { resolveChoice } from './events';
import { applyMonthlySettlement, startMonth } from './month';
import { content, employedRun, open } from './test-fixtures';
import { toPublicView } from './view';

function at(turnIndex: number, patch: Partial<GameRunState> = {}): GameRunState {
  const base = employedRun();
  const cur = base.employment.current!;
  return {
    ...base,
    turnIndex,
    scheduledEvents: [],
    employment: { ...base.employment, current: { ...cur, startedTurn: 0, rankSinceTurn: 0 } },
    ...patch,
  };
}

const takeLeave = (s: GameRunState, choice = 'three') =>
  resolveChoice(open(s, 'evt_leave_burnout'), choice, content).state;

describe('C4 휴직', () => {
  it('정신력이 낮을 때만 제안되고, 고르면 다음 달부터 휴직 + 복직 예약 + 근속 정지', () => {
    const low = at(20, { resources: { ...at(20).resources, mental: 30 } });
    const s = takeLeave(low);
    expect(s.leave).toEqual({ startTurn: 21, untilTurn: 24, payPermille: 0 });
    expect(s.employment.current!.rankSinceTurn).toBe(3);
    expect(s.scheduledEvents.find((x) => x.eventId === 'evt_leave_return')?.dueTurn).toBe(24);
  });

  it('휴직 중: 무급 월급 0, 추가 회복, 업무 칸은 휴직 사건, 연말 평가 없음', () => {
    const s = { ...takeLeave(at(20)), turnIndex: 21, phase: 'MONTH_START' as const };
    const settled = applyMonthlySettlement({ ...s, resources: { ...s.resources, mental: 30 } }, content);
    expect(settled.settlement.grossSalary).toBe(0);
    expect(settled.state.resources.mental).toBeGreaterThan(30 + 6);
    const month = startMonth(s, content);
    expect(month.activeEvent?.eventId).toBe('evt_leave_month');
    expect(toPublicView(month, content).leave).toEqual({ monthsLeft: 3, payPercent: 0 });
    const dec = { ...takeLeave(at(20)), turnIndex: 23 }; // 24세 12월 = 턴 11, 25세 12월 = 턴 23
    expect(processAnnualReview(dec, content).review).toBeNull();
  });

  it('휴직이 끝나면 복직 사건이 업무 칸에 열린다', () => {
    const s = { ...takeLeave(at(20)), turnIndex: 24, phase: 'MONTH_START' as const };
    const month = startMonth(s, content);
    expect(month.activeEvent?.eventId).toBe('evt_leave_return');
    expect(toPublicView(month, content).leave).toBeNull();
  });
});
