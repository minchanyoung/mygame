import { describe, expect, it } from 'vitest';
import { loadContentPack, rawContentPack, validateContentPack } from './index';

type Raw = {
  events: Array<Record<string, unknown> & { id: string; choices: Array<Record<string, unknown>> }>;
  traits: Array<{ id: string; active: boolean }>;
  fallbackEventId: string;
};
const raw = () => rawContentPack() as Raw;
const issues = (pack: unknown) => {
  const r = validateContentPack(pack);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
};

describe('content pack', () => {
  it('loads and validates the shipped Phase 1 content', () => {
    const pack = loadContentPack();
    expect(pack.traits.filter((t) => t.polarity === 'POSITIVE')).toHaveLength(6);
    expect(pack.traits.filter((t) => t.polarity === 'NEGATIVE')).toHaveLength(6);
    expect(
      pack.traits
        .filter((t) => t.active)
        .map((t) => t.id)
        .sort(),
    ).toEqual(['burnout', 'crisis', 'observation', 'officeStigma', 'socialSkill']);
    expect(pack.backgroundTraits.length).toBeGreaterThanOrEqual(20);
  });

  it('rejects using an inactive (undiscoverable) trait in an effect', () => {
    const p = raw();
    p.traits.find((t) => t.id === 'crisis')!.active = false;
    expect(issues(p).join('\n')).toMatch(/비활성 특성 crisis/);
  });

  it('rejects unknown trait references and polarity mismatches', () => {
    const p = raw();
    const evt = p.events.find((e) => e.id === 'evt_office_dinner_crisis')!;
    (evt.choices[0]!['outcome'] as { modifiers: unknown[] }).modifiers.push({
      source: 'SKILL',
      id: 'burnout',
      levels: { '1': 0.1 },
    });
    (evt.choices[0]!['outcome'] as { modifiers: unknown[] }).modifiers.push({
      source: 'SKILL',
      id: 'telepathy',
      levels: { '1': 0.1 },
    });
    const out = issues(p).join('\n');
    expect(out).toMatch(/특성 burnout는 NEGATIVE/);
    expect(out).toMatch(/알 수 없는 특성: telepathy/);
  });

  it('rejects infinite follow-up schedule loops and unknown follow-ups', () => {
    const p = raw();
    const a = p.events.find((e) => e.id === 'evt_boss_code_review')!;
    const b = p.events.find((e) => e.id === 'evt_peer_help_request')!;
    (a.choices[1]!['guaranteedEffects'] as unknown[]).push({
      type: 'SCHEDULE_EVENT',
      eventId: b.id,
      delayMonths: 1,
    });
    (b.choices[2]!['guaranteedEffects'] as unknown[]).push({
      type: 'SCHEDULE_EVENT',
      eventId: a.id,
      delayMonths: 1,
    });
    (b.choices[2]!['guaranteedEffects'] as unknown[]).push({
      type: 'SCHEDULE_EVENT',
      eventId: 'evt_ghost',
      delayMonths: 1,
    });
    const out = issues(p).join('\n');
    expect(out).toMatch(/무한 후속 예약 루프/);
    expect(out).toMatch(/알 수 없는 후속 이벤트: evt_ghost/);
  });

  it('requires a safe fallback event', () => {
    const p = raw();
    p.fallbackEventId = 'evt_missing';
    expect(issues(p).join('\n')).toMatch(/폴백 이벤트 없음/);
  });

  it('rejects job-loss events without a prior warning flag set by another event (§26.5)', () => {
    const p = raw();
    const list = p.events.find((e) => e.id === 'evt_restructuring_list')!;
    delete (list['conditions'] as Record<string, unknown>)['flagsAll'];
    expect(issues(p).join('\n')).toMatch(
      /evt_restructuring_list: 실직 이벤트는 다른 이벤트가 세우는 경고 플래그/,
    );

    const p2 = raw();
    p2.events = p2.events.filter((e) => e.id !== 'evt_restructuring_rumor');
    expect(issues(p2).join('\n')).toMatch(/경고 플래그/);
  });

  it('rejects job-loss events without an unconditional, non-fatal choice (§26.5)', () => {
    const p = raw();
    const list = p.events.find((e) => e.id === 'evt_restructuring_list')!;
    list.choices = list.choices.filter((c) => c['id'] !== 'accept_transfer');
    expect(issues(p).join('\n')).toMatch(/어떤 결과로도 실직하지 않는 선택지가 필요/);
  });

  it('rejects voluntary resignation (no such reason exists) (§26.1)', () => {
    const p = raw();
    const list = p.events.find((e) => e.id === 'evt_restructuring_list')!;
    (list.choices[0]!['onFailure'] as { effects: unknown[] }).effects = [
      { type: 'EMPLOYMENT_CHANGE', status: 'UNEMPLOYED', reason: 'VOLUNTARY' },
    ];
    expect(issues(p).length).toBeGreaterThan(0);
  });

  it('rejects scheduledOnly events that nothing schedules (orphan follow-ups)', () => {
    const p = raw();
    for (const e of p.events) {
      for (const c of e.choices) {
        const g = c['guaranteedEffects'] as Array<{ type: string; eventId?: string }> | undefined;
        if (g) c['guaranteedEffects'] = g.filter((x) => x.eventId !== 'evt_tech_debt_return');
      }
    }
    expect(issues(p).join('\n')).toMatch(/evt_tech_debt_return: scheduledOnly 사건을 예약하는 사건이 없음/);
  });

  it('requires every active trait to have all level transition paths', () => {
    const p = raw();
    // 극복 루트가 2개(멈춰 선 주말, 뜻밖의 취미)이므로 둘 다 지워야 경로가 사라진다
    p.events = p.events.filter((e) => e.id !== 'evt_burnout_recovery' && e.id !== 'evt_hobby_found');
    const out = issues(p).join('\n');
    expect(out).toMatch(/burnout: 활성 특성의 레벨 전이 2→1/);
    expect(out).toMatch(/burnout: 활성 특성의 레벨 전이 1→0/);
  });
  it('S13: rejects job one-shot events with free reputation or deep failure losses', () => {
    const p = raw();
    const ev = p.events.find((e) => e.id === 'evt_fin_budget_cut')!;
    const cut = ev.choices.find((c) => c.id === 'cut_own')!;
    cut.guaranteedEffects = [{ type: 'RESOURCE_DELTA', key: 'reputation', amount: 6 }];
    const kpi = p.events.find((e) => e.id === 'evt_plan_kpi')!;
    const amb = kpi.choices.find((c) => c.id === 'ambitious')! as { onFailure: { effects: unknown[] } };
    amb.onFailure.effects = [{ type: 'RESOURCE_DELTA', key: 'reputation', amount: -12 }];
    const out = issues(p).join('\n');
    expect(out).toMatch(/evt_fin_budget_cut\.cut_own: 직무 사건의 확정 평판 \+6/);
    expect(out).toMatch(/evt_plan_kpi\.ambitious: 직무 사건의 실패 평판 -12 \(하한 -8\)/);
  });

  it('S13: title choice counts must point at real choices', () => {
    const p = raw() as Raw & { titles: Array<{ id: string; rule: Record<string, unknown> }> };
    const t = p.titles.find((x) => x.id === 'title_networker')!;
    t.rule = { choiceCount: { picks: [{ eventId: 'evt_life_industry_meetup', choiceId: 'nope' }], min: 2 } };
    expect(issues(p).join('\n')).toMatch(/evt_life_industry_meetup에 없는 선택지: nope/);
  });
});
