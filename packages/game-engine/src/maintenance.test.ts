import { describe, expect, it } from 'vitest';
import { type GameRunState } from '@company-life/shared';
import { priceIndex } from './economy';
import { resolveChoice } from './events';
import { judgeLifeGoal } from './goals';
import { migrateRunState, rebindContentVersion } from './migrate';
import { applyMonthlySettlement } from './month';
import { ALWAYS_SUCCEED, content, employedRun, open } from './test-fixtures';
import { toPublicActiveEvent } from './view';

const base = employedRun();
const atAge = (age: number) => (age - content.pack.rules.startAge) * 12;

describe('정비: 가정 환경 제거', () => {
  it('카드에 가정 환경이 없고, 시작 현금은 같은 기준에서 강점·약점 보정만 받는다', () => {
    for (const card of base.characterCards) {
      expect(card).not.toHaveProperty('familyId');
      expect(card.backgroundTraits.some((id) => id.startsWith('fam_'))).toBe(false);
      expect(card.backgroundTraits).toHaveLength(4);
    }
    expect(content.pack.backgroundTraits.some((b) => (b.kind as string) === 'FAMILY')).toBe(false);
  });
});

describe('정비: 세이브 호환 (업데이트 후 이어하기)', () => {
  /** S4 이전 모양의 세이브: 새 필드가 없고 가정 환경이 남아 있다 */
  function oldSave(): Record<string, unknown> {
    const s = JSON.parse(JSON.stringify({ ...base, contentVersion: '2026.11.17-p1.3' })) as {
      [key: string]: unknown;
      statistics: Record<string, unknown>;
      employment: { current: Record<string, unknown> };
      characterCards: Array<Record<string, unknown>>;
      backgroundTraits: string[];
    };
    delete s.lifeGoalOffers;
    delete s.lifeGoal;
    delete s.statistics.lowestWellbeing;
    delete s.employment.current.rankSinceTurn;
    delete s.employment.current.promotionPoints;
    delete s.employment.current.promotionMisses;
    s.characterCards[0]!.familyId = 'fam_middle';
    s.backgroundTraits = [...s.backgroundTraits, 'fam_middle'];
    return s;
  }

  it('없는 필드는 기본값으로 채우고, 사라진 필드는 버린다', () => {
    const migrated = migrateRunState(oldSave());
    expect(migrated.lifeGoal).toBeNull();
    expect(migrated.employment.current).toMatchObject({ promotionPoints: 0, promotionMisses: 0 });
    expect(migrated.employment.current!.rankSinceTurn).toBe(migrated.employment.current!.startedTurn);
    expect(migrated.characterCards[0]).not.toHaveProperty('familyId');
    expect(migrated.statistics.lowestWellbeing).toBe(
      Math.min(migrated.resources.health, migrated.resources.mental),
    );
  });

  it('구버전 콘텐츠에 고정된 세이브는 참조가 모두 남아 있으면 최신 콘텐츠로 옮긴다', () => {
    const rebound = rebindContentVersion(migrateRunState(oldSave()), content)!;
    expect(rebound.contentVersion).toBe(content.pack.contentVersion);
    expect(rebound.backgroundTraits).not.toContain('fam_middle');
  });

  it('없어진 회사에 다니던 세이브는 옮기지 않는다 (null)', () => {
    const s = migrateRunState(oldSave());
    const gone = {
      ...s,
      employment: { ...s.employment, current: { ...s.employment.current!, companyId: 'company_removed' } },
    };
    expect(rebindContentVersion(gone, content)).toBeNull();
  });
});

describe('정비: 물가 상승은 사건의 돈에도 붙는다', () => {
  it('10년 차에는 같은 사건 지출도 물가만큼 커진다', () => {
    const young = { ...base, cash: 100_000_000 };
    const old = { ...young, turnIndex: 120 };
    const spend = (s: GameRunState) =>
      s.cash - resolveChoice(open(s, 'evt_life_wedding_season'), 'send_money', content).state.cash;
    expect(spend(young)).toBe(200_000);
    const idx = priceIndex(old, content);
    expect(idx).toBeGreaterThan(1.4);
    expect(spend(old)).toBe(Math.round((200_000 * idx) / 1000) * 1000);
    // 생활비도 같은 지수
    const settled = applyMonthlySettlement(old, content).settlement;
    expect(settled.livingBreakdown.housing).toBe(Math.round((550_000 * idx) / 1000) * 1000);
  });
});

describe('정비: 희망퇴직', () => {
  const offer = (s: GameRunState) =>
    open(
      {
        ...s,
        turnIndex: atAge(55),
        flags: [
          {
            key: 'voluntary_retirement_wave',
            scope: 'COMPANY',
            ownerId: s.employment.current!.companyId,
            value: true,
            createdTurn: atAge(55),
            expiresTurn: atAge(55) + 6,
            sourceEventId: 'evt_head_voluntary_rumor',
          },
        ],
      },
      'evt_head_voluntary_offer',
    );

  it('수락은 빨간 실직 경고가 아니라 중립 안내 (정상 엔딩), 과로 같은 붕괴는 여전히 경고', () => {
    const view = toPublicActiveEvent(offer(base), content)!;
    const accept = view.choices.find((c) => c.id === 'accept')!;
    expect(accept.fatalWarning).toBeNull();
    expect(accept.endingNotice).toMatch(/^선택 시 조기 은퇴/);
    expect(view.choices.find((c) => c.id === 'decline')!.endingNotice).toBeNull();
  });

  it('위로금은 현 연봉 24개월치', () => {
    const s = { ...offer(base), cash: 0, rngState: ALWAYS_SUCCEED };
    const salary = s.employment.current!.annualSalary;
    const after = resolveChoice(s, 'accept', content).state;
    expect(after.cash).toBe(Math.floor(salary / 12) * 24);
  });
});

describe('정비: 워라밸 목표는 커리어 최저 컨디션도 본다', () => {
  it('은퇴 때 90 이상이어도, 한 번이라도 40 미만으로 무너졌으면 미달성', () => {
    const normal = { category: 'NORMAL' as const, type: 'RETIREMENT' as const };
    const fit: GameRunState = {
      ...base,
      lifeGoal: { goalId: 'goal_work_life_balance', milestones: [] },
      resources: { ...base.resources, health: 95, mental: 95 },
      statistics: { ...base.statistics, lowestWellbeing: 45 },
    };
    expect(judgeLifeGoal(fit, normal, content)?.achieved).toBe(true);
    const broke = { ...fit, statistics: { ...fit.statistics, lowestWellbeing: 39 } };
    expect(judgeLifeGoal(broke, normal, content)?.achieved).toBe(false);
  });
});
