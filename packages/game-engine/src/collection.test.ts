import { describe, expect, it } from 'vitest';
import { emptyCollection, type GameRunState } from '@company-life/shared';
import { calculateChoiceChance } from './chance';
import { collectRun, endingCategoryOf, mergeRun, toPublicCollection } from './collection';
import { scaleLoss } from './economy';
import { applyMonthlySettlement } from './month';
import { autoPlay } from './simulation';
import { content, employedRun } from './test-fixtures';

const NOW = '2026-11-18T00:00:00.000Z';

function finished(seed: string, difficulty: 'EASY' | 'NORMAL' | 'REAL' = 'NORMAL'): GameRunState {
  let s: GameRunState | null = null;
  autoPlay(seed, 'cautious', content, (x) => (s = x), difficulty);
  return s!;
}

describe('S10 난이도', () => {
  it('잃는 자원만 배율이 붙고, 1 이상 잃는 일은 0이 되지 않는다', () => {
    expect(scaleLoss(-10, 1100)).toBe(-11);
    expect(scaleLoss(-10, 950)).toBe(-9); // -9.5 → Math.round는 .5를 위로(0 쪽) → 덜 잃는다
    expect(scaleLoss(-1, 500)).toBe(-1);
    expect(scaleLoss(8, 1500)).toBe(8);
  });

  it('같은 선택지라도 쉬움 > 보통 > 현실 순으로 성공 확률이 높다', () => {
    const base = employedRun();
    const ev = content.pack.events.find((e) =>
      e.choices.some((c) => c.outcome && c.outcome.baseChance < 0.8),
    )!;
    const choice = ev.choices.find((c) => c.outcome && c.outcome.baseChance < 0.8)!;
    const chance = (difficulty: GameRunState['difficulty']) =>
      calculateChoiceChance({ ...base, difficulty }, choice, { participant: null }, content)!.chance;
    expect(chance('EASY')).toBeGreaterThan(chance('NORMAL'));
    expect(chance('NORMAL')).toBeGreaterThan(chance('REAL'));
  });

  it('생활비는 난이도 배율을 따르되, 빚 상환 한도는 물가만 따른다', () => {
    const base = employedRun();
    const cost = (difficulty: GameRunState['difficulty']) =>
      applyMonthlySettlement({ ...base, difficulty }, content).settlement.livingCost;
    expect(cost('EASY')).toBeLessThan(cost('NORMAL'));
    expect(cost('REAL')).toBeGreaterThan(cost('NORMAL'));
  });

  it('판은 생성 때 고른 난이도를 끝까지 유지한다', () => {
    const s = finished('diff-1', 'REAL');
    expect(s.difficulty).toBe('REAL');
  });
});

describe('S10 도감', () => {
  it('끝난 판에서 엔딩·별명·회사를 뽑고, 비활성 특성은 넣지 않는다', () => {
    const s = finished('col-1');
    const f = collectRun(s, content);
    expect(f.endings).toEqual([s.ending!.type]);
    expect(f.titles).toEqual(s.ending!.titles);
    expect(f.companies.length).toBeGreaterThan(0);
    for (const t of f.traits) expect(content.traits.get(t)!.active).toBe(true);
    if (s.ending!.goal?.achieved) expect(f.goals).toEqual([s.ending!.goal.goalId]);
    else expect(f.goals).toEqual([]);
  });

  it('합치기: 새 항목은 새 발견으로, 같은 판은 두 번 반영하지 않는다', () => {
    const s = finished('col-2');
    const f = collectRun(s, content);
    const once = mergeRun(emptyCollection(), s.runId, f, 'NORMAL', NOW, content);
    expect(once.collection.runsFinished).toBe(1);
    expect(once.discovery.newly.endings).toEqual(f.endings);
    expect(once.discovery.achievements).toContain('ach_first_run');
    const twice = mergeRun(once.collection, s.runId, f, 'NORMAL', NOW, content);
    expect(twice.collection).toBe(once.collection);
    expect(twice.discovery).toEqual(once.discovery);
  });

  it('다른 판에서 같은 엔딩을 다시 보면 횟수·난이도만 늘고 새 발견은 아니다', () => {
    const s = finished('col-3');
    const f = collectRun(s, content);
    const a = mergeRun(emptyCollection(), 'run-a', f, 'NORMAL', NOW, content).collection;
    const b = mergeRun(a, 'run-b', f, 'REAL', NOW, content);
    const entry = b.collection.endings[s.ending!.type]!;
    expect(entry.count).toBe(2);
    expect(entry.difficulties).toEqual(['NORMAL', 'REAL']);
    expect(b.discovery.newly.endings).toEqual([]);
  });

  it('업적: 현실 난이도 정상 엔딩은 현실에서 본 것만 인정', () => {
    const finds = {
      titles: [],
      endings: ['RETIREMENT'],
      goals: [],
      companies: [],
      seriesEndings: [],
      traits: [],
    };
    const normal = mergeRun(emptyCollection(), 'r1', finds, 'NORMAL', NOW, content);
    expect(normal.discovery.achievements).toEqual(
      expect.arrayContaining(['ach_first_run', 'ach_survived', 'ach_retirement']),
    );
    expect(normal.discovery.achievements).not.toContain('ach_real_survivor');
    const real = mergeRun(normal.collection, 'r2', finds, 'REAL', NOW, content);
    expect(real.discovery.achievements).toEqual(['ach_real_survivor']);
  });

  it('업적: 실패 엔딩 5종, 연재 4편 완결', () => {
    let col = emptyCollection();
    const failures = ['OVERWORK_DISMISSAL', 'BURNOUT_DISMISSAL', 'FATAL_MISTAKE', 'OUSTED', 'LAYOFF'];
    failures.forEach((t, i) => {
      expect(endingCategoryOf(t)).toBe('FAILURE');
      col = mergeRun(
        col,
        `f${i}`,
        { titles: [], endings: [t], goals: [], companies: [], seriesEndings: [], traits: [] },
        'NORMAL',
        NOW,
        content,
      ).collection;
    });
    expect(col.achievements['ach_failures']).toBeDefined();
    const finales = [
      'evt_arc_rival_4:winner',
      'evt_arc_mentor_4:see_off',
      'evt_arc_mentee_4:proud',
      'evt_arc_ledger_4:deny',
    ];
    const r = mergeRun(
      col,
      's',
      { titles: [], endings: ['RETIREMENT'], goals: [], companies: [], seriesEndings: finales, traits: [] },
      'NORMAL',
      NOW,
      content,
    );
    expect(r.discovery.achievements).toContain('ach_storyteller');
  });

  it('공개 도감: 못 본 항목은 ??? + 힌트, 81칸, 이번 판 새 발견을 돌려준다', () => {
    const s = finished('col-4');
    const { collection } = mergeRun(emptyCollection(), s.runId, collectRun(s, content), 'EASY', NOW, content);
    const pub = toPublicCollection(collection, content, s.runId);
    expect(pub.total).toBe(81);
    expect(pub.found).toBeGreaterThan(0);
    const titles = pub.categories.find((c) => c.key === 'titles')!;
    const hidden = titles.items.find((i) => !i.found)!;
    expect(hidden.name).toBe('???');
    expect(hidden.text.length).toBeGreaterThan(0);
    const seen = titles.items.find((i) => i.found)!;
    expect(seen.difficulties).toEqual(['쉬움']);
    expect(pub.discovery!.items.length).toBeGreaterThan(0);
    expect(toPublicCollection(collection, content, 'other-run').discovery).toBeNull();
  });
});
