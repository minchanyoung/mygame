import { describe, expect, it } from 'vitest';
import { deriveSeed, SeededRng } from './rng';

const take = (rng: SeededRng, n: number) => Array.from({ length: n }, () => rng.nextUint32());

describe('SeededRng', () => {
  it('produces identical sequences for the same seed', () => {
    expect(take(SeededRng.derive('seed-a', 'main'), 50)).toEqual(
      take(SeededRng.derive('seed-a', 'main'), 50),
    );
  });

  it('produces different sequences for different seeds and stream labels', () => {
    expect(take(SeededRng.derive('seed-a', 'main'), 5)).not.toEqual(
      take(SeededRng.derive('seed-b', 'main'), 5),
    );
    expect(deriveSeed('seed-a', 'cards')).not.toBe(deriveSeed('seed-a', 'npc'));
  });

  it('can be serialized mid-stream and resumed identically', () => {
    const a = SeededRng.derive('resume', 'main');
    take(a, 17);
    const resumed = new SeededRng(a.state);
    expect(take(resumed, 20)).toEqual(take(a, 20));
  });

  it('respects int bounds and float range', () => {
    const rng = SeededRng.derive('bounds');
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('never picks zero-weight entries and roughly follows weights', () => {
    const rng = SeededRng.derive('weights');
    const counts = [0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[rng.weightedIndex([0, 1, 3])]!++;
    expect(counts[0]).toBe(0);
    expect(counts[2]! / counts[1]!).toBeGreaterThan(2.4);
    expect(counts[2]! / counts[1]!).toBeLessThan(3.6);
  });

  it('shuffle returns a permutation without mutating input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = SeededRng.derive('shuffle').shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });

  it('rejects invalid states', () => {
    expect(() => new SeededRng(-1)).toThrow();
    expect(() => new SeededRng(2 ** 32)).toThrow();
    expect(() => new SeededRng(1.5)).toThrow();
  });
});
