import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, NPC_RANKS, type GameRunState } from '@company-life/shared';
import { computeAnnualReview, processAnnualReview, processSalaryAdjustment } from './annual';
import { backgroundEffects } from './background-effects';
import { calculateChoiceChance } from './chance';
import { indexContent } from './content-index';
import { createRun } from './run';
import { getEligibleEvents } from './events';
import { chooseInMonth, nextMonth, startMonth } from './month';
import { currentTeamNpcs, reassignBossIfNeeded } from './npcs';
import { playtestStartMonthWithEvent } from './playtest';
import {
  ALWAYS_SUCCEED,
  content,
  employedRun,
  finishEvents,
  open,
  playMonth,
  withTraits,
} from './test-fixtures';
import { toPublicActiveEvent, toPublicView } from './view';

const NOW = '2026-11-17T00:00:00.000Z';
const base: GameRunState = {
  ...employedRun(),
  resources: { health: 100, mental: 100, focus: 100, reputation: 70 },
};

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
    // 평판·상사 평가·컨디션이 모두 낮으면 D (업무 성과는 기록 없음 = 50)
    const bad = computeAnnualReview(
      withBoss({ ...base, resources: { health: 15, mental: 50, focus: 15, reputation: 15 } }, 10, 10),
      content,
    );
    expect(bad.items.map((i) => i.key)).toEqual(['performance', 'boss', 'peers', 'reputation', 'condition']);
    expect(bad.warning).toBe(true);
    expect(bad.comment.length).toBeGreaterThan(0);
    expect(good.grade).toBe('S');
    expect(bad.grade).toBe('D');
    const neutral = withBoss({ ...base, resources: { ...base.resources, reputation: 60 } }, 60, 60);
    const plain = computeAnnualReview(neutral, content).score;
    expect(computeAnnualReview(withTraits(neutral, {}, { officeStigma: 2 }), content).score).toBe(plain - 15);
    expect(computeAnnualReview(withTraits(neutral, {}, { officeStigma: 1 }), content).score).toBe(plain - 5);
  });

  it('공개 뷰: 12월 결산에 평가, 1월 결산에 연봉 조정이 보인다', () => {
    const dec = finishEvents(startMonth({ ...base, turnIndex: 11 }, content));
    const decView = toPublicView(dec, content);
    const review = decView.monthSummary?.annualReview;
    expect(review?.grade).toBeDefined();
    expect(review?.items).toHaveLength(5);
    expect(decView.employment.lastReviewGrade).toBe(review?.grade);
    // 성과급은 현금으로 들어온다
    if ((review?.bonus ?? 0) > 0) expect(dec.annualReviews[0]!.bonus).toBe(review!.bonus);
  });

  it('D등급이면 PIP 경고 플래그가 서고, 성과 개선 프로그램 사건이 후보가 된다', () => {
    const boss = currentTeamNpcs(base).find((t) => t.role === 'BOSS')!.npc;
    const dismal = {
      ...base,
      turnIndex: 11,
      resources: { health: 15, mental: 60, focus: 15, reputation: 15 },
      npcs: base.npcs.map((n) => (n.npcId === boss.npcId ? { ...n, trust: 5, favor: 5 } : n)),
    };
    const reviewed = processAnnualReview(dismal, content).state;
    expect(reviewed.flags.some((f) => f.key === 'performance_warning' && f.scope === 'COMPANY')).toBe(true);
    expect(
      getEligibleEvents({ ...reviewed, turnIndex: 12 }, content, 'work').map((c) => c.event.id),
    ).toContain('evt_pip');
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
      s = { ...s, resources: { health: 100, mental: 100, focus: 100, reputation: 70 } };
      s = startMonth(s, content);
      expect(s.activeEvent?.eventId).not.toBe('evt_tech_debt_return');
      s = nextMonth(finishEvents(s), content, NOW);
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

describe('스펙 카드 근거와 이달의 이야기', () => {
  it('카드의 강점·약점 효과는 데이터에서 계산되고, 사건 보정은 관련 사건 이름을 근거로 단다', () => {
    const run = createRun(
      {
        runId: 'r',
        guestOwnerId: 'g',
        seed: 'spec-seed',
        profile: { displayName: '김하늘', gender: 'FEMALE' },
        now: NOW,
      },
      content,
    );
    for (const card of toPublicView(run, content).characterCards) {
      for (const t of [card.strength, card.weakness, card.university, card.major]) {
        expect(t.effects.length).toBeGreaterThan(0);
      }
      expect(card.recommendedJob.label).toBeTruthy();
    }
    const empathy = indexContent(content.pack).backgrounds.get('str_empathy')!;
    const fx = backgroundEffects(empathy, content).map((e) => e.text);
    expect(fx).toContain('인사 지원 시 합격률 +10%p');
    const eventFx = backgroundEffects(empathy, content).find((e) => e.text.startsWith('관련 사건'))!;
    expect(eventFx.detail).toContain('회식 자리의 불화');
  });

  it('강점이 실제로 판정 확률을 바꾼다 (공감능력 → 회식 중재 +10%p)', () => {
    const c = content.events.get('evt_office_dinner_crisis')!.choices.find((x) => x.id === 'mediate')!;
    const plain = { ...base, backgroundTraits: [] };
    const empath = { ...base, backgroundTraits: ['str_empathy'] };
    expect(calculateChoiceChance(plain, c, { participant: null }, content)!.chance).toBe(0.4);
    expect(calculateChoiceChance(empath, c, { participant: null }, content)!.chance).toBe(0.5);
  });

  it('이달의 이야기: 상황·선택·판정 요인·사건만의 변화·결과 문장을 준다 (수치 비공개)', () => {
    const s = { ...base, backgroundTraits: ['str_empathy'] };
    // 결산 기록(currentMonth)이 있어야 하므로 실제 월 시작 경로로 사건을 연다
    const started = playtestStartMonthWithEvent(s, 'evt_office_dinner_crisis', content);
    const summary = chooseInMonth({ ...started, rngState: ALWAYS_SUCCEED }, 'mediate', content).state;
    const ev = toPublicView(summary, content).monthSummary!.events[0]!;
    expect(ev.situation).toContain('말다툼');
    expect(ev.verdictLabel).toBe('성공');
    expect(ev.factors).toEqual([{ label: '공감능력 — 유리하게 작용', positive: true }]);
    expect(ev.effects.map((e) => e.text)).toEqual(['평판 +5']);
    expect(ev.relationChanges[0]).toMatch(/호감 ▲$/);
    // 메신저 스토리텔링: 내 답장과 반응 대화
    expect(ev.reply).toContain('노가리 제가 쏩니다');
    expect(ev.aftermath[0]?.side).toBe('other');
    expect(ev.channelName).toBe('팀 회식 단톡방');
    expect(JSON.stringify(ev)).not.toMatch(/0\.5|chance|roll/);
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
