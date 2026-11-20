import { describe, expect, it } from 'vitest';
import { turnInfo, type GameRunState } from '@company-life/shared';
import { getEligibleEvents } from './events';
import { content, employedRun } from './test-fixtures';

/** n번째 턴(0 = 24세 1월)에 대리로 출근 중 */
function at(turnIndex: number): GameRunState {
  const base = employedRun();
  const cur = base.employment.current!;
  return {
    ...base,
    turnIndex,
    employment: { ...base.employment, current: { ...cur, rank: 'ASSISTANT_MANAGER', startedTurn: 0 } },
  };
}

const SEASONAL = content.pack.events.filter((e) => e.tags?.includes('seasonal'));

describe('C3 계절·연례 사건', () => {
  it('10개, 모두 정해진 달에만 후보가 된다', () => {
    expect(SEASONAL).toHaveLength(10);
    for (let t = 24; t < 36; t++) {
      const month = turnInfo(t, content.pack.rules.startAge).monthOfYear;
      const ids = new Set(
        [...getEligibleEvents(at(t), content, 'work'), ...getEligibleEvents(at(t), content, 'life')].map(
          (c) => c.event.id,
        ),
      );
      for (const e of SEASONAL) expect(ids.has(e.id)).toBe(e.conditions!.months!.includes(month));
    }
  });
});

describe('C2 회사별 개성 사건', () => {
  const FLAVOR = content.pack.events.filter((e) => e.tags?.includes('company_flavor'));

  it('회사마다 하나, 그 회사에 다닐 때만 후보가 된다', () => {
    expect(FLAVOR).toHaveLength(content.pack.companies.length);
    for (const company of content.pack.companies) {
      const base = at(30);
      const s = {
        ...base,
        employment: { ...base.employment, current: { ...base.employment.current!, companyId: company.id } },
      };
      const ids = getEligibleEvents(s, content, 'work').map((c) => c.event.id);
      const mine = FLAVOR.filter((e) => ids.includes(e.id));
      expect(mine.map((e) => e.conditions!.companies)).toEqual([[company.id]]);
    }
  });
});
