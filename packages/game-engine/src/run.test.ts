import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, type JobOffer } from '@company-life/shared';
import { generateCharacterCards } from './characters';
import { EngineError } from './errors';
import { applyForJob, calculateHireChance, generateJobOffers } from './jobs';
import { chooseCharacter } from './run';
import { allowedCommands, assertCommand, assertTransition } from './state-machine';
import { content, employedRun, newRun, PROFILE } from './test-fixtures';
import { toPublicView } from './view';

const expectEngineError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
};

describe('turn state machine (§23.3)', () => {
  it('only allows the documented command per phase', () => {
    expect(allowedCommands('CHARACTER_SELECTION')).toEqual(['chooseCharacter']);
    expect(allowedCommands('GAME_OVER')).toEqual(['getResult']);
    expectEngineError(() => assertCommand('CHARACTER_SELECTION', 'apply'), 'INVALID_PHASE');
    expectEngineError(() => assertCommand('EVENT_PENDING', 'nextMonth'), 'INVALID_PHASE');
    expectEngineError(() => assertTransition('JOB_OFFERS', 'apply', 'GAME_OVER'), 'INVALID_TRANSITION');
    expect(() => assertTransition('JOB_OFFERS', 'apply', 'MONTH_START')).not.toThrow();
  });
});

describe('character cards (§3.1)', () => {
  it('generates 3 cards that share the input name/gender and start with empty permanent traits', () => {
    const cards = generateCharacterCards(PROFILE, 'seed-1', content);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.profile).toEqual(PROFILE);
      expect(card.skills).toEqual({});
      expect(card.negativeTraits).toEqual({});
      expect(card.startAge).toBe(24);
    }
  });

  it('is reproducible for the same seed and differs for another seed', () => {
    expect(generateCharacterCards(PROFILE, 'seed-1', content)).toEqual(
      generateCharacterCards(PROFILE, 'seed-1', content),
    );
    expect(generateCharacterCards(PROFILE, 'seed-1', content)).not.toEqual(
      generateCharacterCards(PROFILE, 'seed-2', content),
    );
  });

  it('name/gender do not influence the random background (RNG only for background)', () => {
    const a = generateCharacterCards(PROFILE, 'seed-1', content);
    const b = generateCharacterCards({ displayName: 'Alex', gender: 'UNSPECIFIED' }, 'seed-1', content);
    const strip = (cards: typeof a) => cards.map(({ profile: _p, ...rest }) => rest);
    expect(strip(a)).toEqual(strip(b));
  });

  it('guarantees diversity: no two cards share university/major/family/strength/weakness', () => {
    for (let i = 0; i < 50; i++) {
      const cards = generateCharacterCards(PROFILE, `div-${i}`, content);
      for (const key of ['universityId', 'majorId', 'familyId', 'strengthId', 'weaknessId'] as const) {
        expect(new Set(cards.map((c) => c[key])).size).toBe(3);
      }
      for (const c of cards) {
        for (const v of Object.values(c.resources)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        expect(Number.isInteger(c.cash) && Number.isInteger(c.debt)).toBe(true);
      }
    }
  });
});

describe('createRun / chooseCharacter', () => {
  it('creates a schema-valid run in CHARACTER_SELECTION with empty skills and negativeTraits', () => {
    const run = newRun();
    expect(GameRunStateSchema.safeParse(run).success).toBe(true);
    expect(run.phase).toBe('CHARACTER_SELECTION');
    expect(run.skills).toEqual({});
    expect(run.negativeTraits).toEqual({});
    expect(run.characterCards).toHaveLength(3);
  });

  it('accepts only server-issued card ids and only in CHARACTER_SELECTION', () => {
    const run = newRun();
    expectEngineError(() => chooseCharacter(run, 'card_999', content), 'CARD_NOT_FOUND');
    const chosen = chooseCharacter(run, 'card_2', content);
    expect(chosen.phase).toBe('JOB_OFFERS');
    expect(chosen.selectedCharacter).toEqual(run.characterCards[1]);
    expect(chosen.resources).toEqual(run.characterCards[1]!.resources);
    expect(chosen.skills).toEqual({});
    expect(chosen.negativeTraits).toEqual({});
    expectEngineError(() => chooseCharacter(chosen, 'card_1', content), 'INVALID_PHASE');
  });

  it('does not expose the seed or RNG state in the public view', () => {
    const json = JSON.stringify(toPublicView(newRun(), content));
    expect(json).not.toContain('test-seed');
    expect(json).not.toContain('rngState');
  });
});

describe('job offers and hiring (§3.2, §26.4)', () => {
  it('first search: 3 distinct companies; the third is always F-grade and guaranteed (100%)', () => {
    for (let i = 0; i < 30; i++) {
      const s = chooseCharacter(newRun(`offers-${i}`), 'card_1', content);
      expect(s.jobOffers).toHaveLength(3);
      expect(new Set(s.jobOffers.map((o) => o.companyId)).size).toBe(3);
      const [a, b, sure] = s.jobOffers as [JobOffer, JobOffer, JobOffer];
      expect(sure.grade).toBe('F');
      expect(sure.guaranteed).toBe(true);
      expect(sure.hireChance).toBe(1);
      for (const o of [a, b]) {
        expect(o.guaranteed).toBe(false);
        expect(o.hireChance).toBeGreaterThanOrEqual(0.05);
        expect(o.hireChance).toBeLessThanOrEqual(0.95);
        expect(Math.round(o.hireChance * 100)).toBeCloseTo(o.hireChance * 100, 6);
      }
      for (const o of s.jobOffers) expect(Number.isInteger(o.annualSalary)).toBe(true);
    }
  });

  it('hire chance is identical regardless of the player name/gender', () => {
    const s = chooseCharacter(newRun(), 'card_1', content);
    const input = {
      character: s.selectedCharacter!,
      resources: s.resources,
      grade: 'B' as const,
      jobId: 'DEV' as const,
    };
    const other = {
      ...input,
      character: { ...input.character, profile: { displayName: 'Alex', gender: 'MALE' as const } },
    };
    expect(calculateHireChance(input, content)).toEqual(calculateHireChance(other, content));
  });

  it('on hire: employs as STAFF, moves to MONTH_START and creates boss 1 + peers 2', () => {
    const s = employedRun();
    expect(s.phase).toBe('MONTH_START');
    expect(s.employment.status).toBe('EMPLOYED');
    expect(s.employment.current?.rank).toBe('STAFF');
    expect(s.npcs.filter((n) => n.role === 'BOSS')).toHaveLength(1);
    expect(s.npcs.filter((n) => n.role === 'PEER')).toHaveLength(2);
    expect(s.npcAssignments).toHaveLength(3);
    expect(GameRunStateSchema.safeParse(s).success).toBe(true);
  });

  it('first search rejection: costs mental and auto-joins the shown guaranteed F card (§26.4)', () => {
    const s = chooseCharacter(newRun('reject'), 'card_1', content);
    const applied = s.jobOffers[0]!;
    const sure = s.jobOffers[2]!;
    const forced = { ...s, jobOffers: s.jobOffers.map((o, j) => (j === 0 ? { ...o, hireChance: 0 } : o)) };
    const out = applyForJob(forced, applied.offerId, content);
    expect(out.result.hired).toBe(false);
    expect(out.result.autoAssigned).toBe(true);
    expect(out.state.phase).toBe('MONTH_START');
    expect(out.state.employment.current).toMatchObject({
      companyId: sure.companyId,
      jobId: sure.jobId,
      annualSalary: sure.annualSalary,
    });
    expect(out.state.resources.mental).toBe(Math.max(0, forced.resources.mental - 5));
    expect(out.state.npcs).toHaveLength(3);
  });

  it('every first-search choice ends employed, across many seeds', () => {
    for (let i = 0; i < 40; i++) {
      const s = chooseCharacter(newRun(`always-${i}`), 'card_2', content);
      for (const offer of s.jobOffers) {
        const out = applyForJob(s, offer.offerId, content);
        expect(out.state.phase).toBe('MONTH_START');
        expect(out.state.employment.status).toBe('EMPLOYED');
      }
    }
  });

  it('job offers are reproducible for the same state', () => {
    const s = chooseCharacter(newRun(), 'card_3', content);
    expect(generateJobOffers(s, content)).toEqual(s.jobOffers);
  });
});
