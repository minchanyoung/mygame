import { describe, expect, it } from 'vitest';
import type { GameRunState, PlayerRank } from '@company-life/shared';
import { getEligibleEvents, resolveChoice } from './events';
import { content, employedRun, open } from './test-fixtures';
import { toPublicActiveEvent } from './view';
import { startMonth } from './month';

function asRank(rank: PlayerRank, turnIndex = 300): GameRunState {
  const base = employedRun();
  const cur = base.employment.current!;
  return {
    ...base,
    turnIndex,
    scheduledEvents: [],
    employment: { ...base.employment, current: { ...cur, rank, startedTurn: 0 } },
  };
}

const HEAD_IDS = content.pack.events.filter((e) => e.tags?.includes('head')).map((e) => e.id);
const eligible = (s: GameRunState) => new Set(getEligibleEvents(s, content, 'work').map((c) => c.event.id));

describe('S17 차장·부장 전용 사건', () => {
  it('사건 6개 + 돌아오는 사건 3개', () => {
    expect(HEAD_IDS).toHaveLength(9);
    expect(content.pack.events.filter((e) => e.tags?.includes('head') && e.scheduledOnly)).toHaveLength(3);
  });

  it('과장 이하에게는 나오지 않고, 부장 전용 사건은 차장에게도 나오지 않는다', () => {
    const manager = eligible(asRank('MANAGER'));
    for (const id of HEAD_IDS) expect(manager.has(id)).toBe(false);
    const deputy = eligible(asRank('DEPUTY_HEAD'));
    expect(deputy.has('evt_head_take_blame')).toBe(true);
    expect(deputy.has('evt_head_successor')).toBe(false);
    const head = eligible(asRank('DEPARTMENT_HEAD'));
    expect(head.has('evt_head_successor')).toBe(true);
    expect(head.has('evt_head_inflated')).toBe(true);
  });

  it('책임을 지면 12개월 뒤 그 팀원이 돌아온다', () => {
    const s0 = open(asRank('DEPARTMENT_HEAD'), 'evt_head_take_blame');
    const s1 = resolveChoice(s0, 'shield', content).state;
    const due = startMonth({ ...s1, phase: 'MONTH_START', turnIndex: 312 }, content);
    expect(due.activeEvent?.eventId).toBe('evt_head_echo_loyal');
    expect(toPublicActiveEvent(due, content)!.echo?.choiceLabel).toBe('관리 책임은 내게 있다고 한다');
  });

  it('덮은 실적과 실무자 탓은 대가를 예약한다', () => {
    const a = resolveChoice(open(asRank('DEPARTMENT_HEAD'), 'evt_head_inflated'), 'let_it_go', content).state;
    expect(a.scheduledEvents.map((x) => x.eventId)).toContain('evt_head_echo_cover');
    const b = resolveChoice(open(asRank('DEPUTY_HEAD'), 'evt_head_take_blame'), 'scapegoat', content).state;
    expect(b.scheduledEvents.map((x) => x.eventId)).toContain('evt_head_echo_blame');
  });
});
