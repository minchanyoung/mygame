import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { buildChronicle } from './chronicle';
import { resolveChoice } from './events';
import { startMonth } from './month';
import { markSeasonAfterEvent, processSeason, seasonOfferDue } from './season';
import { content, employedRun, open } from './test-fixtures';
import { toPublicView } from './view';

/** n번째 턴(0 = 24세 1월)에 출근 중인 상태 */
function at(turnIndex: number, patch: Partial<GameRunState> = {}): GameRunState {
  const base = employedRun();
  const cur = base.employment.current!;
  return {
    ...base,
    turnIndex,
    scheduledEvents: [],
    employment: { ...base.employment, current: { ...cur, startedTurn: 0 } },
    ...patch,
  };
}

const pick = (s: GameRunState, choiceId: string) =>
  resolveChoice(open(s, 'evt_season_plan'), choiceId, content).state;

describe('S19 시즌 목표', () => {
  it('재직 1년 뒤 1월에만 새해 계획이 열린다', () => {
    expect(seasonOfferDue(at(12), content)).toBe(true);
    expect(seasonOfferDue(at(13), content)).toBe(false);
    expect(seasonOfferDue(at(0), content)).toBe(false); // 재직 1년 미만
    const s = startMonth({ ...at(12), phase: 'MONTH_START' }, content);
    expect([s.activeEvent?.eventId, ...s.pendingEvents.map((p) => p.eventId)]).toContain('evt_season_plan');
  });

  it('진행 중이거나 막 끝난 뒤 1년은 다시 열리지 않는다', () => {
    const s = pick(at(12), 'savings');
    expect(s.season?.kind).toBe('SAVINGS');
    expect(seasonOfferDue({ ...s, turnIndex: 24 }, content)).toBe(false);
    const done = {
      ...s,
      season: null,
      seasonHistory: [{ kind: 'SAVINGS' as const, startTurn: 12, endTurn: 30, achieved: true }],
    };
    expect(seasonOfferDue({ ...done, turnIndex: 36 }, content)).toBe(false);
    expect(seasonOfferDue({ ...done, turnIndex: 48 }, content)).toBe(true);
  });

  it('모으기: 목표액에 닿으면 바로 달성하고 보상', () => {
    const s = pick(at(12), 'savings');
    const target = s.season!.target;
    const rich = {
      ...s,
      turnIndex: 20,
      cash: target + s.debt + 1,
      resources: { ...s.resources, mental: 50 },
    };
    const r = processSeason(rich, content);
    expect(r.result?.achieved).toBe(true);
    expect(r.state.season).toBeNull();
    expect(r.state.resources.mental).toBe(50 + content.pack.rules.season.reward.mental);
    expect(r.state.employment.current!.promotionPoints).toBe(s.employment.current!.promotionPoints + 1);
  });

  it('버티기: 기준 아래로 내려가면 실패, 기한까지 버티면 달성', () => {
    const s = pick(at(12), 'wellbeing');
    const low = processSeason({ ...s, turnIndex: 20, resources: { ...s.resources, health: 30 } }, content);
    expect(low.result?.achieved).toBe(false);
    const ok = processSeason(
      { ...s, turnIndex: s.season!.deadlineTurn, resources: { ...s.resources, health: 80, mental: 80 } },
      content,
    );
    expect(ok.result?.achieved).toBe(true);
  });

  it('버티기: 그달 사건 직후 무너진 순간도 센다 (월초 회복과 무관)', () => {
    const s = pick(at(12), 'wellbeing');
    const dipped = markSeasonAfterEvent({ ...s, resources: { ...s.resources, mental: 50 } }, content);
    expect(dipped.season?.broken).toBe(true);
    const recovered = {
      ...dipped,
      turnIndex: 14,
      resources: { ...dipped.resources, mental: 100, health: 100 },
    };
    expect(processSeason(recovered, content).result?.achieved).toBe(false);
  });

  it('평가: C를 받으면 바로 실패', () => {
    const s = pick(at(12), 'review');
    const review = {
      ...s.annualReviews[0],
      turnIndex: 23,
      grade: 'C',
    } as GameRunState['annualReviews'][number];
    const r = processSeason({ ...s, turnIndex: 24, annualReviews: [review] }, content);
    expect(r.result?.achieved).toBe(false);
  });

  it('부장에게는 승진 목표가 보이지 않는다', () => {
    const base = at(12);
    const head = {
      ...base,
      employment: {
        ...base.employment,
        current: { ...base.employment.current!, rank: 'DEPARTMENT_HEAD' as const },
      },
    };
    const ids = toPublicView(open(head, 'evt_season_plan'), content).activeEvent!.choices.map((c) => c.id);
    expect(ids).not.toContain('promotion');
    expect(ids).toHaveLength(3);
  });

  it('화면에 진행 중인 목표가, 연대기에 결과가 남는다', () => {
    const s = pick(at(12), 'wellbeing');
    expect(toPublicView(s, content).season?.title).toBe('좋은 컨디션으로 3년');
    const ended = processSeason({ ...s, turnIndex: s.season!.deadlineTurn }, content).state;
    const items = buildChronicle(ended, content).eras.flatMap((e) => e.items);
    expect(items.some((it) => it.kind === 'SEASON')).toBe(true);
  });
});
