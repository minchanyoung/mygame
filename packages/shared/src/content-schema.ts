import { z } from 'zod';
import {
  COMPANY_GRADES,
  CompanyGradeSchema,
  CompanyIdSchema,
  ContentIdSchema,
  ENDING_CAUSES,
  EventIdSchema,
  JOB_IDS,
  JobIdSchema,
  NpcRelationStatSchema,
  NpcRoleSchema,
  RESOURCE_KEYS,
  ResourceKeySchema,
  ReviewGradeSchema,
} from './enums';
import { ConditionsSchema, EventDefinitionSchema } from './event-schema';

/** 사건으로만 획득하는 영구 특성(긍정 능력/부정 특성) 마스터 데이터 (§4.2, §4.2.2, §22.2). */
export const TraitDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    polarity: z.enum(['POSITIVE', 'NEGATIVE']),
    name: z.string().min(1).max(20),
    description: z.string().max(200),
    maxLevel: z.number().int().min(1).max(3),
    levelEffects: z.object({ '1': z.string().max(120), '2': z.string().max(120) }).strict(),
    /** false면 마스터 데이터만 등록된 비활성/발견 불가 특성 (§22.2). */
    active: z.boolean(),
    acquireHint: z.string().max(120).optional(),
    recoveryHint: z.string().max(120).optional(),
  })
  .strict();
export type TraitDefinition = z.infer<typeof TraitDefinitionSchema>;

/** 카드에 붙는 선천적 배경 특성. 레벨 없음, 사건으로 성장하지 않는다 (§22.2). */
export const BackgroundTraitDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    kind: z.enum(['UNIVERSITY', 'MAJOR', 'FAMILY', 'STRENGTH', 'WEAKNESS']),
    name: z.string().min(1).max(24),
    description: z.string().max(200),
    rarity: z.enum(['common', 'rare']).optional(),
    resourceDeltas: z.partialRecord(ResourceKeySchema, z.number().int().min(-50).max(50)).optional(),
    cash: z.number().int().min(0).optional(),
    cashDelta: z.number().int().optional(),
    debtDelta: z.number().int().min(0).optional(),
    hireBonus: z
      .object({
        all: z.number().min(-0.5).max(0.5).optional(),
        byJob: z.partialRecord(JobIdSchema, z.number().min(-0.5).max(0.5)).optional(),
      })
      .strict()
      .optional(),
    /** 전공 → 적합 직무 */
    fitsJobs: z.array(JobIdSchema).optional(),
  })
  .strict();
export type BackgroundTraitDefinition = z.infer<typeof BackgroundTraitDefinitionSchema>;

const Score5 = z.number().int().min(1).max(5);

export const CompanyDefinitionSchema = z
  .object({
    id: CompanyIdSchema,
    name: z.string().min(1).max(30),
    grade: CompanyGradeSchema,
    industry: z.string().min(1).max(20),
    cultureTags: z.array(ContentIdSchema).max(6),
    workload: Score5,
    stability: Score5,
    growth: Score5,
    promotionPolicy: z.enum(['SENIORITY', 'PERFORMANCE', 'POLITICS']),
    financialHealth: z.number().int().min(0).max(100),
    description: z.string().max(200),
  })
  .strict();
export type CompanyDefinition = z.infer<typeof CompanyDefinitionSchema>;

export const NpcPersonalityDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(20),
    role: NpcRoleSchema,
    polarity: z.enum(['GOOD', 'BAD']),
    description: z.string().max(200),
    statBias: z
      .partialRecord(
        z.enum(['competence', 'fairness', 'ambition', 'favor', 'trust', 'rivalry']),
        z.number().int().min(-50).max(50),
      )
      .optional(),
  })
  .strict();
export type NpcPersonalityDefinition = z.infer<typeof NpcPersonalityDefinitionSchema>;

export const NpcGenerationConfigSchema = z
  .object({
    surnames: z.array(z.string().min(1)).min(5),
    givenNames: z.array(z.string().min(1)).min(10),
    /** 보조 성향(혼합 성향)을 가질 확률 0~1 */
    secondaryTagChance: z.number().min(0).max(1),
    baseTagWeight: z.number().int().min(1),
    /** 회사 문화 태그 → 성향별 추가 가중치. 기본 가중치가 있으므로 모든 성향이 항상 발생 가능하다 (§8.1). */
    cultureWeightBonus: z.record(ContentIdSchema, z.record(ContentIdSchema, z.number().int().min(0).max(50))),
    relationInitial: z.record(
      NpcRelationStatSchema,
      z.object({ min: z.number().int(), max: z.number().int() }),
    ),
  })
  .strict();
export type NpcGenerationConfig = z.infer<typeof NpcGenerationConfigSchema>;

const ChanceSchema = z.number().min(0).max(1);
const gradeRecord = <T extends z.ZodType>(schema: T) =>
  z.object(
    Object.fromEntries(COMPANY_GRADES.map((g) => [g, schema])) as Record<(typeof COMPANY_GRADES)[number], T>,
  );
const jobRecord = <T extends z.ZodType>(schema: T) =>
  z.object(Object.fromEntries(JOB_IDS.map((j) => [j, schema])) as Record<(typeof JOB_IDS)[number], T>);
const resourceRecord = <T extends z.ZodType>(schema: T) =>
  z.object(
    Object.fromEntries(RESOURCE_KEYS.map((k) => [k, schema])) as Record<(typeof RESOURCE_KEYS)[number], T>,
  );

/** 밸런스 수치는 코드가 아니라 이 규칙 데이터에서만 관리한다 (§17.2). 모든 값은 가설이다. */
export const GameRulesSchema = z
  .object({
    startAge: z.number().int().min(15).max(40),
    retireAge: z.number().int().min(40).max(80),
    chanceMin: ChanceSchema,
    chanceMax: ChanceSchema,
    /** 성공률 >= low → 낮음, >= medium → 보통, 그 외 높음 (§22.1) */
    riskThresholds: z.object({ low: ChanceSchema, medium: ChanceSchema }).strict(),
    defaultCooldownMonths: z.number().int().min(0),
    maxTraitLevel: z.number().int().min(1).max(3),
    highRiskStreakLimit: z.number().int().min(1),
    character: z
      .object({
        baseResources: resourceRecord(z.number().int().min(0).max(100)),
        resourceJitter: z.number().int().min(0).max(20),
        baseCash: z.number().int().min(0),
      })
      .strict(),
    hiring: z
      .object({
        baseChanceByGrade: gradeRecord(ChanceSchema),
        majorFitBonus: z.number().min(0).max(0.5),
        /** (평판 - 50) × 이 값 */
        reputationFactor: z.number().min(0).max(0.01),
        rejectionMentalCost: z.number().int().min(0).max(30),
        offerTiers: z.array(z.array(CompanyGradeSchema).min(1)).length(3),
        /** §26.4 첫 구직의 세 번째 카드는 이 등급·합격 확정 */
        firstJobGuaranteedGrade: CompanyGradeSchema,
      })
      .strict(),
    /** §26 즉시 실직 엔딩·경고 */
    gameOver: z
      .object({
        failureBeforeAge: z.number().int().min(20).max(80),
        debtLimitSalaryMultiple: z.number().int().min(1).max(50),
        warningThreshold: z.number().int().min(0).max(100),
        /** 부채가 한계선의 이 비율(‰) 이상이면 경고 */
        debtWarningPermille: z.number().int().min(0).max(1000),
        recoveryWeightBonus: z.number().int().min(0).max(1000),
      })
      .strict(),
    /**
     * §20.1 연말 인사평가 (12월) → 다음 1월 연봉 조정.
     * 점수 = 가중 평균(평판, 상사 신뢰, 상사 호감, 올해 사건 성공률%) + 특성 보정 → 0~100.
     */
    annualReview: z
      .object({
        weights: z
          .object({
            reputation: z.number().int().min(0),
            bossTrust: z.number().int().min(0),
            bossFavor: z.number().int().min(0),
            successRate: z.number().int().min(0),
          })
          .strict(),
        /** 등급 하한 점수 (S ≥ A ≥ B ≥ C, 그 아래는 D) */
        gradeThresholds: z
          .object({ S: z.number().int(), A: z.number().int(), B: z.number().int(), C: z.number().int() })
          .strict(),
        /** 등급별 연봉 인상률(‰) */
        raisePermilleByGrade: z.record(ReviewGradeSchema, z.number().int().min(-200).max(500)),
        /** 등급별 평판 변화 */
        reputationDeltaByGrade: z.record(ReviewGradeSchema, z.number().int().min(-30).max(30)),
        /** 특성별 점수 보정 (레벨 치환형): 예) officeStigma { "1": -5, "2": -15 } */
        traitAdjustments: z.record(
          ContentIdSchema,
          z.object({ '1': z.number().int().optional(), '2': z.number().int().optional() }).strict(),
        ),
      })
      .strict(),
    /** 월간 정산 (간략 게임 모델 — 실제 세법/금융 아님) */
    monthly: z
      .object({
        taxPermille: z.number().int().min(0).max(900),
        livingCost: z.number().int().min(0),
        debtInterestPermille: z.number().int().min(0).max(100),
        naturalChange: z.partialRecord(ResourceKeySchema, z.number().int().min(-20).max(20)),
      })
      .strict(),
    salary: z
      .object({
        baseAnnualByGrade: gradeRecord(z.number().int().positive()),
        rangeByGrade: gradeRecord(
          z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
        ),
        /** 직무 계수(‰). 1000 = 1.0배. 정수 연산으로 부동소수점 금액 계산을 피한다. */
        jobCoefficientPermille: jobRecord(z.number().int().min(500).max(2000)),
        roundingUnit: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .refine((r) => r.chanceMin < r.chanceMax, 'chanceMin < chanceMax')
  .refine((r) => r.riskThresholds.medium < r.riskThresholds.low, 'medium < low');
export type GameRules = z.infer<typeof GameRulesSchema>;

export const ContentPolicySchema = z.object({ bannedWords: z.array(z.string()) }).strict();

/** 엔딩 문구: 조건(선언형) 변형 중 첫 일치, 없으면 기본 text. NPC 조건은 현재 직속 상사 기준 (§26.2). */
const EndingTextSchema = z
  .object({
    title: z.string().min(1).max(30),
    text: z.string().min(1).max(300),
    variants: z
      .array(z.object({ when: ConditionsSchema, text: z.string().min(1).max(300) }).strict())
      .max(10)
      .optional(),
  })
  .strict();
export type EndingText = z.infer<typeof EndingTextSchema>;

export const EndingsSchema = z
  .object({
    causes: z.object(
      Object.fromEntries(ENDING_CAUSES.map((c) => [c, EndingTextSchema])) as Record<
        (typeof ENDING_CAUSES)[number],
        typeof EndingTextSchema
      >,
    ),
    /** 50세 이상 실직 시: "조기 은퇴 — 원인" 제목에 원인 문구 + 이 문구를 덧붙인다 */
    earlyRetirement: EndingTextSchema,
  })
  .strict();
export type Endings = z.infer<typeof EndingsSchema>;

export const ContentPackSchema = z
  .object({
    contentVersion: z.string().min(1),
    rules: GameRulesSchema,
    policy: ContentPolicySchema,
    traits: z.array(TraitDefinitionSchema),
    backgroundTraits: z.array(BackgroundTraitDefinitionSchema),
    companies: z.array(CompanyDefinitionSchema),
    npcPersonalities: z.array(NpcPersonalityDefinitionSchema),
    npcGeneration: NpcGenerationConfigSchema,
    fallbackEventId: EventIdSchema,
    events: z.array(EventDefinitionSchema),
    endings: EndingsSchema,
  })
  .strict();
export type ContentPack = z.infer<typeof ContentPackSchema>;
