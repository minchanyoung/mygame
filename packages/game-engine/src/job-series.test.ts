import { describe, expect, it } from 'vitest';
import { emptyCollection, JOB_IDS, type GameRunState, type JobId } from '@company-life/shared';
import { mergeRun } from './collection';
import { getEligibleEvents } from './events';
import { startMonth } from './month';
import { content, employedRun } from './test-fixtures';

const NOW = '2026-11-18T00:00:00.000Z';

/** 이 직무로 n번째 턴에 출근하는 상태 (예약 사건 없음, 입사는 0턴) */
function asJob(job: JobId, turnIndex: number): GameRunState {
  const base = employedRun();
  const cur = base.employment.current!;
  return {
    ...base,
    turnIndex,
    scheduledEvents: [],
    employment: { ...base.employment, current: { ...cur, jobId: job, startedTurn: 0 } },
  };
}

const opened = (s: GameRunState) => [s.activeEvent?.eventId, ...s.pendingEvents.map((p) => p.eventId)];

describe('S12 직무별 연재', () => {
  it('직무마다 자기 연재 1화만 후보가 된다', () => {
    for (const job of JOB_IDS) {
      const ids = getEligibleEvents(asJob(job, 20), content, 'work')
        .map((c) => c.event)
        .filter((e) => e.series?.job)
        .map((e) => e.series!.job);
      expect(new Set(ids)).toEqual(new Set([job]));
    }
  });

  it('입사 1년 미만에는 나오지 않는다', () => {
    const early = getEligibleEvents(asJob('DEV', 6), content, 'work').filter((c) => c.event.series?.job);
    expect(early).toHaveLength(0);
  });

  it('4년 차(36개월)부터는 추첨 없이 그달 업무 칸에 열린다', () => {
    const firsts: Record<JobId, string> = {
      DEV: 'evt_jarc_dev_1',
      HR: 'evt_jarc_hr_1',
      SALES: 'evt_jarc_sales_1',
      FINANCE: 'evt_jarc_fin_1',
      PLANNING: 'evt_jarc_plan_1',
    };
    for (const job of JOB_IDS) {
      expect(opened(startMonth(asJob(job, 36), content))).toContain(firsts[job]);
    }
  });

  it('다른 연재가 진행 중이면 기다린다 (한 번에 1편)', () => {
    const s = asJob('SALES', 40);
    const busy: GameRunState = {
      ...s,
      scheduledEvents: [
        {
          scheduleId: 'x',
          eventId: 'evt_arc_rival_2',
          dueTurn: 50,
          priority: 0,
          sourceOccurrenceId: null,
          participantNpcId: null,
          status: 'PENDING',
        },
      ],
    };
    expect(opened(startMonth(busy, content))).not.toContain('evt_jarc_sales_1');
  });

  it('한 판에 한 번: 1화를 이미 봤으면 다시 보장하지 않는다', () => {
    const s = asJob('PLANNING', 40);
    const seen: GameRunState = {
      ...s,
      eventOccurrences: [
        {
          occurrenceId: 'o1',
          eventId: 'evt_jarc_plan_1',
          eventVersion: 1,
          turnIndex: 20,
          choiceId: 'build_it',
          success: null,
          highRisk: false,
          participantNpcId: null,
        } as GameRunState['eventOccurrences'][number],
      ],
    };
    expect(opened(startMonth(seen, content))).not.toContain('evt_jarc_plan_1');
  });

  it("업적: '이야기꾼'은 공통 연재 4편, '다섯 개의 명함'은 직무 연재 5편", () => {
    const finds = (seriesEndings: string[]) => ({
      titles: [],
      endings: ['RETIREMENT'],
      goals: [],
      companies: [],
      seriesEndings,
      traits: [],
    });
    const common = [
      'evt_arc_rival_4:winner',
      'evt_arc_mentor_4:see_off',
      'evt_arc_mentee_4:proud',
      'evt_arc_ledger_4:deny',
    ];
    const jobs = [
      'evt_jarc_dev_4:credit_team',
      'evt_jarc_hr_4:principle_end',
      'evt_jarc_sales_4:wait_clean',
      'evt_jarc_fin_4:next_time',
      'evt_jarc_plan_4:report_lesson',
    ];
    const a = mergeRun(emptyCollection(), 'r1', finds(common), 'NORMAL', NOW, content);
    expect(a.discovery.achievements).toContain('ach_storyteller');
    expect(a.discovery.achievements).not.toContain('ach_job_master');
    const b = mergeRun(a.collection, 'r2', finds(jobs.slice(0, 4)), 'NORMAL', NOW, content);
    expect(b.discovery.achievements).not.toContain('ach_job_master');
    const c = mergeRun(b.collection, 'r3', finds(jobs.slice(4)), 'NORMAL', NOW, content);
    expect(c.discovery.achievements).toEqual(['ach_job_master']);
  });
});
