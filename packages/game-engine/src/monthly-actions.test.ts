import { describe, expect, it } from 'vitest';
import type { GameRunState, MonthlyAction } from '@company-life/shared';
import { computeAnnualReview } from './annual';
import { EngineError } from './errors';
import { getEligibleEvents } from './events';
import { migrateRunState } from './migrate';
import { applyMonthlySettlement, startMonth } from './month';
import {
  actionAffinity,
  applyMonthlyAction,
  defaultActionId,
  yearActionPerformance,
} from './monthly-actions';
import { matchesTitleRule } from './titles';
import { toPublicView } from './view';
import { content, employedRun, finishEvents } from './test-fixtures';
import { nextMonth } from './month';

const NOW = '2026-11-17T00:00:00.000Z';
const base = employedRun();

/** 같은 행동으로 n달 진행 (사건은 무난한 선택) */
function playMonths(state: GameRunState, n: number, actionId: MonthlyAction): GameRunState {
  let s = state;
  for (let i = 0; i < n && s.phase === 'MONTH_START'; i++) {
    s = finishEvents(startMonth({ ...s, cash: Math.max(s.cash, 10_000_000) }, content, { actionId }));
    if (s.pendingEnding) break;
    s = nextMonth(s, content, NOW);
  }
  return s;
}

/** 정산 뒤 행동만 적용 (사건 영향 없이 행동 효과만 본다) */
function actOnly(state: GameRunState, actionId: MonthlyAction) {
  const settled = applyMonthlySettlement(state, content).state;
  return { settled, ...applyMonthlyAction(settled, actionId, content) };
}

describe('S11 월간 행동', () => {
  it('고른 행동은 기록되고 결산에 결과가 남는다', () => {
    const s = startMonth(base, content, { actionId: 'study' });
    expect(s.actionLog).toEqual([{ turnIndex: base.turnIndex, actionId: 'study' }]);
    expect(s.currentMonth?.action).toMatchObject({ actionId: 'study', streak: 1 });
    expect(s.currentMonth!.action!.cashDelta).toBeLessThan(0);
  });

  it('효과는 확정 수치: 휴식은 체력·정신력 +3, 자기계발은 집중력 +2·정신력 −1·현금 −30만', () => {
    const low = { ...base, resources: { health: 50, mental: 50, focus: 50, reputation: 50 } };
    const rest = actOnly(low, 'rest');
    expect(rest.result.resourceDelta).toMatchObject({ health: 3, mental: 3, focus: 0 });
    const study = actOnly(low, 'study');
    expect(study.result.resourceDelta).toMatchObject({ focus: 2, mental: -1 });
    expect(study.state.cash).toBe(study.settled.cash - 300_000);
  });

  it('비용을 낼 현금이 없으면 잠기고, 판단은 월 시작(정산 전) 현금으로 한다', () => {
    const broke = { ...base, cash: 50_000 };
    expect(() => startMonth(broke, content, { actionId: 'study' })).toThrow(EngineError);
    const view = toPublicView(broke, content);
    const study = view.monthlyActions!.options.find((o) => o.id === 'study')!;
    expect(study.locked).not.toBeNull();
    expect(view.monthlyActions!.options.find((o) => o.id === 'rest')!.locked).toBeNull();
    // 정산 전에 낼 수 있었으면, 정산 뒤 모자란 부분은 다른 지출처럼 빚이 된다
    const tight = { ...base, cash: 300_000 };
    expect(() => startMonth(tight, content, { actionId: 'study' })).not.toThrow();
  });

  it('행동을 고르지 않으면 지난달 행동 (처음엔 휴식)', () => {
    expect(defaultActionId(base, content)).toBe('rest');
    const s = playMonths(base, 1, 'exercise');
    expect(defaultActionId(s, content)).toBe('exercise');
    expect(startMonth(s, content).actionLog.at(-1)?.actionId).toBe('exercise');
  });

  it('자기계발 6개월 누적 → 관찰력을 얻을 기회(사건)가 그달에 열린다', () => {
    let s = base;
    for (let i = 0; i < 5; i++)
      s = { ...applyMonthlyAction(s, 'study', content).state, turnIndex: s.turnIndex + 1 };
    const sixth = startMonth({ ...s, cash: 10_000_000 }, content, { actionId: 'study' });
    expect(sixth.currentMonth!.action!.notes.join()).toContain('쓸모');
    const opened = [sixth.activeEvent?.eventId, ...sixth.pendingEvents.map((p) => p.eventId)];
    expect(opened).toContain('evt_document_clue');
    // 특성은 바로 주지 않는다 (사건에서 성공해야)
    expect(sixth.skills['observation'] ?? 0).toBe(0);
    // 이미 관찰력이 있으면 기회 사건을 다시 예약하지 않는다
    const has = { ...s, skills: { ...s.skills, observation: 1 as const } };
    const r = applyMonthlyAction(has, 'study', content);
    expect(r.state.scheduledEvents.filter((e) => e.eventId === 'evt_document_clue')).toHaveLength(0);
  });

  it('야근 연속: 3개월째부터 피로 누적, 6개월째 번아웃', () => {
    let s = base;
    const notes: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const r = actOnly(
        { ...s, resources: { health: 90, mental: 90, focus: 60, reputation: 50 } },
        'overtime',
      );
      notes.push(r.result.notes);
      s = { ...r.state, turnIndex: r.state.turnIndex + 1 };
      if (i === 5)
        expect(r.result.traitChanges).toEqual([{ kind: 'NEGATIVE_TRAIT', id: 'burnout', from: 0, to: 1 }]);
    }
    expect(notes[1]).toEqual([]);
    expect(notes[2]!.join()).toContain('피로');
    expect(s.negativeTraits['burnout']).toBe(1);
  });

  it('자기계발·야근은 그해 평가 성과에 더해지되 상한이 있다', () => {
    let s = base;
    for (let i = 0; i < 6; i++) {
      s = { ...applyMonthlyAction(s, 'overtime', content).state, turnIndex: s.turnIndex + 1 };
    }
    const year = Math.floor(base.turnIndex / 12);
    expect(yearActionPerformance(s, content, year)).toBe(content.pack.monthlyActions.performanceCap);
    const plain = computeAnnualReview(base, content).items.find((i) => i.key === 'performance')!;
    const boosted = computeAnnualReview({ ...s, turnIndex: base.turnIndex }, content).items.find(
      (i) => i.key === 'performance',
    )!;
    expect(boosted.score).toBe(Math.min(100, plain.score + content.pack.monthlyActions.performanceCap));
    expect(boosted.note).toContain('퇴근 후 노력');
  });

  it('부업: 같은 시드면 같은 수입, 수입은 세전 월급의 5~15%', () => {
    const a = actOnly(base, 'sidejob');
    const b = actOnly(base, 'sidejob');
    expect(a.result).toEqual(b.result);
    const gross = Math.floor(base.employment.current!.annualSalary / 12);
    if (a.result.notes.length === 0) {
      expect(a.result.cashDelta).toBeGreaterThanOrEqual(Math.floor(gross * 0.05) - 10_000);
      expect(a.result.cashDelta).toBeLessThanOrEqual(Math.ceil(gross * 0.15) + 10_000);
    }
  });

  it('인맥: 팀 동료 한 명의 호감이 오르고 사교 사건이 조금 더 자주 뜬다', () => {
    const r = actOnly(base, 'network');
    const changed = r.state.npcs.filter((n) => n.favor !== base.npcs.find((x) => x.npcId === n.npcId)!.favor);
    expect(changed).toHaveLength(1);
    const affinity = actionAffinity(r.state, content);
    const social = content.pack.events.find((e) => e.category === 'social')!;
    const life = content.pack.events.find((e) => e.category === 'life' && !e.tags?.length)!;
    expect(affinity(social)).toBe(content.pack.monthlyActions.affinityPermille);
    expect(affinity(life)).toBe(1000);
    // 후보 가중치에 반영
    const before = getEligibleEvents(r.settled, content, 'work').find((c) => c.event.category === 'social');
    const after = getEligibleEvents(r.state, content, 'work').find((c) => c.event.id === before?.event.id);
    if (before && after) expect(after.weight).toBeGreaterThan(before.weight);
  });

  it('공개 뷰: 행동 6장, 효과 문구, 최근 기록', () => {
    const s = playMonths(base, 2, 'network');
    const v = toPublicView(s, content).monthlyActions!;
    expect(v.options.map((o) => o.id)).toEqual([
      'rest',
      'study',
      'network',
      'overtime',
      'exercise',
      'sidejob',
    ]);
    expect(v.selected).toBe('network');
    expect(v.options.find((o) => o.id === 'rest')!.effects).toEqual(['체력 +3', '정신력 +3']);
    expect(v.recent.map((r) => r.actionId)).toEqual(['network', 'network']);
  });

  it('옛 세이브(행동 기록 없음)도 불러온다', () => {
    const old = JSON.parse(JSON.stringify(startMonth(base, content))) as Record<string, unknown> & {
      currentMonth: Record<string, unknown>;
    };
    delete old.actionLog;
    delete old.currentMonth.action;
    const m = migrateRunState(old);
    expect(m.actionLog).toEqual([]);
    expect(m.currentMonth?.action).toBeNull();
  });

  it('별명: 자기계발 36개월 → 주경야독 조건', () => {
    const rule = content.pack.titles.find((t) => t.id === 'title_night_school')!.rule;
    const log = Array.from({ length: 36 }, (_, i) => ({ turnIndex: i, actionId: 'study' as const }));
    const ending = { category: 'NORMAL', type: 'RETIREMENT', cause: null, age: 60 } as never;
    expect(matchesTitleRule({ ...base, actionLog: log }, ending, rule, content)).toBe(true);
    expect(matchesTitleRule({ ...base, actionLog: log.slice(1) }, ending, rule, content)).toBe(false);
  });
});
