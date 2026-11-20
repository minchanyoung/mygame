import { describe, expect, it } from 'vitest';
import type { GameRunState, JobId } from '@company-life/shared';
import { buildChronicle } from './chronicle';
import { resolveChoice } from './events';
import { startMonth } from './month';
import { ALWAYS_SUCCEED, content, employedRun, open } from './test-fixtures';
import { toPublicActiveEvent } from './view';

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

const ECHO_IDS = content.pack.events.filter((e) => e.tags?.includes('echo')).map((e) => e.id);

describe('S16 나중에 돌아오는 사건', () => {
  it('직무마다 3개씩, 모두 원인 선택지가 예약한다', () => {
    expect(ECHO_IDS).toHaveLength(15);
    const scheduled = new Set(
      content.pack.events.flatMap((e) =>
        e.choices.flatMap((c) =>
          (c.conditionalEffects ?? []).flatMap((ce) =>
            ce.effects.flatMap((x) => (x.type === 'SCHEDULE_EVENT' ? [x.eventId] : [])),
          ),
        ),
      ),
    );
    for (const id of ECHO_IDS) expect(scheduled).toContain(id);
    for (const job of ['DEV', 'HR', 'SALES', 'FINANCE', 'PLANNING']) {
      const n = content.pack.events.filter(
        (e) => e.tags?.includes('echo') && e.conditions?.jobs?.includes(job as JobId),
      );
      expect(n).toHaveLength(3);
    }
  });

  it('성공하면 예약되고, 24개월 안에는 다시 예약되지 않는다', () => {
    const s0 = open(asJob('DEV', 10), 'evt_dev_hotfix', { rng: ALWAYS_SUCCEED });
    const s1 = resolveChoice(s0, 'proper_fix', content).state;
    const pending = s1.scheduledEvents.filter((x) => x.eventId === 'evt_echo_dev_postmortem');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.dueTurn).toBe(16);

    const again = open({ ...s1, turnIndex: 12 }, 'evt_dev_hotfix', { rng: ALWAYS_SUCCEED });
    const s2 = resolveChoice(again, 'proper_fix', content).state;
    expect(s2.scheduledEvents.filter((x) => x.eventId === 'evt_echo_dev_postmortem')).toHaveLength(1);

    // 24개월이 지나면 다시 예약된다
    const later = open({ ...s1, turnIndex: 40 }, 'evt_dev_hotfix', { rng: ALWAYS_SUCCEED });
    const s3 = resolveChoice(later, 'proper_fix', content).state;
    expect(s3.scheduledEvents.filter((x) => x.eventId === 'evt_echo_dev_postmortem')).toHaveLength(2);
  });

  it('지름길은 판정과 무관하게 대가를 예약한다', () => {
    const s0 = open(asJob('SALES', 10), 'evt_sales_client_complaint');
    const s1 = resolveChoice(s0, 'promise_discount', content).state;
    expect(s1.scheduledEvents.map((x) => x.eventId)).toContain('evt_echo_sales_discount_bill');
  });

  it('돌아온 사건은 원인이 된 선택을 보여 주고 연대기에 남는다', () => {
    const s0 = open(asJob('DEV', 10), 'evt_dev_hotfix', { rng: ALWAYS_SUCCEED });
    const s1 = resolveChoice(s0, 'proper_fix', content).state;
    const due = startMonth({ ...s1, phase: 'MONTH_START', turnIndex: 16 }, content);
    expect(due.activeEvent?.eventId).toBe('evt_echo_dev_postmortem');
    expect(due.activeEvent?.sourceOccurrenceId).toBe(s0.activeEvent!.occurrenceId);

    const view = toPublicActiveEvent(due, content)!;
    expect(view.echo).toEqual({
      monthsAgo: 6,
      eventTitle: '배포 직후의 장애 제보',
      choiceLabel: '원인을 끝까지 찾아 제대로 고친다',
    });

    const done = resolveChoice(due, 'share_doc', content).state;
    const items = buildChronicle(done, content).eras.flatMap((e) => e.items);
    expect(items.some((it) => it.kind === 'ECHO' && it.text.includes('그때 그 장애 분석 문서'))).toBe(true);
  });

  it('원인 기록이 없는 예약 사건(옛 세이브)은 인용 없이 열린다', () => {
    const s = open(asJob('DEV', 10), 'evt_echo_dev_postmortem');
    expect(toPublicActiveEvent(s, content)!.echo).toBeNull();
  });
});
