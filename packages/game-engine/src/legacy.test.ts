import { describe, expect, it } from 'vitest';
import { collectRun, mergeRun } from './collection';
import { chooseCharacter, createRun } from './run';
import { content, PROFILE } from './test-fixtures';
import { toPublicView } from './view';
import { emptyCollection, type GameRunState } from '@company-life/shared';

const NOW = '2026-11-20T00:00:00.000Z';
const make = (legacy: { titleId: string; age: number } | null, daily: string | null = null) =>
  createRun(
    { runId: 'r1', guestOwnerId: 'g1', seed: 'legacy-seed', profile: PROFILE, now: NOW, legacy, daily },
    content,
  );

describe('S22 선배의 유산', () => {
  const rare = content.pack.titles.find((t) => t.rarity === 'RARE')!;
  const legendary = content.pack.titles.find((t) => t.rarity === 'LEGENDARY')!;

  it('캐릭터를 고르면 희귀도만큼 출발 보너스', () => {
    const plain = make(null);
    const card = plain.characterCards[0]!.cardId;
    const base = chooseCharacter(plain, card, content);
    const withRare = chooseCharacter(make({ titleId: rare.id, age: 57 }), card, content);
    expect(withRare.cash - base.cash).toBe(3_000_000);
    expect(withRare.resources.reputation - base.resources.reputation).toBe(3);
    const withLegend = chooseCharacter(make({ titleId: legendary.id, age: 60 }), card, content);
    expect(withLegend.resources.mental).toBe(Math.min(100, base.resources.mental + 5));
  });

  it('화면에 이름·나이·보너스가 보이고, 오늘의 출근에는 붙지 않는다', () => {
    const v = toPublicView(make({ titleId: rare.id, age: 57 }), content);
    expect(v.legacy).toMatchObject({ name: rare.name, fromAge: 57, perkLabel: '현금 +300만 · 평판 +3' });
    expect(make({ titleId: rare.id, age: 57 }, '2026-11-21').legacy).toBeNull();
    expect(make({ titleId: 'title_unknown', age: 50 }).legacy).toBeNull();
  });

  it('도감이 마지막 판의 대표 별명을 기억한다', () => {
    const ended = {
      ...make(null),
      ending: {
        type: 'RETIREMENT',
        category: 'NORMAL',
        age: 60,
        titles: [rare.id, legendary.id],
        goal: null,
      },
    } as unknown as GameRunState;
    const merged = mergeRun(emptyCollection(), 'r1', collectRun(ended, content), 'NORMAL', NOW, content);
    expect(merged.collection.lastRun).toEqual({ titleId: rare.id, age: 60 });
  });
});
