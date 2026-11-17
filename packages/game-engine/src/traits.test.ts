import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { calculateChoiceChance, levelBonus } from './chance';
import { applyEffects } from './effects';
import { EngineError } from './errors';
import { evaluateChoices, getEligibleEvents, resolveChoice } from './events';
import { requireFrom } from './content-index';
import { ALWAYS_FAIL, ALWAYS_SUCCEED, content, employedRun, open, withTraits } from './test-fixtures';
import { toPublicActiveEvent } from './view';

const base = employedRun();
const event = (id: string) => requireFrom(content.events, id, 'event');
const choice = (eventId: string, choiceId: string) => event(eventId).choices.find((c) => c.id === choiceId)!;
const chanceOf = (state: GameRunState, eventId: string, choiceId: string) =>
  calculateChoiceChance(state, choice(eventId, choiceId), { participant: null }, content)!.chance;
const visibleChoices = (state: GameRunState, eventId: string) =>
  evaluateChoices(state, event(eventId), null, content)
    .filter((c) => c.visible)
    .map((c) => c.choice.id);
const eligibleIds = (state: GameRunState) => getEligibleEvents(state, content).map((c) => c.event.id);
const resolve = (state: GameRunState, eventId: string, choiceId: string, rng: number) =>
  resolveChoice(open(state, eventId, { rng }), choiceId, content);

describe('permanent traits start empty (§4.2, §4.2.2)', () => {
  it('employed run still has skills = {} and negativeTraits = {} (no XP fields)', () => {
    expect(base.skills).toEqual({});
    expect(base.negativeTraits).toEqual({});
    expect(JSON.stringify(base)).not.toMatch(/"xp"/i);
  });
});

describe('level bonuses are per-event and replace, not stack (§7.5, §23.2)', () => {
  it('levelBonus picks the highest defined level <= current', () => {
    expect(levelBonus({ '1': 0.1, '2': 0.12 }, 0)).toBe(0);
    expect(levelBonus({ '1': 0.1, '2': 0.12 }, 1)).toBe(0.1);
    expect(levelBonus({ '1': 0.1, '2': 0.12 }, 2)).toBe(0.12);
    expect(levelBonus({ '2': 0.2 }, 1)).toBe(0);
    expect(levelBonus({ '1': 0.1 }, 2)).toBe(0.1);
  });

  it('example A — Lv.1-effective event: none 40%, Lv.1 50%, Lv.2 52% (not 62%)', () => {
    expect(chanceOf(base, 'evt_office_dinner_crisis', 'mediate')).toBe(0.4);
    expect(chanceOf(withTraits(base, { socialSkill: 1 }), 'evt_office_dinner_crisis', 'mediate')).toBe(0.5);
    expect(chanceOf(withTraits(base, { socialSkill: 2 }), 'evt_office_dinner_crisis', 'mediate')).toBe(0.52);
  });

  it('example B — Lv.2-only event: no bonus at Lv.1, +20%p and exclusive choice at Lv.2', () => {
    expect(chanceOf(base, 'evt_executive_faction', 'negotiate')).toBe(0.25);
    expect(chanceOf(withTraits(base, { socialSkill: 1 }), 'evt_executive_faction', 'negotiate')).toBe(0.25);
    expect(chanceOf(withTraits(base, { socialSkill: 2 }), 'evt_executive_faction', 'negotiate')).toBe(0.45);

    const enabled = (s: GameRunState) =>
      evaluateChoices(s, event('evt_executive_faction'), null, content).find(
        (c) => c.choice.id === 'backroom_deal',
      )!.enabled;
    expect(enabled(withTraits(base, { socialSkill: 1 }))).toBe(false);
    expect(enabled(withTraits(base, { socialSkill: 2 }))).toBe(true);
  });

  it('public view shows a trait as applied only when it actually gives a bonus (§22.1)', () => {
    const lv1 = toPublicActiveEvent(
      open(withTraits(base, { socialSkill: 1 }), 'evt_executive_faction'),
      content,
    )!;
    expect(lv1.choices.find((c) => c.id === 'negotiate')!.appliedTraits).toEqual([]);
    const locked = lv1.choices.find((c) => c.id === 'backroom_deal')!;
    expect(locked.enabled).toBe(false);
    expect(locked.lockedHint).toBe('처세술 Lv.2 필요');

    const lv2 = toPublicActiveEvent(
      open(withTraits(base, { socialSkill: 2 }), 'evt_executive_faction'),
      content,
    )!;
    expect(lv2.choices.find((c) => c.id === 'negotiate')!.appliedTraits).toEqual(['처세술 Lv.2']);
    // 정확한 확률은 공개 뷰에 없다
    expect(JSON.stringify(lv2)).not.toMatch(/chance|0\.45/);
    expect(lv2.choices.find((c) => c.id === 'negotiate')!.risk).toBe('MEDIUM');
  });

  it('negative trait modifiers apply only at their defined level (burnout Lv.2 −10%p)', () => {
    expect(chanceOf(withTraits(base, {}, { burnout: 2 }), 'evt_project_collapse', 'push_through')).toBe(0.35);
  });

  it('final chance is clamped to [5%, 95%]', () => {
    const c = choice('evt_server_outage', 'routine_fix');
    const boosted = { ...c, outcome: { ...c.outcome!, baseChance: 0.9 } };
    expect(
      calculateChoiceChance(withTraits(base, { crisis: 2 }), boosted, { participant: null }, content)!.chance,
    ).toBe(0.95);
  });
});

describe('positive skills: special-event success only (§4.2)', () => {
  it('grant 0→1 on special success; nothing on failure', () => {
    const ok = resolve(base, 'evt_social_breakthrough', 'resolve_conflict', ALWAYS_SUCCEED);
    expect(ok.result.success).toBe(true);
    expect(ok.state.skills).toEqual({ socialSkill: 1 });
    expect(ok.state.skillHistory).toMatchObject([
      { traitId: 'socialSkill', from: 0, to: 1, reason: 'grant' },
    ]);
    expect(ok.state.phase).toBe('MONTH_SUMMARY');

    const fail = resolve(base, 'evt_social_breakthrough', 'resolve_conflict', ALWAYS_FAIL);
    expect(fail.result.success).toBe(false);
    expect(fail.state.skills).toEqual({});
  });

  it('upgrade 1→2 only from Lv.1 on the upgrade event; failure keeps Lv.1', () => {
    const lv1 = withTraits(base, { socialSkill: 1 });
    expect(eligibleIds(lv1)).toContain('evt_department_mediation');
    expect(eligibleIds(base)).not.toContain('evt_department_mediation');
    expect(eligibleIds(withTraits(base, { socialSkill: 2 }))).not.toContain('evt_department_mediation');

    const ok = resolve(lv1, 'evt_department_mediation', 'mediate', ALWAYS_SUCCEED);
    expect(ok.state.skills).toEqual({ socialSkill: 2 });
    expect(ok.result.traitChanges).toEqual([
      { kind: 'SKILL', id: 'socialSkill', from: 1, to: 2, reason: 'upgrade' },
    ]);
    // 판정은 강화 전 레벨(Lv.1: +10%p)로 계산 — 새 레벨이 소급되지 않는다
    expect(ok.result.chance).toBe(0.45);

    const fail = resolve(lv1, 'evt_department_mediation', 'mediate', ALWAYS_FAIL);
    expect(fail.state.skills).toEqual({ socialSkill: 1 });
  });

  it('re-acquiring an owned skill never auto-upgrades it', () => {
    const lv1 = withTraits(base, { socialSkill: 1 });
    expect(eligibleIds(lv1)).not.toContain('evt_social_breakthrough');
    // 강제로 열어도 grant 선택지는 from 불일치로 선택 불가
    expect(() => resolve(lv1, 'evt_social_breakthrough', 'resolve_conflict', ALWAYS_SUCCEED)).toThrow(
      EngineError,
    );
  });

  it('the same event branches by current level (crisis: grant at Lv.0, upgrade at Lv.1, routine at Lv.2)', () => {
    expect(visibleChoices(base, 'evt_server_outage')).toEqual(['first_response', 'report_up']);
    expect(visibleChoices(withTraits(base, { crisis: 1 }), 'evt_server_outage')).toEqual([
      'lead_recovery',
      'report_up',
    ]);
    expect(visibleChoices(withTraits(base, { crisis: 2 }), 'evt_server_outage')).toEqual([
      'routine_fix',
      'report_up',
    ]);

    const g = resolve(base, 'evt_server_outage', 'first_response', ALWAYS_SUCCEED);
    expect(g.state.skills).toEqual({ crisis: 1 });
    const u = resolve(g.state, 'evt_server_outage', 'lead_recovery', ALWAYS_SUCCEED);
    expect(u.state.skills).toEqual({ crisis: 2 });
  });

  it('observation: grant and upgrade paths', () => {
    const g = resolve(base, 'evt_document_clue', 'dig_in', ALWAYS_SUCCEED);
    expect(g.state.skills).toEqual({ observation: 1 });
    const u = resolve(
      withTraits(base, { observation: 1 }),
      'evt_document_clue',
      'confirm_pattern',
      ALWAYS_SUCCEED,
    );
    expect(u.state.skills).toEqual({ observation: 2 });
    expect(u.state.flags).toMatchObject([
      { key: 'found_irregularity', scope: 'COMPANY', ownerId: base.employment.current!.companyId },
    ]);
  });

  it('100 successes on a normal event never change skills', () => {
    let s = base;
    for (let i = 0; i < 100; i++) {
      s = resolve(
        { ...s, phase: 'MONTH_START' },
        'evt_office_dinner_crisis',
        'mediate',
        ALWAYS_SUCCEED,
      ).state;
    }
    expect(s.skills).toEqual({});
    expect(s.skillHistory).toEqual([]);
    expect(s.eventOccurrences.filter((o) => o.success)).toHaveLength(100);
  });

  it('a duplicate resolve request cannot grant twice (event already resolved)', () => {
    const once = resolve(base, 'evt_social_breakthrough', 'resolve_conflict', ALWAYS_SUCCEED);
    expect(() => resolveChoice(once.state, 'resolve_conflict', content)).toThrow(
      /not allowed in phase MONTH_SUMMARY/,
    );
    expect(once.state.skillHistory).toHaveLength(1);
  });
});

describe('negative traits: grant / worsen / recover via explicit special events (§4.2.2)', () => {
  it('burnout: 0→1 on risky failure, 1→2 on repeat failure, 2→1 and 1→0 on recovery success', () => {
    const g = resolve(base, 'evt_project_collapse', 'all_nighter', ALWAYS_FAIL);
    expect(g.state.negativeTraits).toEqual({ burnout: 1 });

    const ok = resolve(base, 'evt_project_collapse', 'all_nighter', ALWAYS_SUCCEED);
    expect(ok.state.negativeTraits).toEqual({});

    const w = resolve(
      withTraits(base, {}, { burnout: 1 }),
      'evt_project_collapse',
      'all_nighter_again',
      ALWAYS_FAIL,
    );
    expect(w.state.negativeTraits).toEqual({ burnout: 2 });

    const r1 = resolve(
      withTraits(base, {}, { burnout: 2 }),
      'evt_burnout_recovery',
      'paid_leave_reset',
      ALWAYS_SUCCEED,
    );
    expect(r1.state.negativeTraits).toEqual({ burnout: 1 });
    const r0 = resolve(
      withTraits(base, {}, { burnout: 1 }),
      'evt_burnout_recovery',
      'rebuild_rhythm',
      ALWAYS_SUCCEED,
    );
    expect(r0.state.negativeTraits).toEqual({});
    expect(Object.hasOwn(r0.state.negativeTraits, 'burnout')).toBe(false);

    expect([g, w, r1, r0].map((x) => x.state.traitHistory.at(-1)!.reason)).toEqual([
      'grant',
      'worsen',
      'recover',
      'recover',
    ]);
  });

  it('recovery failure keeps the level; recovery event is only eligible while the trait is held', () => {
    const f = resolve(
      withTraits(base, {}, { burnout: 1 }),
      'evt_burnout_recovery',
      'rebuild_rhythm',
      ALWAYS_FAIL,
    );
    expect(f.state.negativeTraits).toEqual({ burnout: 1 });
    expect(eligibleIds(base)).not.toContain('evt_burnout_recovery');
    expect(eligibleIds(withTraits(base, {}, { burnout: 1 }))).toContain('evt_burnout_recovery');
  });

  it('officeStigma: grant via public blame failure, worsen, then 2→1 and 1→0', () => {
    const boss = base.npcs.find((n) => n.role === 'BOSS')!;
    const badBoss = {
      ...base,
      npcs: base.npcs.map((n) =>
        n.npcId === boss.npcId ? { ...n, personalityTags: ['CREDIT_STEALER'] } : n,
      ),
    };
    const g = resolveChoice(
      open(badBoss, 'evt_public_blame', { participantNpcId: boss.npcId, rng: ALWAYS_FAIL }),
      'confront',
      content,
    );
    expect(g.state.negativeTraits).toEqual({ officeStigma: 1 });
    expect(g.state.flags).toMatchObject([{ key: 'blamed_by_boss', scope: 'NPC', ownerId: boss.npcId }]);
    const npcAfter = g.state.npcs.find((n) => n.npcId === boss.npcId)!;
    expect(npcAfter.favor).toBe(Math.max(0, boss.favor - 10));
    expect(npcAfter.memoryFlags).toContain('blamed_by_boss');

    const w = resolveChoice(
      open({ ...g.state, phase: 'MONTH_START' }, 'evt_public_blame', {
        participantNpcId: boss.npcId,
        rng: ALWAYS_FAIL,
      }),
      'confront_again',
      content,
    );
    expect(w.state.negativeTraits).toEqual({ officeStigma: 2 });

    const r1 = resolve(
      withTraits(base, {}, { officeStigma: 2 }),
      'evt_clear_reputation',
      'present_evidence',
      ALWAYS_SUCCEED,
    );
    expect(r1.state.negativeTraits).toEqual({ officeStigma: 1 });
    const r0 = resolve(
      withTraits(base, {}, { officeStigma: 1 }),
      'evt_clear_reputation',
      'official_restoration',
      ALWAYS_SUCCEED,
    );
    expect(r0.state.negativeTraits).toEqual({});
  });

  it('Lv.1 passive effect: burnout reduces rest recovery (quiet month +6 → +1)', () => {
    const low = { ...base, resources: { ...base.resources, health: 50 } };
    const plain = resolve(low, 'evt_quiet_month', 'rest', ALWAYS_SUCCEED);
    const burned = resolve(withTraits(low, {}, { burnout: 1 }), 'evt_quiet_month', 'rest', ALWAYS_SUCCEED);
    expect(plain.state.resources.health).toBe(56);
    expect(burned.state.resources.health).toBe(51);
  });

  it('positive and negative traits coexist and each applies only its own declared effect', () => {
    const s = withTraits(base, { crisis: 1 }, { burnout: 2 });
    expect(chanceOf(s, 'evt_project_collapse', 'ask_help')).toBe(0.65);
    expect(chanceOf(s, 'evt_project_collapse', 'push_through')).toBe(0.35);
  });

  it('a level mismatch aborts the whole effect list atomically', () => {
    const draft = JSON.parse(JSON.stringify(base)) as GameRunState;
    const before = JSON.stringify(base);
    expect(() =>
      applyEffects(
        draft,
        [
          { type: 'RESOURCE_DELTA', key: 'mental', amount: -5 },
          { type: 'NEGATIVE_TRAIT_SET_LEVEL', id: 'burnout', from: 1, to: 2 },
        ],
        { eventId: 'evt_project_collapse', occurrenceId: 'occ_x', participantNpcId: null },
      ),
    ).toThrow(/expected Lv.1/);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('NPC event integration (§8.3)', () => {
  const boss = base.npcs.find((n) => n.role === 'BOSS')!;
  const peer = base.npcs.find((n) => n.role === 'PEER')!;
  const withBossTags = (tags: string[]) => ({
    ...base,
    npcs: base.npcs.map((n) => (n.npcId === boss.npcId ? { ...n, personalityTags: tags } : n)),
  });

  it('boss-personality events appear only for matching bosses', () => {
    expect(eligibleIds(withBossTags(['MENTOR']))).toContain('evt_boss_code_review');
    expect(eligibleIds(withBossTags(['MENTOR']))).not.toContain('evt_public_blame');
    expect(eligibleIds(withBossTags(['AUTHORITARIAN']))).toContain('evt_public_blame');
    expect(eligibleIds(withBossTags(['AUTHORITARIAN']))).not.toContain('evt_boss_code_review');
  });

  it('NPC personality changes event weight', () => {
    const w = (s: GameRunState) =>
      getEligibleEvents(s, content).find((c) => c.event.id === 'evt_public_blame')!.weight;
    expect(w(withBossTags(['AUTHORITARIAN']))).toBe(20);
    expect(w(withBossTags(['CREDIT_STEALER']))).toBe(10);
  });

  it('NPC modifiers apply only to the participating NPC with matching traits', () => {
    const mentor = withBossTags(['MENTOR']);
    const c = choice('evt_boss_code_review', 'accept_feedback');
    const p = mentor.npcs.find((n) => n.npcId === boss.npcId)!;
    expect(calculateChoiceChance(mentor, c, { participant: p }, content)!.chance).toBe(0.8);
    expect(calculateChoiceChance(mentor, c, { participant: null }, content)!.chance).toBe(0.7);
  });

  it('relation threshold unlocks a choice (trust ≥ 70) and relation deltas persist on the NPC', () => {
    const lowTrust = {
      ...base,
      npcs: base.npcs.map((n) => (n.npcId === peer.npcId ? { ...n, trust: 50 } : n)),
    };
    const highTrust = {
      ...base,
      npcs: base.npcs.map((n) => (n.npcId === peer.npcId ? { ...n, trust: 75 } : n)),
    };
    const swap = (s: GameRunState) =>
      evaluateChoices(
        s,
        event('evt_peer_help_request'),
        s.npcs.find((n) => n.npcId === peer.npcId)!,
        content,
      ).find((x) => x.choice.id === 'swap_tasks')!.enabled;
    expect(swap(lowTrust)).toBe(false);
    expect(swap(highTrust)).toBe(true);

    const helped = resolveChoice(
      open(lowTrust, 'evt_peer_help_request', { participantNpcId: peer.npcId, rng: ALWAYS_SUCCEED }),
      'help',
      content,
    );
    const after = helped.state.npcs.find((n) => n.npcId === peer.npcId)!;
    expect(after.trust).toBe(58);
    expect(after.relationshipHistory.map((h) => h.stat)).toEqual(['trust', 'favor']);
  });

  it('crisis Lv.1 reduces failure damage in the peer blame event (conditional effect)', () => {
    const competitive = {
      ...base,
      npcs: base.npcs.map((n) => (n.npcId === peer.npcId ? { ...n, personalityTags: ['COMPETITIVE'] } : n)),
    };
    const m = (s: GameRunState) =>
      resolveChoice(
        open(s, 'evt_peer_blame_shift', { participantNpcId: peer.npcId, rng: ALWAYS_FAIL }),
        'defend',
        content,
      ).state.resources.mental;
    const start = competitive.resources.mental;
    expect(m(competitive)).toBe(Math.max(0, start - 10));
    expect(m(withTraits(competitive, { crisis: 1 }))).toBe(Math.max(0, start - 5));
  });
});

describe('event safety rails (§21.3)', () => {
  it('unemployed state gets no candidates (fallback quiet month is used by selection)', () => {
    const unemployed = {
      ...base,
      employment: { status: 'UNEMPLOYED' as const, current: null, jobLoss: null },
    };
    expect(eligibleIds(unemployed)).toEqual([]);
  });

  it('cooldown blocks a repeat within the window', () => {
    const done = resolve(base, 'evt_office_dinner_crisis', 'leave_early', ALWAYS_SUCCEED).state;
    expect(eligibleIds({ ...done, turnIndex: done.turnIndex + 3 })).not.toContain('evt_office_dinner_crisis');
    expect(eligibleIds({ ...done, turnIndex: done.turnIndex + 4 })).toContain('evt_office_dinner_crisis');
  });

  it('after 2 consecutive high-risk events, high-risk events are excluded', () => {
    const streak = { ...base, statistics: { ...base.statistics, consecutiveHighRiskMonths: 2 } };
    const ids = eligibleIds(streak);
    expect(ids).not.toContain('evt_server_outage');
    expect(ids).not.toContain('evt_project_collapse');
    expect(ids).toContain('evt_office_dinner_crisis');
  });
});
