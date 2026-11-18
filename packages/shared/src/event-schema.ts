import { z } from 'zod';
import {
  CompanyGradeSchema,
  ContentIdSchema,
  EmploymentStatusSchema,
  EventCategorySchema,
  EventIdSchema,
  EventStatusSchema,
  FlagScopeSchema,
  JobIdSchema,
  JobLossReasonSchema,
  NpcRelationStatSchema,
  NpcRoleSchema,
  PlayerRankSchema,
  RaritySchema,
  ResourceKeySchema,
} from './enums';

/**
 * §23.2 이벤트 표준 스키마. 조건·효과는 모두 선언형 데이터이며 eval 없이 엔진이 해석한다.
 * 확률/보너스 단위는 0~1 범위의 %p(0.10 = +10%p). 배수(percent) 표현은 쓰지 않는다.
 */

const Probability = z.number().min(0).max(1);
const Bonus = z.number().min(-1).max(1);
const ChoiceIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

export const IntRangeSchema = z
  .object({ min: z.number().int().optional(), max: z.number().int().optional() })
  .strict()
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, 'min은 max 이하');
export type IntRange = z.infer<typeof IntRangeSchema>;

const LevelBound = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const LevelRangeSchema = z
  .object({ min: LevelBound.optional(), max: LevelBound.optional() })
  .strict()
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, 'min은 max 이하');
export type LevelRange = z.infer<typeof LevelRangeSchema>;

/** 이벤트에 참여하는 NPC를 지정하는 조건. 일치하는 활성 NPC가 사건의 참여자(participant)가 된다. */
export const NpcConditionSchema = z
  .object({
    role: NpcRoleSchema,
    personalityAny: z.array(ContentIdSchema).min(1).optional(),
    relation: z.partialRecord(NpcRelationStatSchema, IntRangeSchema).optional(),
  })
  .strict();
export type NpcCondition = z.infer<typeof NpcConditionSchema>;

export const FlagRefSchema = z.object({ key: ContentIdSchema, scope: FlagScopeSchema }).strict();
export type FlagRef = z.infer<typeof FlagRefSchema>;

export const ConditionsSchema = z
  .object({
    employment: z.union([EmploymentStatusSchema, z.array(EmploymentStatusSchema).min(1)]).optional(),
    age: IntRangeSchema.optional(),
    /** 현재 회사 재직 개월 수 (입사 턴 기준) */
    tenureMonths: IntRangeSchema.optional(),
    /** S8 진행 중인 연재가 없을 때만 (동시에 한 편) */
    seriesNone: z.literal(true).optional(),
    /** S7 지금까지 이직 횟수 */
    transfers: IntRangeSchema.optional(),
    companyGrades: z.array(CompanyGradeSchema).min(1).optional(),
    jobs: z.array(JobIdSchema).min(1).optional(),
    ranks: z.array(PlayerRankSchema).min(1).optional(),
    resources: z.partialRecord(ResourceKeySchema, IntRangeSchema).optional(),
    /** 원화 정수 범위 */
    cash: IntRangeSchema.optional(),
    debt: IntRangeSchema.optional(),
    /** 해당 긍정 능력이 모두 미보유일 때만 */
    skillAbsent: z.array(ContentIdSchema).optional(),
    skillLevels: z.record(ContentIdSchema, LevelRangeSchema).optional(),
    negativeTraitAbsent: z.array(ContentIdSchema).optional(),
    negativeTraitLevels: z.record(ContentIdSchema, LevelRangeSchema).optional(),
    backgroundTraitsAny: z.array(ContentIdSchema).min(1).optional(),
    flagsAll: z.array(FlagRefSchema).optional(),
    flagsNone: z.array(FlagRefSchema).optional(),
    npc: NpcConditionSchema.optional(),
  })
  .strict();
export type Conditions = z.infer<typeof ConditionsSchema>;

const LevelBonusesSchema = z
  .object({ '1': Bonus.optional(), '2': Bonus.optional() })
  .strict()
  .refine((l) => l['1'] !== undefined || l['2'] !== undefined, '최소 1개 레벨 보너스 필요');

/**
 * 확률 보정. SKILL/NEGATIVE_TRAIT의 levels는 누적이 아닌 치환형:
 * 보유 레벨 이하에서 가장 높은 정의된 레벨의 값 1개만 적용한다 (§7.5, §23.2).
 */
export const ModifierSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('SKILL'), id: ContentIdSchema, levels: LevelBonusesSchema }).strict(),
  z.object({ source: z.literal('NEGATIVE_TRAIT'), id: ContentIdSchema, levels: LevelBonusesSchema }).strict(),
  z
    .object({
      source: z.literal('NPC'),
      /** 참여 NPC에게만 적용 (§8.3-3). */
      personalityAny: z.array(ContentIdSchema).min(1).optional(),
      relation: z.partialRecord(NpcRelationStatSchema, IntRangeSchema).optional(),
      bonus: Bonus,
      label: z.string().max(40).optional(),
    })
    .strict(),
  z.object({ source: z.literal('BACKGROUND'), id: ContentIdSchema, bonus: Bonus }).strict(),
  z
    .object({
      source: z.literal('RESOURCE'),
      key: ResourceKeySchema,
      range: IntRangeSchema,
      bonus: Bonus,
    })
    .strict(),
]);
export type Modifier = z.infer<typeof ModifierSchema>;

const NEGATIVE_TRAIT_TRANSITIONS = new Set(['0>1', '1>2', '2>1', '1>0']);

export const EffectSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('RESOURCE_DELTA'),
      key: ResourceKeySchema,
      amount: z.number().int().min(-100).max(100),
    })
    .strict(),
  z.object({ type: z.literal('CASH_DELTA'), amount: z.number().int() }).strict(),
  z.object({ type: z.literal('DEBT_DELTA'), amount: z.number().int() }).strict(),
  /** 현 연봉 기준 N개월치 현금 (위로금·성과급 등). 물가 지수는 곱하지 않는다. */
  z.object({ type: z.literal('SALARY_MONTHS'), months: z.number().int().min(1).max(60) }).strict(),
  /** S7 이직 제안서 생성 (그달 결산에서 수락/거절). 지금보다 높은 등급 회사 */
  z.object({ type: z.literal('TRANSFER_OFFER') }).strict(),
  /** S7 카운터 오퍼: 현 연봉 ‰ 인상 */
  z.object({ type: z.literal('COUNTER_OFFER'), raisePermille: z.number().int().min(1).max(500) }).strict(),
  /** S7 임원 승진 확정 → '별을 달다' 정상 엔딩 */
  z.object({ type: z.literal('EXECUTIVE_PROMOTION') }).strict(),
  /** S5 승진 포인트 증감 (현 직급, 0 미만으로 내려가지 않음) */
  z.object({ type: z.literal('PROMOTION_POINT_DELTA'), amount: z.number().int().min(-5).max(5) }).strict(),
  z
    .object({
      type: z.literal('SKILL_SET_LEVEL'),
      id: ContentIdSchema,
      from: z.union([z.literal(0), z.literal(1)]),
      to: z.union([z.literal(1), z.literal(2)]),
    })
    .strict()
    .refine((e) => e.to === e.from + 1, 'SKILL_SET_LEVEL은 0→1 또는 1→2만 허용'),
  z
    .object({
      type: z.literal('NEGATIVE_TRAIT_SET_LEVEL'),
      id: ContentIdSchema,
      from: LevelBound,
      to: LevelBound,
    })
    .strict()
    .refine(
      (e) => NEGATIVE_TRAIT_TRANSITIONS.has(`${e.from}>${e.to}`),
      'NEGATIVE_TRAIT_SET_LEVEL은 0→1, 1→2, 2→1, 1→0만 허용',
    ),
  z
    .object({
      type: z.literal('NPC_RELATION_DELTA'),
      target: z.enum(['PARTICIPANT', 'BOSS', 'PEERS']),
      stat: NpcRelationStatSchema,
      amount: z.number().int().min(-100).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('FLAG_SET'),
      key: ContentIdSchema,
      scope: FlagScopeSchema,
      value: z.union([z.boolean(), z.number(), z.string()]).optional(),
      expiresInMonths: z.number().int().min(1).max(600).optional(),
    })
    .strict()
    .refine(
      (e) => e.scope !== 'TEMPORARY' || e.expiresInMonths !== undefined,
      'TEMPORARY 플래그는 만료 필수',
    ),
  z.object({ type: z.literal('FLAG_CLEAR'), key: ContentIdSchema, scope: FlagScopeSchema }).strict(),
  z
    .object({
      type: z.literal('SCHEDULE_EVENT'),
      eventId: EventIdSchema,
      delayMonths: z.number().int().min(1).max(36),
      priority: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  /** §26.5 비자발적 실직만 표현한다. 50세 전이면 게임오버로 이어진다. */
  z
    .object({
      type: z.literal('EMPLOYMENT_CHANGE'),
      status: z.literal('UNEMPLOYED'),
      reason: JobLossReasonSchema,
    })
    .strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];

const EffectListSchema = z.array(EffectSchema).max(12);

/**
 * 사내 메신저 대사 한 줄. 화자는 역할로 지정하고 이름은 화면에서 실제 NPC로 채운다.
 * 본문에는 {me} {boss} {peer} {company} 자리표시자를 쓸 수 있다.
 */
export const DialogueLineSchema = z
  .object({
    speaker: z.enum(['BOSS', 'PEER', 'PARTICIPANT', 'SELF', 'SYSTEM', 'NARRATION', 'NAMED']),
    /** NAMED일 때 화자 이름 (예: 고객센터, 상무님) */
    name: z.string().min(1).max(20).optional(),
    text: z.string().min(1).max(300),
  })
  .strict()
  .refine((l) => l.speaker !== 'NAMED' || l.name !== undefined, 'NAMED 화자는 name이 필요');
export type DialogueLine = z.infer<typeof DialogueLineSchema>;
export const DialogueSchema = z.array(DialogueLineSchema).max(12);

export const OutcomeBranchSchema = z
  .object({
    effects: EffectListSchema,
    resultText: z.string().max(400).optional(),
    /** 결과 후 이어지는 메신저 대화 */
    dialogue: DialogueSchema.optional(),
  })
  .strict();

export const ConditionalEffectSchema = z
  .object({
    on: z.enum(['ALWAYS', 'SUCCESS', 'FAILURE']),
    when: ConditionsSchema,
    effects: EffectListSchema,
  })
  .strict();
export type ConditionalEffect = z.infer<typeof ConditionalEffectSchema>;

export const ChoiceSchema = z
  .object({
    id: ChoiceIdSchema,
    label: z.string().min(1).max(60),
    description: z.string().max(300).optional(),
    /** false면 선택지 자체를 숨긴다 (분기용). */
    visibleIf: ConditionsSchema.optional(),
    /** false면 잠금 상태로 보여주고 requirementHint를 표시한다 (§22.1). */
    enabledIf: ConditionsSchema.optional(),
    requirementHint: z.string().max(80).optional(),
    /** 선택 시 메신저에 보내는 내 답장 (없으면 label) */
    reply: z.string().max(160).optional(),
    /** 판정 없는 선택지의 결과 대화 */
    resultDialogue: DialogueSchema.optional(),
    /** 판정 전 항상 적용되는 확정 효과/비용. */
    guaranteedEffects: EffectListSchema.optional(),
    /** 없으면 판정 없이 guaranteedEffects만 적용한다. */
    outcome: z
      .object({ baseChance: Probability, modifiers: z.array(ModifierSchema).max(10).optional() })
      .strict()
      .optional(),
    onSuccess: OutcomeBranchSchema.optional(),
    onFailure: OutcomeBranchSchema.optional(),
    /**
     * 조건부 추가 효과 (§4.2 효과 종류 3·4: 실패 피해 감소, 보상 증폭 / §4.2.2 부정 특성 피해 보정).
     * when은 사건 해결 직전 상태로 평가한다. 성공률 계산과 분리된다.
     */
    conditionalEffects: z.array(ConditionalEffectSchema).max(6).optional(),
    resultText: z.string().max(400).optional(),
  })
  .strict();
export type Choice = z.infer<typeof ChoiceSchema>;

export const NpcWeightModifierSchema = z
  .object({
    role: NpcRoleSchema,
    personalityAny: z.array(ContentIdSchema).min(1),
    add: z.number().int().min(-1000).max(1000),
  })
  .strict();

const EventObjectSchema = z
  .object({
    id: EventIdSchema,
    version: z.number().int().min(1),
    status: EventStatusSchema,
    /** 영구 특성 변경 효과는 special 이벤트에만 허용된다. */
    special: z.boolean().optional(),
    title: z.string().min(1).max(60),
    description: z.string().min(1).max(1000),
    category: EventCategorySchema,
    tags: z.array(z.string().max(30)).max(10).optional(),
    rarity: RaritySchema,
    /** 추첨 가중치. 발생 확률(%)이 아니다 (§7.3). */
    weight: z.number().int().min(1).max(1000),
    /** 미지정 시 규칙 기본값(직전 3개월 중복 금지, §21.3). */
    cooldownMonths: z.number().int().min(0).max(600).optional(),
    maxOccurrencesPerRun: z.number().int().min(1).optional(),
    exclusiveGroup: ContentIdSchema.optional(),
    /** 큰 체력·정신·재정 손실 가능 사건 (§21.3 연속 고위험 방지). */
    highRisk: z.boolean().optional(),
    /** 예약(SCHEDULE_EVENT)으로만 발생하는 후속 사건. 무작위 추첨 후보에서 제외된다 (§7.4). */
    scheduledOnly: z.boolean().optional(),
    /**
     * S12 이 턴(커리어 개월)부터 후보에 들면 추첨 없이 그 칸에 연다 (예약 사건 다음 우선).
     * 조건(직무·진행 중 연재 없음 등)은 그대로 적용되므로 막혀 있으면 풀릴 때까지 기다린다.
     */
    guaranteeFromTurn: z.number().int().min(0).optional(),
    /** S8 예약한 사건(또는 사내 소식)의 참여 동료를 이어받는다. scheduledOnly 사건만 가능 */
    inheritsParticipant: z.boolean().optional(),
    /** S8 연재: 같은 동료와 이어지는 n화 이야기. 2화부터는 예약 전용이며 참여 동료를 이어받는다 */
    series: z
      .object({
        id: ContentIdSchema,
        title: z.string().min(1).max(20),
        episode: z.number().int().min(1).max(10),
        total: z.number().int().min(1).max(10),
        /** 참여 동료가 떠나 다음 화를 이어갈 수 없을 때 대신 여는 정리 화 */
        farewellEventId: EventIdSchema.optional(),
        /** S12 직무 연재: 이 직무만 볼 수 있다 (업적 '이야기꾼'은 공통 연재만 센다) */
        job: JobIdSchema.optional(),
      })
      .strict()
      .optional(),
    /** 월 2개 사건 중 어느 칸인지. 없으면 분류로 결정 (work/company/social → 업무, 그 외 → 일상) */
    slot: z.enum(['work', 'life']).optional(),
    /** 메신저 채널 이름 (예: "개발팀 단톡방"). 없으면 등장 인물 1:1 또는 팀 채널 */
    channel: z.string().min(1).max(30).optional(),
    /** 사건 시작 대화 (업무 사건은 메신저로 표시) */
    dialogue: DialogueSchema.optional(),
    npcWeightModifiers: z.array(NpcWeightModifierSchema).max(6).optional(),
    conditions: ConditionsSchema.optional(),
    choices: z.array(ChoiceSchema).min(1).max(4),
  })
  .strict();

type EventObject = z.infer<typeof EventObjectSchema>;

function checkEventRules(event: EventObject, ctx: z.RefinementCtx): void {
  // 참여 NPC는 조건으로 뽑히거나(conditions.npc), 예약한 사건에서 이어받는다(inheritsParticipant)
  const hasNpc = event.conditions?.npc !== undefined || event.inheritsParticipant === true;
  if (event.inheritsParticipant && !event.scheduledOnly) {
    ctx.addIssue({
      code: 'custom',
      path: ['inheritsParticipant'],
      message: '참여자 승계는 scheduledOnly 사건만',
    });
  }
  const seenChoiceIds = new Set<string>();

  // PARTICIPANT 화자는 사건에 참여 NPC가 있어야 한다
  const lines = [
    ...(event.dialogue ?? []),
    ...event.choices.flatMap((c) => [
      ...(c.resultDialogue ?? []),
      ...(c.onSuccess?.dialogue ?? []),
      ...(c.onFailure?.dialogue ?? []),
    ]),
  ];
  if (!hasNpc && lines.some((l) => l.speaker === 'PARTICIPANT')) {
    ctx.addIssue({ code: 'custom', path: ['dialogue'], message: 'PARTICIPANT 화자는 conditions.npc가 필요' });
  }

  event.choices.forEach((choice, ci) => {
    const base = ['choices', ci];
    if (seenChoiceIds.has(choice.id)) {
      ctx.addIssue({ code: 'custom', path: [...base, 'id'], message: `중복 선택지 ID: ${choice.id}` });
    }
    seenChoiceIds.add(choice.id);

    if (!choice.outcome && (choice.onSuccess || choice.onFailure)) {
      ctx.addIssue({
        code: 'custom',
        path: base,
        message: 'outcome(판정)이 없는 선택지는 onSuccess/onFailure를 가질 수 없음',
      });
    }

    const groups: Array<{ name: 'guaranteedEffects' | 'onSuccess' | 'onFailure'; effects: Effect[] }> = [
      { name: 'guaranteedEffects', effects: choice.guaranteedEffects ?? [] },
      { name: 'onSuccess', effects: choice.onSuccess?.effects ?? [] },
      { name: 'onFailure', effects: choice.onFailure?.effects ?? [] },
    ];

    for (const group of groups) {
      group.effects.forEach((effect, ei) => {
        const path =
          group.name === 'guaranteedEffects'
            ? [...base, group.name, ei]
            : [...base, group.name, 'effects', ei];
        if (effect.type === 'SKILL_SET_LEVEL') {
          if (!event.special) {
            ctx.addIssue({ code: 'custom', path, message: 'SKILL_SET_LEVEL은 special 이벤트에서만 허용' });
          }
          if (group.name !== 'onSuccess') {
            ctx.addIssue({ code: 'custom', path, message: 'SKILL_SET_LEVEL은 onSuccess에서만 허용' });
          }
        }
        if (effect.type === 'NEGATIVE_TRAIT_SET_LEVEL' && !event.special) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'NEGATIVE_TRAIT_SET_LEVEL은 special 이벤트에서만 허용',
          });
        }
        if (effect.type === 'NPC_RELATION_DELTA' && effect.target === 'PARTICIPANT' && !hasNpc) {
          ctx.addIssue({ code: 'custom', path, message: 'PARTICIPANT 대상 효과는 conditions.npc가 필요' });
        }
        if (effect.type === 'FLAG_SET' && effect.scope === 'NPC' && !hasNpc) {
          ctx.addIssue({ code: 'custom', path, message: 'NPC 범위 플래그는 conditions.npc가 필요' });
        }
      });
    }

    (choice.conditionalEffects ?? []).forEach((ce, cei) => {
      const path = [...base, 'conditionalEffects', cei];
      if (ce.on !== 'ALWAYS' && !choice.outcome) {
        ctx.addIssue({ code: 'custom', path, message: 'SUCCESS/FAILURE 조건부 효과는 outcome이 필요' });
      }
      if (ce.when.npc && !hasNpc) {
        ctx.addIssue({ code: 'custom', path, message: '조건부 효과의 npc 조건은 conditions.npc가 필요' });
      }
      for (const effect of ce.effects) {
        if (
          effect.type === 'SKILL_SET_LEVEL' ||
          effect.type === 'NEGATIVE_TRAIT_SET_LEVEL' ||
          effect.type === 'EMPLOYMENT_CHANGE'
        ) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: '영구 특성 레벨 변경·실직은 조건부 효과에 둘 수 없음',
          });
        }
        if (effect.type === 'NPC_RELATION_DELTA' && effect.target === 'PARTICIPANT' && !hasNpc) {
          ctx.addIssue({ code: 'custom', path, message: 'PARTICIPANT 대상 효과는 conditions.npc가 필요' });
        }
      }
    });

    // 하나의 선택 결과(확정+성공, 확정+실패) 안에서 같은 특성 레벨을 두 번 바꾸지 않는다 (§23.2).
    for (const branch of ['onSuccess', 'onFailure'] as const) {
      const combined = [...(choice.guaranteedEffects ?? []), ...(choice[branch]?.effects ?? [])];
      const seen = new Set<string>();
      for (const effect of combined) {
        if (effect.type === 'SKILL_SET_LEVEL' || effect.type === 'NEGATIVE_TRAIT_SET_LEVEL') {
          const key = `${effect.type}:${effect.id}`;
          if (seen.has(key)) {
            ctx.addIssue({
              code: 'custom',
              path: [...base, branch],
              message: `한 결과에서 같은 특성(${effect.id}) 레벨을 두 번 변경할 수 없음`,
            });
          }
          seen.add(key);
        }
      }
    }

    const modifierKeys = new Set<string>();
    (choice.outcome?.modifiers ?? []).forEach((modifier, mi) => {
      const path = [...base, 'outcome', 'modifiers', mi];
      if (modifier.source === 'NPC' && !hasNpc) {
        ctx.addIssue({ code: 'custom', path, message: 'NPC 보정은 conditions.npc가 필요' });
      }
      if (modifier.source === 'SKILL' || modifier.source === 'NEGATIVE_TRAIT') {
        const key = `${modifier.source}:${modifier.id}`;
        if (modifierKeys.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `같은 특성 보정 중복: ${modifier.id} (levels로 통합)`,
          });
        }
        modifierKeys.add(key);
      }
    });
  });
}

export const EventDefinitionSchema = EventObjectSchema.superRefine(checkEventRules);
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

export type EventSlot = 'work' | 'life';

/** 사건의 월간 칸: 명시값 우선, 없으면 분류로 결정 */
export function eventSlot(event: Pick<EventDefinition, 'slot' | 'category'>): EventSlot {
  if (event.slot) return event.slot;
  return event.category === 'work' || event.category === 'company' || event.category === 'social'
    ? 'work'
    : 'life';
}
