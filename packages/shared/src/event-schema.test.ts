import { describe, expect, it } from 'vitest';
import { EventDefinitionSchema } from './event-schema';

/** §23.2 본문 예시 그대로 */
const validSample = () => ({
  id: 'evt_social_breakthrough',
  version: 1,
  status: 'published',
  special: true,
  title: '갈등 중재',
  description: '팀 내 갈등',
  category: 'social',
  rarity: 'rare',
  weight: 10,
  cooldownMonths: 6,
  maxOccurrencesPerRun: 1,
  conditions: { employment: 'EMPLOYED', skillAbsent: ['socialSkill'] },
  choices: [
    {
      id: 'mediate',
      label: '갈등을 중재한다',
      visibleIf: {},
      enabledIf: {},
      outcome: {
        baseChance: 0.4,
        modifiers: [{ source: 'SKILL', id: 'socialSkill', levels: { '1': 0.1, '2': 0.12 } }],
      },
      onSuccess: {
        effects: [
          { type: 'RESOURCE_DELTA', key: 'reputation', amount: 5 },
          { type: 'SKILL_SET_LEVEL', id: 'socialSkill', from: 0, to: 1 },
        ],
      },
      onFailure: { effects: [{ type: 'RESOURCE_DELTA', key: 'mental', amount: -5 }] },
    },
  ],
});

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Sample = ReturnType<typeof validSample> & Record<string, unknown>;
const mutate = (fn: (e: Sample) => void) => {
  const e = validSample() as Sample;
  fn(e);
  return EventDefinitionSchema.safeParse(e);
};
const messages = (r: ReturnType<typeof mutate>) =>
  r.success ? [] : r.error.issues.map((i) => i.message).join(' | ');

describe('EventDefinitionSchema (§23.2)', () => {
  it('accepts the canonical §23.2 example', () => {
    const r = EventDefinitionSchema.safeParse(validSample());
    expect(r.success, messages(r as never) as string).toBe(true);
  });

  it('rejects SKILL_SET_LEVEL on a non-special event', () => {
    const r = mutate((e) => {
      e.special = false;
    });
    expect(r.success).toBe(false);
    expect(messages(r)).toContain('special');
  });

  it('rejects SKILL_SET_LEVEL outside onSuccess', () => {
    const r = mutate((e) => {
      e.choices[0]!.onFailure.effects.push({
        type: 'SKILL_SET_LEVEL',
        id: 'socialSkill',
        from: 0,
        to: 1,
      } as never);
    });
    expect(r.success).toBe(false);
    expect(messages(r)).toContain('onSuccess');
  });

  it('rejects skipping a level (0→2) and negative trait 2→0', () => {
    expect(
      mutate((e) => {
        e.choices[0]!.onSuccess.effects[1] = {
          type: 'SKILL_SET_LEVEL',
          id: 'socialSkill',
          from: 0,
          to: 2,
        } as never;
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        e.choices[0]!.onFailure.effects.push({
          type: 'NEGATIVE_TRAIT_SET_LEVEL',
          id: 'burnout',
          from: 2,
          to: 0,
        } as never);
      }).success,
    ).toBe(false);
  });

  it('accepts all allowed negative trait transitions on special events', () => {
    for (const [from, to] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [1, 0],
    ]) {
      const r = mutate((e) => {
        e.choices[0]!.onFailure.effects.push({
          type: 'NEGATIVE_TRAIT_SET_LEVEL',
          id: 'burnout',
          from,
          to,
        } as never);
      });
      expect(r.success, `${from}→${to}`).toBe(true);
    }
  });

  it('rejects unknown effect types and unknown fields', () => {
    expect(
      mutate((e) => {
        e.choices[0]!.onSuccess.effects.push({ type: 'XP_GAIN', amount: 10 } as never);
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        (e.choices[0] as Record<string, unknown>)['script'] = 'alert(1)';
      }).success,
    ).toBe(false);
  });

  it('rejects changing the same trait twice in one result', () => {
    const r = mutate((e) => {
      e.choices[0]!.onSuccess.effects.push({
        type: 'SKILL_SET_LEVEL',
        id: 'socialSkill',
        from: 1,
        to: 2,
      } as never);
    });
    expect(r.success).toBe(false);
    expect(messages(r)).toContain('두 번');
  });

  it('rejects duplicate choice ids, too many choices, and onSuccess without outcome', () => {
    expect(
      mutate((e) => {
        e.choices.push(jsonClone(e.choices[0]!));
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        const c = e.choices[0]!;
        e.choices = [1, 2, 3, 4, 5].map((n) => ({ ...jsonClone(c), id: `c${n}` }));
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        delete (e.choices[0] as Record<string, unknown>)['outcome'];
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-range probability, TEMPORARY flag without expiry, PARTICIPANT target without npc', () => {
    expect(
      mutate((e) => {
        e.choices[0]!.outcome.baseChance = 1.5;
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        e.choices[0]!.onSuccess.effects.push({ type: 'FLAG_SET', key: 'tmp', scope: 'TEMPORARY' } as never);
      }).success,
    ).toBe(false);
    expect(
      mutate((e) => {
        e.choices[0]!.onSuccess.effects.push({
          type: 'NPC_RELATION_DELTA',
          target: 'PARTICIPANT',
          stat: 'trust',
          amount: 5,
        } as never);
      }).success,
    ).toBe(false);
  });

  it('rejects trait level changes inside conditionalEffects', () => {
    const r = mutate((e) => {
      (e.choices[0] as Record<string, unknown>)['conditionalEffects'] = [
        { on: 'SUCCESS', when: {}, effects: [{ type: 'SKILL_SET_LEVEL', id: 'crisis', from: 0, to: 1 }] },
      ];
    });
    expect(r.success).toBe(false);
  });
});
