import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, NPC_RANKS, type GameRunState } from '@company-life/shared';
import { computeAnnualReview, processAnnualReview, processSalaryAdjustment } from './annual';
import { getEligibleEvents } from './events';
import { chooseInMonth, nextMonth, startMonth } from './month';
import { currentTeamNpcs, reassignBossIfNeeded } from './npcs';
import { playtestStartMonthWithEvent } from './playtest';
import { ALWAYS_SUCCEED, content, employedRun, open, withTraits } from './test-fixtures';
import { toPublicActiveEvent, toPublicView } from './view';

const NOW = '2026-11-17T00:00:00.000Z';
const base: GameRunState = {
  ...employedRun(),
  resources: { health: 100, mental: 100, focus: 100, reputation: 70 },
};

/** 실직 경고가 없는 첫 선택지로 한 달 진행 */
function playMonth(s: GameRunState): GameRunState {
  let x = startMonth(s, content);
  const pick = toPublicActiveEvent(x, content)!.choices.find((c) => c.enabled && !c.fatalWarning)!;
  x = chooseInMonth(x, pick.id, content).state;
  return x.pendingEnding ? x : nextMonth(x, content, NOW);
}

describe('§20.1 annual review (December) and salary adjustment (January)', () => {
  it('13개월 이상 진행: 12월 평가 1회, 다음 1월 연봉 조정 1회 (Phase 1 완료 기준)', () => {
    let s = base;
    const salary0 = s.employment.current!.annualSalary;
    for (let i = 0; i < 14 && !s.pendingEnding; i++) {
      s = {
        ...s,
        resources: { health: 100, mental: 100, focus: 100, reputation: Math.max(s.resources.reputation, 50) },
      };
      s = playMonth(s);
    }
    expect(s.pendingEnding).toBeNull();
    expect(s.turnIndex).toBe(14);
    expect(s.annualReviews).toHaveLength(1);
    expect(s.annualReviews[0]).toMatchObject({ yearIndex: 0, turnIndex: 11 });
    expect(s.annualReviewProcessedYear).toBe(0);
    expect(s.salaryAdjustedYear).toBe(1);
    const permille = content.pack.rules.annualReview.raisePermilleByGrade[s.annualReviews[0]!.grade];
    expect(s.employment.current!.annualSalary).toBeGreaterThanOrEqual(salary0);
    if (permille > 0) expect(s.employment.current!.annualSalary).toBeGreaterThan(salary0);
    expect(GameRunStateSchema.safeParse(s).success).toBe(true);
  });

  it('평가·조정은 체크포인트로 같은 해에 두 번 실행되지 않는다', () => {
    const dec = { ...base, turnIndex: 11 };
    const once = processAnnualReview(dec, content);
    expect(once.review).not.toBeNull();
    const twice = processAnnualReview(once.state, content);
    expect(twice.review).toBeNull();
    expect(twice.state.annualReviews).toHaveLength(1);

    const jan = { ...once.state, turnIndex: 12 };
    const raised = processSalaryAdjustment(jan, content);
    expect(raised.adjustment).not.toBeNull();
    const again = processSalaryAdjustment(raised.state, content);
    expect(again.adjustment).toBeNull();
    expect(again.state.employment.current!.annualSalary).toBe(raised.state.employment.current!.annualSalary);
  });

  it('첫 해 1월에는 조정하지 않고, 평가가 없으면 인상 없이 체크포인트만', () => {
    expect(processSalaryAdjustment({ ...base, turnIndex: 0 }, content).adjustment).toBeNull();
    const noReview = processSalaryAdjustment({ ...base, turnIndex: 12 }, content);
    expect(noReview.adjustment).toBeNull();
    expect(noReview.state.salaryAdjustedYear).toBe(1);
  });

  it('12월에 강제·예약 사건이 있어도 평가는 수행된다 (§20.3-1)', () => {
    const forced = playtestStartMonthWithEvent({ ...base, turnIndex: 11 }, 'evt_server_outage', content);
    expect(forced.annualReviews).toHaveLength(1);
    expect(forced.currentMonth?.annualReview).not.toBeNull();

    const scheduled = {
      ...base,
      turnIndex: 11,
      scheduledEvents: [
        {
          scheduleId: 's1',
          eventId: 'evt_tech_debt_return',
          dueTurn: 11,
          priority: 0,
          sourceOccurrenceId: null,
          status: 'PENDING' as const,
        },
      ],
    };
    const started = startMonth(scheduled, content);
    expect(started.activeEvent?.eventId).toBe('evt_tech_debt_return');
    expect(started.annualReviews).toHaveLength(1);
  });

  it('점수: 평판·상사 관계가 높을수록 좋은 등급, 사내 낙인 Lv.2는 감점', () => {
    const boss = currentTeamNpcs(base).find((t) => t.role === 'BOSS')!.npc;
    const withBoss = (s: GameRunState, trust: number, favor: number) => ({
      ...s,
      npcs: s.npcs.map((n) => (n.npcId === boss.npcId ? { ...n, trust, favor } : n)),
    });
    const good = computeAnnualReview(
      withBoss({ ...base, resources: { ...base.resources, reputation: 95 } }, 95, 95),
      content,
    );
    const bad = computeAnnualReview(
      withBoss({ ...base, resources: { ...base.resources, reputation: 15 } }, 10, 10),
      content,
    );
    expect(good.grade).toBe('S');
    expect(bad.grade).toBe('D');
    const neutral = withBoss({ ...base, resources: { ...base.resources, reputation: 60 } }, 60, 60);
    const plain = computeAnnualReview(neutral, content).score;
    expect(computeAnnualReview(withTraits(neutral, {}, { officeStigma: 2 }), content).score).toBe(plain - 15);
    expect(computeAnnualReview(withTraits(neutral, {}, { officeStigma: 1 }), content).score).toBe(plain - 5);
  });

  it('공개 뷰: 12월 결산에 평가, 1월 결산에 연봉 조정이 보인다', () => {
    const dec = startMonth({ ...base, turnIndex: 11 }, content);
    const decChoice = toPublicActiveEvent(dec, content)!.choices.find((c) => c.enabled)!.id;
    const decView = toPublicView(chooseInMonth(dec, decChoice, content).state, content);
    expect(decView.monthSummary?.annualReview?.grade).toBeDefined();
    expect(decView.employment.lastReviewGrade).toBe(decView.monthSummary?.annualReview?.grade);
  });
});

describe('scheduled follow-up events (§7.4)', () => {
  it('예약 전용 사건은 무작위 후보가 아니고, 예약된 달에 정확히 등장한다', () => {
    const dev = {
      ...base,
      employment: {
        ...base.employment,
        current: { ...base.employment.current!, jobId: 'DEV' as const, teamId: 'DEV' },
      },
    };
    expect(getEligibleEvents(dev, content).map((c) => c.event.id)).not.toContain('evt_tech_debt_return');
    const patched = chooseInMonth(
      open(dev, 'evt_dev_hotfix', { rng: ALWAYS_SUCCEED }),
      'quick_patch',
      content,
    ).state;
    expect(patched.scheduledEvents).toMatchObject([
      { eventId: 'evt_tech_debt_return', dueTurn: 4, status: 'PENDING' },
    ]);
    let s = nextMonth(patched, content, NOW);
    for (let i = 0; i < 3; i++) {
      s = startMonth(s, content);
      expect(s.activeEvent?.eventId).not.toBe('evt_tech_debt_return');
      const pick = toPublicActiveEvent(s, content)!.choices.find((c) => c.enabled && !c.fatalWarning)!.id;
      s = nextMonth(chooseInMonth(s, pick, content).state, content, NOW);
    }
    s = startMonth(s, content);
    expect(s.turnIndex).toBe(4);
    expect(s.activeEvent?.eventId).toBe('evt_tech_debt_return');
    expect(s.scheduledEvents[0]!.status).toBe('DONE');
  });
});

describe('UI-1 public view additions', () => {
  it('달력은 이번 달·지난달·12월 평가·예약 사건(내용 없이)을 표시한다', () => {
    const s = {
      ...base,
      turnIndex: 2,
      scheduledEvents: [
        {
          scheduleId: 's1',
          eventId: 'evt_tech_debt_return',
          dueTurn: 6,
          priority: 0,
          sourceOccurrenceId: null,
          status: 'PENDING' as const,
        },
      ],
    };
    const cal = toPublicView(s, content).calendar;
    expect(cal.months.map((m) => m.status).slice(0, 4)).toEqual(['PAST', 'PAST', 'CURRENT', 'FUTURE']);
    expect(cal.months[6]).toMatchObject({ month: 7, scheduled: true });
    expect(cal.months[11]).toMatchObject({ month: 12, review: true });
    expect(JSON.stringify(cal)).not.toContain('evt_tech_debt_return');
  });

  it('기록에는 내부 판정 수치(roll, chance)가 들어가지 않는다', () => {
    const json = JSON.stringify(toPublicView(base, content).history);
    expect(json).not.toMatch(/roll|chance/);
    expect(toPublicView(base, content).history[0]?.kind).toBe('NPC_TEAM_CREATED');
  });

  it('사건 화면에 참여 NPC 정보와 분류 이름이 나온다 (숨김 수치 제외)', () => {
    const peer = currentTeamNpcs(base).find((t) => t.role === 'PEER')!.npc;
    const ev = toPublicActiveEvent(
      open(base, 'evt_peer_help_request', { participantNpcId: peer.npcId }),
      content,
    )!;
    expect(ev.participant?.name).toBe(peer.name);
    expect(ev.categoryLabel).toBe('사내 관계');
    expect(JSON.stringify(ev.participant)).not.toMatch(/"trust"|"favor"/);
  });
});

describe('§21.2 boss replacement', () => {
  it('플레이어가 상사 직급 이상이 되면 기존 상사는 FORMER_BOSS로 보존하고 더 높은 새 상사를 배치', () => {
    const oldBoss = currentTeamNpcs(base).find((t) => t.role === 'BOSS')!.npc;
    const promoted = {
      ...base,
      employment: {
        ...base.employment,
        current: { ...base.employment.current!, rank: oldBoss.rank as 'MANAGER' },
      },
    };
    const { state, replaced } = reassignBossIfNeeded(promoted, content);
    expect(replaced).toBe(true);
    const newBoss = currentTeamNpcs(state).find((t) => t.role === 'BOSS')!.npc;
    expect(newBoss.npcId).not.toBe(oldBoss.npcId);
    expect(NPC_RANKS.indexOf(newBoss.rank)).toBeGreaterThan(NPC_RANKS.indexOf(oldBoss.rank));
    expect(state.npcs.find((n) => n.npcId === oldBoss.npcId)).toEqual(oldBoss); // ID·관계·기억 보존
    expect(state.npcAssignments.filter((a) => a.npcId === oldBoss.npcId && a.toTurn === null)).toMatchObject([
      { role: 'FORMER_BOSS' },
    ]);
    expect(currentTeamNpcs(state)).toHaveLength(3);
    // 다시 호출해도 바뀌지 않음
    expect(reassignBossIfNeeded(state, content).replaced).toBe(false);
    expect(GameRunStateSchema.safeParse(state).success).toBe(true);
  });
});
