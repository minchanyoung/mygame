/**
 * 시드 기반 결정적 RNG. Math.random()은 사용하지 않는다 (§17.2).
 *
 * - 상태는 uint32 1개(mulberry32)라 GameRunState.rngState에 그대로 직렬화할 수 있다.
 * - 목적별 스트림은 deriveSeed(seed, ...labels)로 분리한다. 예: 카드 생성("cards"),
 *   채용 카드("jobOffers", turn, round), NPC 생성("npc", companyId, teamId, turn, stream).
 *   스트림을 분리하면 한 기능의 호출 수 변화가 다른 기능의 결과를 바꾸지 않는다.
 * - 판정(채용 합격, 선택지 성공)은 상태에 저장된 주 스트림(rngState)을 순서대로 소비한다.
 */

const UINT32 = 0x1_0000_0000;

/** FNV-1a 32bit + murmur3 fmix32 */
export function hashToUint32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function deriveSeed(seed: string, ...labels: Array<string | number>): number {
  return hashToUint32([seed, ...labels.map(String)].join('\u001f'));
}

export class SeededRng {
  #state: number;
  #calls = 0;

  constructor(state: number) {
    if (!Number.isInteger(state) || state < 0 || state >= UINT32) {
      throw new RangeError(`RNG state must be uint32, got ${state}`);
    }
    this.#state = state;
  }

  static derive(seed: string, ...labels: Array<string | number>): SeededRng {
    return new SeededRng(deriveSeed(seed, ...labels));
  }

  /** 저장 가능한 현재 상태 */
  get state(): number {
    return this.#state;
  }

  /** 이 인스턴스에서 소비한 난수 개수 (로그/디버그용) */
  get calls(): number {
    return this.#calls;
  }

  nextUint32(): number {
    this.#calls++;
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / UINT32;
  }

  /** [min, max] 정수 (양끝 포함) */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`invalid int range ${min}..${max}`);
    }
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** chance(0~1) 확률로 true. 판정에 사용한 roll 값도 함께 반환한다. */
  roll(chance: number): { success: boolean; roll: number } {
    const roll = this.nextFloat();
    return { success: roll < chance, roll };
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick from empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** 정수 가중치 기반 인덱스 선택. weight / 전체 합 (§7.3). */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (!Number.isInteger(w) || w < 0) throw new RangeError(`weights must be non-negative integers: ${w}`);
      total += w;
    }
    if (total <= 0) throw new RangeError('total weight must be positive');
    let target = this.int(0, total - 1);
    for (let i = 0; i < weights.length; i++) {
      target -= weights[i] as number;
      if (target < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher–Yates. 입력을 변경하지 않고 새 배열을 반환한다. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}
