import {
  COMPANY_GRADES,
  ContentPackSchema,
  type Conditions,
  type ContentPack,
  type Effect,
  type EventDefinition,
} from '@company-life/shared';

export interface ContentIssue {
  path: string;
  message: string;
}

/**
 * 스키마 검증 이후의 참조/정합성 검증 (§21.1, §23.2 게시 전 검증, §23.4 운영 게이트).
 * - 존재하지 않는 특성·성향·배경·후속 이벤트 ID
 * - 특성 극성 불일치(SKILL 효과가 부정 특성을 가리키는 등), 비활성 특성 사용, 최대 레벨 초과
 * - 무한 후속 예약 루프, 폴백 이벤트의 항상-선택 가능성
 * - 활성 특성의 레벨 전이 경로 존재 (긍정 0→1·1→2 / 부정 0→1·1→2·2→1·1→0)
 */
export function validateContentReferences(pack: ContentPack): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const traits = new Map(pack.traits.map((t) => [t.id, t]));
  const personalities = new Map(pack.npcPersonalities.map((p) => [p.id, p]));
  const backgrounds = new Set(pack.backgroundTraits.map((b) => b.id));
  const eventIds = new Set<string>();

  const checkUnique = (ids: string[], label: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add(label, `중복 ID: ${id}`);
      seen.add(id);
    }
  };
  checkUnique(
    pack.traits.map((t) => t.id),
    'traits',
  );
  checkUnique(
    pack.backgroundTraits.map((b) => b.id),
    'backgroundTraits',
  );
  checkUnique(
    pack.companies.map((c) => c.id),
    'companies',
  );
  checkUnique(
    pack.npcPersonalities.map((p) => p.id),
    'npcPersonalities',
  );
  checkUnique(
    pack.events.map((e) => e.id),
    'events',
  );
  pack.events.forEach((e) => eventIds.add(e.id));

  for (const t of pack.traits) {
    if (t.maxLevel > pack.rules.maxTraitLevel) add(`traits.${t.id}`, `maxLevel ${t.maxLevel} > 규칙 상한`);
  }
  for (const kind of ['UNIVERSITY', 'MAJOR', 'FAMILY', 'STRENGTH', 'WEAKNESS'] as const) {
    if (pack.backgroundTraits.filter((b) => b.kind === kind).length < 3)
      add('backgroundTraits', `${kind} 3개 이상 필요`);
  }
  for (const grade of COMPANY_GRADES) {
    if (pack.companies.filter((c) => c.grade === grade).length < 2)
      add('companies', `${grade}등급 회사 2개 이상 필요`);
  }
  for (const [ti, tier] of pack.rules.hiring.offerTiers.entries()) {
    if (!pack.companies.some((c) => tier.includes(c.grade)))
      add(`rules.hiring.offerTiers[${ti}]`, '해당 등급 회사 없음');
  }
  if (!pack.rules.hiring.offerTiers[2]?.every((g) => g === 'D' || g === 'F')) {
    add('rules.hiring.offerTiers[2]', '3번째 지원 카드는 F~D 대안이어야 함 (§20.2)');
  }
  for (const role of ['BOSS', 'PEER'] as const) {
    for (const polarity of ['GOOD', 'BAD'] as const) {
      if (!pack.npcPersonalities.some((p) => p.role === role && p.polarity === polarity)) {
        add('npcPersonalities', `${role} ${polarity} 성향이 최소 1개 필요 (§8.1)`);
      }
    }
  }
  for (const [tag, bonuses] of Object.entries(pack.npcGeneration.cultureWeightBonus)) {
    for (const id of Object.keys(bonuses)) {
      if (!personalities.has(id)) add(`npcGeneration.cultureWeightBonus.${tag}`, `알 수 없는 성향: ${id}`);
    }
  }

  const traitRef = (path: string, id: string, polarity: 'POSITIVE' | 'NEGATIVE') => {
    const t = traits.get(id);
    if (!t) add(path, `알 수 없는 특성: ${id}`);
    else if (t.polarity !== polarity) add(path, `특성 ${id}는 ${t.polarity}`);
    return t;
  };
  const personalityRefs = (path: string, ids: readonly string[] | undefined) =>
    ids?.forEach((id) => personalities.has(id) || add(path, `알 수 없는 NPC 성향: ${id}`));

  const checkConditions = (path: string, c: Conditions | undefined) => {
    if (!c) return;
    c.skillAbsent?.forEach((id) => traitRef(path, id, 'POSITIVE'));
    Object.keys(c.skillLevels ?? {}).forEach((id) => traitRef(path, id, 'POSITIVE'));
    c.negativeTraitAbsent?.forEach((id) => traitRef(path, id, 'NEGATIVE'));
    Object.keys(c.negativeTraitLevels ?? {}).forEach((id) => traitRef(path, id, 'NEGATIVE'));
    c.backgroundTraitsAny?.forEach((id) => backgrounds.has(id) || add(path, `알 수 없는 배경 특성: ${id}`));
    personalityRefs(path, c.npc?.personalityAny);
  };

  const transitions = new Map<string, Set<string>>();
  const scheduleEdges = new Map<string, string[]>();

  const checkEffects = (path: string, event: EventDefinition, effects: readonly Effect[]) => {
    effects.forEach((e, i) => {
      const p = `${path}[${i}]`;
      if (e.type === 'SKILL_SET_LEVEL' || e.type === 'NEGATIVE_TRAIT_SET_LEVEL') {
        const t = traitRef(p, e.id, e.type === 'SKILL_SET_LEVEL' ? 'POSITIVE' : 'NEGATIVE');
        if (t && !t.active) add(p, `비활성 특성 ${e.id}는 획득/변경 효과에 사용할 수 없음 (§22.2)`);
        if (t && Math.max(e.from, e.to) > t.maxLevel) add(p, `특성 ${e.id} 최대 레벨 초과`);
        const set = transitions.get(e.id) ?? new Set<string>();
        set.add(`${e.from}>${e.to}`);
        transitions.set(e.id, set);
      }
      if (e.type === 'SCHEDULE_EVENT') {
        if (!eventIds.has(e.eventId)) add(p, `알 수 없는 후속 이벤트: ${e.eventId}`);
        scheduleEdges.set(event.id, [...(scheduleEdges.get(event.id) ?? []), e.eventId]);
      }
    });
  };

  for (const event of pack.events) {
    const base = `events.${event.id}`;
    checkConditions(`${base}.conditions`, event.conditions);
    event.npcWeightModifiers?.forEach((m, i) =>
      personalityRefs(`${base}.npcWeightModifiers[${i}]`, m.personalityAny),
    );
    for (const choice of event.choices) {
      const cp = `${base}.choices.${choice.id}`;
      checkConditions(`${cp}.visibleIf`, choice.visibleIf);
      checkConditions(`${cp}.enabledIf`, choice.enabledIf);
      for (const m of choice.outcome?.modifiers ?? []) {
        if (m.source === 'SKILL') traitRef(`${cp}.outcome`, m.id, 'POSITIVE');
        if (m.source === 'NEGATIVE_TRAIT') traitRef(`${cp}.outcome`, m.id, 'NEGATIVE');
        if (m.source === 'NPC') personalityRefs(`${cp}.outcome`, m.personalityAny);
        if (m.source === 'BACKGROUND' && !backgrounds.has(m.id))
          add(`${cp}.outcome`, `알 수 없는 배경 특성: ${m.id}`);
      }
      checkEffects(`${cp}.guaranteedEffects`, event, choice.guaranteedEffects ?? []);
      checkEffects(`${cp}.onSuccess`, event, choice.onSuccess?.effects ?? []);
      checkEffects(`${cp}.onFailure`, event, choice.onFailure?.effects ?? []);
      (choice.conditionalEffects ?? []).forEach((ce, i) => {
        checkConditions(`${cp}.conditionalEffects[${i}].when`, ce.when);
        checkEffects(`${cp}.conditionalEffects[${i}]`, event, ce.effects);
      });
    }
  }

  // 무한 후속 예약 루프 차단 (§21.3)
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      add('events', `무한 후속 예약 루프: ${[...trail, id].join(' → ')}`);
      return;
    }
    visiting.add(id);
    for (const next of scheduleEdges.get(id) ?? []) dfs(next, [...trail, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of scheduleEdges.keys()) dfs(id, []);

  // 폴백 이벤트: 조건 없이 항상 선택 가능한 선택지가 있어야 한다 (§21.3)
  const fallback = pack.events.find((e) => e.id === pack.fallbackEventId);
  if (!fallback) {
    add('fallbackEventId', `폴백 이벤트 없음: ${pack.fallbackEventId}`);
  } else {
    if (fallback.status !== 'published') add('fallbackEventId', '폴백 이벤트는 published여야 함');
    if (fallback.conditions && Object.keys(fallback.conditions).length > 0)
      add('fallbackEventId', '폴백 이벤트는 조건이 없어야 함');
    const safe = fallback.choices.some(
      (c) =>
        !c.visibleIf &&
        !c.enabledIf &&
        !c.outcome &&
        !(c.guaranteedEffects ?? []).some(
          (e) => e.type === 'SKILL_SET_LEVEL' || e.type === 'NEGATIVE_TRAIT_SET_LEVEL',
        ),
    );
    if (!safe) add('fallbackEventId', '폴백 이벤트에 무조건 선택 가능한 선택지가 필요');
  }

  // §26.5 실직 이벤트: 경고 플래그 선행 + 그 플래그를 세우는 다른 이벤트 + 회피 선택지
  const flagSetters = new Map<string, Set<string>>(); // "scope:key" → 세우는 이벤트 ID들
  for (const event of pack.events) {
    for (const choice of event.choices) {
      const all = [
        ...(choice.guaranteedEffects ?? []),
        ...(choice.onSuccess?.effects ?? []),
        ...(choice.onFailure?.effects ?? []),
        ...(choice.conditionalEffects ?? []).flatMap((ce) => ce.effects),
      ];
      for (const e of all) {
        if (e.type === 'FLAG_SET') {
          const k = `${e.scope}:${e.key}`;
          flagSetters.set(k, (flagSetters.get(k) ?? new Set()).add(event.id));
        }
      }
    }
  }
  for (const event of pack.events) {
    const causesJobLoss = event.choices.some((c) =>
      [...(c.guaranteedEffects ?? []), ...(c.onSuccess?.effects ?? []), ...(c.onFailure?.effects ?? [])].some(
        (e) => e.type === 'EMPLOYMENT_CHANGE',
      ),
    );
    if (!causesJobLoss) continue;
    const base = `events.${event.id}`;
    const warnings = event.conditions?.flagsAll ?? [];
    const hasWarning = warnings.some((f) =>
      [...(flagSetters.get(`${f.scope}:${f.key}`) ?? [])].some((setter) => setter !== event.id),
    );
    if (!hasWarning) {
      add(base, '실직 이벤트는 다른 이벤트가 세우는 경고 플래그를 conditions.flagsAll로 요구해야 함 (§26.5)');
    }
    // 회피 수단: 조건 없이 고를 수 있고, 성공·실패 어느 결과로도 실직하지 않는 선택지
    const avoidable = event.choices.some(
      (c) =>
        !c.visibleIf &&
        !c.enabledIf &&
        ![
          ...(c.guaranteedEffects ?? []),
          ...(c.onSuccess?.effects ?? []),
          ...(c.onFailure?.effects ?? []),
        ].some((e) => e.type === 'EMPLOYMENT_CHANGE'),
    );
    if (!avoidable) {
      add(base, '실직 이벤트에는 조건 없이 고를 수 있고 어떤 결과로도 실직하지 않는 선택지가 필요 (§26.5)');
    }
  }

  // 예약 전용 사건은 반드시 어떤 사건이 SCHEDULE_EVENT로 예약해야 한다 (고아 콘텐츠 방지)
  const scheduledTargets = new Set([...scheduleEdges.values()].flat());
  for (const event of pack.events.filter((e) => e.scheduledOnly)) {
    if (!scheduledTargets.has(event.id))
      add(`events.${event.id}`, 'scheduledOnly 사건을 예약하는 사건이 없음');
  }
  for (const id of Object.keys(pack.rules.annualReview.traitAdjustments)) {
    if (!traits.has(id)) add('rules.annualReview.traitAdjustments', `알 수 없는 특성: ${id}`);
  }

  // 엔딩 문구 변형의 조건 참조
  for (const [cause, def] of Object.entries(pack.endings.causes)) {
    def.variants?.forEach((v, i) => checkConditions(`endings.causes.${cause}.variants[${i}]`, v.when));
  }
  pack.endings.earlyRetirement.variants?.forEach((v, i) =>
    checkConditions(`endings.earlyRetirement.variants[${i}]`, v.when),
  );
  if (!pack.companies.some((c) => c.grade === pack.rules.hiring.firstJobGuaranteedGrade)) {
    add('rules.hiring.firstJobGuaranteedGrade', '첫 구직 확정 등급 회사가 없음');
  }

  // 활성 특성은 모든 레벨 전이 경로가 데이터에 존재해야 한다 (Phase 1 게이트)
  for (const t of pack.traits.filter((x) => x.active)) {
    const required = t.polarity === 'POSITIVE' ? ['0>1', '1>2'] : ['0>1', '1>2', '2>1', '1>0'];
    const have = transitions.get(t.id) ?? new Set<string>();
    for (const r of required) {
      if (!have.has(r)) add(`traits.${t.id}`, `활성 특성의 레벨 전이 ${r.replace('>', '→')} 경로가 없음`);
    }
  }

  return issues;
}

export type ContentValidationResult = { ok: true; pack: ContentPack } | { ok: false; issues: ContentIssue[] };

/** 스키마 + 참조 검증. 관리자 게시 검증과 서버 로더가 같은 함수를 쓴다. */
export function validateContentPack(raw: unknown): ContentValidationResult {
  const parsed = ContentPackSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const issues = validateContentReferences(parsed.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, pack: parsed.data };
}
