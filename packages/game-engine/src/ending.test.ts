import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, type GameRunState } from '@company-life/shared';
import { buildEnding, detectJobLossCause, withPendingEnding } from './ending';
import { EngineError } from './errors';
import { getEligibleEvents } from './events';
import { chooseInMonth, nextMonth, startMonth } from './month';
import { autoPlay } from './simulation';
import { ALWAYS_FAIL, ALWAYS_SUCCEED, content, employedRun, open, withTraits } from './test-fixtures';
import { toPublicActiveEvent, toPublicView } from './view';

const NOW = '2026-11-17T00:00:00.000Z';
const base = employedRun();
const turnForAge = (age: number) => (age - 24) * 12;
const at = (s: GameRunState, age: number, patch: Partial<GameRunState['resources']> = {}): GameRunState => ({
  ...s,
  turnIndex: turnForAge(age),
  resources: { ...s.resources, ...patch },
});
const cause = (s: GameRunState) => detectJobLossCause(s, content)?.cause ?? null;
const eligibleIds = (s: GameRunState) => getEligibleEvents(s, content).map((c) => c.event.id);

/** 체력 5인 상태에서 '확정 체력 -5' 선택지를 골라 월말 요약까지 진행 */
function exhaust(age: number): GameRunState {
  const s = open(at(base, age, { health: 5 }), 'evt_server_outage', { rng: ALWAYS_SUCCEED });
  return chooseInMonth(s, 'first_response', content).state;
}

describe('§26 job-loss endings', () => {
  it('49세 체력 0 → 과로 실직(FAILURE); 요약에서 예고되고 nextMonth에서 확정되며 턴은 그대로', () => {
    const summary = exhaust(49);
    expect(summary.phase).toBe('MONTH_SUMMARY');
    expect(summary.resources.health).toBe(0);
    expect(summary.pendingEnding).toMatchObject({ type: 'OVERWORK_DISMISSAL', category: 'FAILURE', age: 49 });
    expect(toPublicView(summary, content).pendingEnding?.title).toBe('과로 실직');

    const over = nextMonth(summary, content, NOW);
    expect(over.phase).toBe('GAME_OVER');
    expect(over.turnIndex).toBe(summary.turnIndex);
    expect(over.ending).toEqual(summary.pendingEnding);
    expect(over.pendingEnding).toBeNull();
    expect(over.finishedAt).toBe(NOW);
    expect(over.employment).toMatchObject({ status: 'ENDED', current: null });
    expect(over.npcAssignments.every((a) => a.toTurn !== null)).toBe(true);
    expect(over.npcs).toEqual(summary.npcs); // NPC·관계 이력은 보존
    expect(GameRunStateSchema.safeParse(over).success).toBe(true);
  });

  it('50세면 같은 원인이라도 조기 은퇴(NORMAL)이고 원인은 보존된다', () => {
    const summary = exhaust(50);
    expect(summary.pendingEnding).toMatchObject({
      type: 'EARLY_RETIREMENT',
      cause: 'OVERWORK_DISMISSAL',
      category: 'NORMAL',
      age: 50,
      title: '조기 은퇴 — 과로 실직',
    });
    expect(nextMonth(summary, content, NOW).employment.status).toBe('RETIRED');
  });

  it.each([
    ['mental', 'BURNOUT_DISMISSAL', '번아웃 실직'],
    ['focus', 'FATAL_MISTAKE', '대형 사고 실직'],
    ['reputation', 'OUSTED', '사내 퇴출'],
  ] as const)('%s 0 → %s', (key, expected, title) => {
    const s = at(base, 30, { [key]: 0 });
    expect(cause(s)).toBe(expected);
    expect(buildEnding(s, expected, null, content).title).toBe(title);
  });

  it('부채가 연봉 × 3 이상이면 빚더미 퇴장, 미만이면 아님', () => {
    const salary = base.employment.current!.annualSalary;
    expect(cause({ ...base, debt: salary * 3 - 1 })).toBeNull();
    expect(cause({ ...base, debt: salary * 3 })).toBe('DEBT_SPIRAL');
  });

  it('원인이 겹치면 우선순위 한 가지만: 체력 > 정신력 > 집중력 > 평판 > 부채 > 이벤트', () => {
    const salary = base.employment.current!.annualSalary;
    const all = { ...at(base, 30, { health: 0, mental: 0, focus: 0, reputation: 0 }), debt: salary * 5 };
    expect(cause(all)).toBe('OVERWORK_DISMISSAL');
    expect(cause({ ...all, resources: { ...all.resources, health: 10 } })).toBe('BURNOUT_DISMISSAL');
    expect(cause({ ...all, resources: { health: 10, mental: 10, focus: 0, reputation: 0 } })).toBe(
      'FATAL_MISTAKE',
    );
    expect(cause({ ...all, resources: { health: 10, mental: 10, focus: 10, reputation: 0 } })).toBe('OUSTED');
    expect(cause({ ...all, resources: { health: 10, mental: 10, focus: 10, reputation: 10 } })).toBe(
      'DEBT_SPIRAL',
    );
  });

  it('엔딩 문구는 직무·특성 변형을 쓰고 판정 시점에 고정된다', () => {
    const dev = {
      ...base,
      employment: { ...base.employment, current: { ...base.employment.current!, jobId: 'DEV' as const } },
    };
    expect(buildEnding(at(dev, 30, { focus: 0 }), 'FATAL_MISTAKE', null, content).text).toContain(
      'WHERE 없는 DELETE',
    );
    const stigma = withTraits(at(base, 30, { reputation: 0 }), {}, { officeStigma: 1 });
    expect(buildEnding(stigma, 'OUSTED', null, content).text).toContain('누명');
  });

  it('입사 전(첫 구직 단계)에는 실직 판정을 하지 않는다', () => {
    const before = { ...base, employment: { status: 'UNEMPLOYED' as const, current: null, jobLoss: null } };
    expect(cause({ ...before, resources: { ...before.resources, mental: 0 } })).toBeNull();
  });
});

describe('§26.5 event job loss requires warning signs', () => {
  it('구조조정 소문은 재직 12개월 이후에만 후보가 된다 (tenureMonths)', () => {
    const started = base.employment.current!.startedTurn;
    expect(eligibleIds({ ...base, turnIndex: started + 11 })).not.toContain('evt_restructuring_rumor');
    expect(eligibleIds({ ...base, turnIndex: started + 12 })).toContain('evt_restructuring_rumor');
  });

  it('구조조정 명단은 소문 플래그 없이는 후보가 아니고, 소문 이후에만 등장한다', () => {
    expect(eligibleIds(base)).not.toContain('evt_restructuring_list');
    const rumor = chooseInMonth(
      open(base, 'evt_restructuring_rumor', { rng: ALWAYS_SUCCEED }),
      'ignore',
      content,
    ).state;
    expect(rumor.flags).toMatchObject([
      { key: 'layoff_rumor', scope: 'COMPANY', expiresTurn: base.turnIndex + 6 },
    ]);
    expect(eligibleIds({ ...rumor, phase: 'MONTH_START' })).toContain('evt_restructuring_list');
    // 소문은 6개월 뒤 만료
    expect(eligibleIds({ ...rumor, turnIndex: rumor.turnIndex + 6 })).not.toContain('evt_restructuring_list');
  });

  it('면담 실패 → 구조조정 엔딩(출처 이벤트 기록), 한직 수용 → 생존', () => {
    const rumor = chooseInMonth(open(base, 'evt_restructuring_rumor'), 'ignore', content).state;
    const failed = chooseInMonth(
      open(rumor, 'evt_restructuring_list', { rng: ALWAYS_FAIL }),
      'prove_value',
      content,
    ).state;
    expect(failed.employment.status).toBe('UNEMPLOYED');
    expect(failed.pendingEnding).toMatchObject({
      type: 'RESTRUCTURING',
      category: 'FAILURE',
      sourceEventId: 'evt_restructuring_list',
      title: '구조조정',
    });
    const safe = chooseInMonth(open(rumor, 'evt_restructuring_list'), 'accept_transfer', content).state;
    expect(safe.pendingEnding).toBeNull();
    expect(safe.employment.status).toBe('EMPLOYED');
    expect(safe.flags.find((f) => f.key === 'layoff_rumor')).toBeUndefined();
  });
});

describe('§26.3 warnings', () => {
  it('20 이하 자원과 부채 70% 이상을 경고한다', () => {
    const salary = base.employment.current!.annualSalary;
    const s = { ...at(base, 30, { health: 20, focus: 21 }), debt: Math.ceil(salary * 3 * 0.7) };
    const codes = toPublicView(s, content).warnings.map((w) => w.code);
    expect(codes).toEqual(['HEALTH_CRITICAL', 'DEBT_CRITICAL']);
    expect(toPublicView(s, content).warnings[0]!.message).toContain('과로 실직');
  });

  it('위험 구간에서는 recovery 이벤트 가중치가 오른다', () => {
    const w = (s: GameRunState) =>
      getEligibleEvents(s, content).find((c) => c.event.id === 'evt_weekend_recharge')!.weight;
    expect(w(base)).toBe(10);
    expect(w(at(base, 30, { mental: 15 }))).toBe(35);
  });

  it('확정 비용만으로 0이 되는 선택지에 실직 경고를 붙인다 (확률 결과는 제외)', () => {
    const s = open(at(base, 30, { health: 5 }), 'evt_server_outage');
    const choices = toPublicActiveEvent(s, content)!.choices;
    expect(choices.find((c) => c.id === 'first_response')!.fatalWarning).toBe('⚠ 선택 시 과로 실직');
    expect(choices.find((c) => c.id === 'report_up')!.fatalWarning).toBeNull();
    const at50 = toPublicActiveEvent(open(at(base, 50, { health: 5 }), 'evt_server_outage'), content)!;
    expect(at50.choices.find((c) => c.id === 'first_response')!.fatalWarning).toBe(
      '⚠ 선택 시 조기 은퇴 — 과로 실직',
    );
  });
});

describe('monthly loop (§20.1)', () => {
  it('startMonth: 세후 월급·생활비·이자·자연 변화를 정수로 정산하고 사건을 연다', () => {
    const s = { ...base, debt: 10_000_000, cash: 1_000_000 };
    const started = startMonth(s, content);
    const salary = s.employment.current!.annualSalary;
    const gross = Math.floor(salary / 12);
    const net = gross - Math.floor((gross * 150) / 1000);
    expect(started.phase).toBe('EVENT_PENDING');
    expect(started.currentMonth?.settlement).toEqual({
      grossSalary: gross,
      tax: gross - net,
      netSalary: net,
      livingCost: 1_300_000,
      interest: 50_000,
    });
    // 급여명세서: 기본급 − 공제 = 실지급
    const s2 = started.currentMonth!.settlement;
    expect(s2.grossSalary - s2.tax).toBe(s2.netSalary);
    expect(started.cash).toBe(Math.max(0, 1_000_000 + net - 1_300_000));
    expect(started.debt).toBe(10_050_000 + Math.max(0, -(1_000_000 + net - 1_300_000)));
    expect(started.resources.focus).toBe(Math.min(100, s.resources.focus + 2));
    expect(started.activeEvent).not.toBeNull();
  });

  it('13개월을 진행해도 턴·나이·월이 계약대로 흐르고 같은 시드면 같은 사건 순서', () => {
    const play = () => {
      let s = { ...base, resources: { health: 100, mental: 100, focus: 100, reputation: 100 } };
      const seen: string[] = [];
      for (let i = 0; i < 13; i++) {
        s = startMonth(s, content);
        seen.push(s.activeEvent!.eventId);
        const view = toPublicActiveEvent(s, content)!;
        s = chooseInMonth(s, view.choices.find((c) => c.enabled && !c.fatalWarning)!.id, content).state;
        if (s.pendingEnding) break;
        s = nextMonth(s, content, NOW);
      }
      return { s, seen };
    };
    const a = play();
    const b = play();
    expect(a.seen).toEqual(b.seen);
    if (!a.s.pendingEnding) {
      expect(a.s.phase).toBe('MONTH_START');
      expect(a.s.turnIndex).toBe(13);
      expect(toPublicView(a.s, content).turn).toMatchObject({ age: 25, monthOfYear: 2 });
    }
  });

  it('60세 도달 시 정년 은퇴', () => {
    const summary = { ...base, phase: 'MONTH_SUMMARY' as const, turnIndex: turnForAge(60) - 1 };
    const over = nextMonth(summary, content, NOW);
    expect(over.ending).toMatchObject({ type: 'RETIREMENT', category: 'NORMAL', age: 60 });
    expect(over.employment.status).toBe('RETIRED');
  });

  it('GAME_OVER 이후 모든 진행 명령은 거부된다', () => {
    const over = nextMonth(exhaust(30), content, NOW);
    for (const fn of [
      () => startMonth(over, content),
      () => nextMonth(over, content, NOW),
      () => chooseInMonth(over, 'x', content),
    ]) {
      expect(fn).toThrow(EngineError);
    }
    expect(withPendingEnding(over, content).pendingEnding).toBeNull(); // 직장 정보가 비어 재판정 안 됨
  });
});

describe('auto-play (§26.7-8)', () => {
  it('200개 시드 × 2정책에서 진행 불능 0건, 모든 판이 엔딩에 도달', () => {
    for (const policy of ['random', 'cautious'] as const) {
      for (let i = 0; i < 200; i++) {
        const r = autoPlay(`t-${i}`, policy, content);
        expect(r.stuck, `${policy} ${r.seed}`).toBeNull();
        expect(r.endingType).not.toBeNull();
      }
    }
  }, 60_000);
});
