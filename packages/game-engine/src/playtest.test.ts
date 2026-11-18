import { describe, expect, it } from 'vitest';
import { GameRunStateSchema } from '@company-life/shared';
import { EngineError } from './errors';
import { chooseInMonth, startMonth } from './month';
import { applyPlaytestPatch, playtestDebugView, playtestStartMonthWithEvent } from './playtest';
import { content, employedRun } from './test-fixtures';

const base = employedRun();

describe('playtest tools (dev only)', () => {
  it('patch changes only requested fields, keeps the month, and marks the run modified', () => {
    const month = { ...base, turnIndex: 5 };
    const s = applyPlaytestPatch(
      month,
      { resources: { health: 3 }, age: 49, skills: { crisis: 2 } },
      content,
    );
    expect(s.resources).toEqual({ ...base.resources, health: 3 });
    expect(s.turnIndex).toBe((49 - 24) * 12 + 5);
    expect(s.skills).toEqual({ crisis: 2 });
    expect(s.playtestModified).toBe(true);
    expect(s.eventHistory.at(-1)?.kind).toBe('PLAYTEST_OVERRIDE');
    expect(GameRunStateSchema.safeParse(s).success).toBe(true);
  });

  it('rejects patches outside MONTH_START, wrong polarity traits, and ages outside the career', () => {
    const pending = startMonth(base, content);
    expect(() => applyPlaytestPatch(pending, { resources: { health: 1 } }, content)).toThrow(EngineError);
    expect(() => applyPlaytestPatch(base, { skills: { burnout: 1 } }, content)).toThrow(/NEGATIVE/);
    expect(() => applyPlaytestPatch(base, { age: 60 }, content)).toThrow(EngineError);
  });

  it('force-event opens the chosen event (binding an eligible NPC) after normal settlement', () => {
    const s = playtestStartMonthWithEvent(base, 'evt_peer_help_request', content);
    expect(s.phase).toBe('EVENT_PENDING');
    expect(s.activeEvent?.eventId).toBe('evt_peer_help_request');
    expect(s.npcs.find((n) => n.npcId === s.activeEvent?.participantNpcId)?.role).toBe('PEER');
    expect(s.currentMonth?.settlement.netSalary).toBeGreaterThan(0);
    expect(s.playtestModified).toBe(true);
    // 강제 사건도 정상 판정 흐름을 탄다
    expect(chooseInMonth(s, 'refuse', content).state.phase).toBe('MONTH_SUMMARY');
  });

  it('force-event refuses NPC events when no team member matches, and leaves state untouched', () => {
    const mentorBoss = {
      ...base,
      npcs: base.npcs.map((n) => (n.role === 'BOSS' ? { ...n, personalityTags: ['MENTOR'] } : n)),
    };
    expect(() => playtestStartMonthWithEvent(mentorBoss, 'evt_public_blame', content)).toThrow(
      /NPC가 없습니다/,
    );
    expect(mentorBoss.phase).toBe('MONTH_START');
    expect(() => playtestStartMonthWithEvent(base, 'evt_unknown_x', content)).toThrow(EngineError);
  });

  it.each([
    ['과로 실직', { resources: { health: 1 } }, 'evt_server_outage', 'first_response', 'OVERWORK_DISMISSAL'],
    ['번아웃 실직', { resources: { mental: 1 } }, 'evt_public_blame', 'accept', 'BURNOUT_DISMISSAL'],
    ['대형 사고', { resources: { focus: 1 } }, 'evt_restructuring_rumor', 'prepare', 'FATAL_MISTAKE'],
    ['사내 퇴출', { resources: { reputation: 1 } }, 'evt_office_dinner_crisis', 'leave_early', 'OUSTED'],
    [
      '조기 은퇴',
      { resources: { health: 1 }, age: 50 },
      'evt_server_outage',
      'first_response',
      'EARLY_RETIREMENT',
    ],
  ] as const)('docs/PLAYTEST.md 경로: %s', (_name, patch, eventId, choiceId, expected) => {
    const badBoss = {
      ...base,
      npcs: base.npcs.map((n) => (n.role === 'BOSS' ? { ...n, personalityTags: ['AUTHORITARIAN'] } : n)),
    };
    const s = playtestStartMonthWithEvent(applyPlaytestPatch(badBoss, patch, content), eventId, content);
    expect(chooseInMonth(s, choiceId, content).state.pendingEnding?.type).toBe(expected);
  });

  it('docs/PLAYTEST.md 경로: 부채 한계 직전 → 월 정산 이자로 빚더미 퇴장', () => {
    const limit = playtestDebugView(base, content).debtLimit!;
    const s = playtestStartMonthWithEvent(
      applyPlaytestPatch(base, { debt: limit - 100_000 }, content),
      'evt_quiet_month',
      content,
    );
    expect(chooseInMonth(s, 'rest', content).state.pendingEnding?.type).toBe('DEBT_SPIRAL');
  });

  it('debug view exposes exact chances and eligible-event odds summing to ~100%', () => {
    const dbg = playtestDebugView(base, content);
    const total = dbg.eligibleEvents.reduce((s, e) => s + e.chancePercent, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
    const opened = playtestStartMonthWithEvent(base, 'evt_office_dinner_crisis', content);
    const mediate = playtestDebugView(opened, content).activeEventChoices.find((c) => c.id === 'mediate')!;
    // 보통 난이도 보정이 합계에 더해지고, 디버그에는 그 줄도 보인다
    const shift = Math.round(content.pack.rules.difficulty.NORMAL.chanceShift * 100);
    expect(mediate.exactChancePercent).toBe(40 + shift);
    expect(mediate.breakdown).toEqual(['기본 +40%p', `난이도 보통 ${shift > 0 ? '+' : ''}${shift}%p`]);
  });
});
