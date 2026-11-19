import { z } from 'zod';
import {
  COMPANY_GRADES,
  CompanyGradeSchema,
  CompanyIdSchema,
  ContentIdSchema,
  DIFFICULTIES,
  ENDING_CAUSES,
  EndingCauseSchema,
  EndingTypeSchema,
  EventIdSchema,
  JOB_IDS,
  JobIdSchema,
  NpcRelationStatSchema,
  NpcRoleSchema,
  PlayerRankSchema,
  RESOURCE_KEYS,
  ResourceKeySchema,
  ReviewGradeSchema,
} from './enums';
import { ConditionsSchema, EventDefinitionSchema, IntRangeSchema } from './event-schema';

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
    kind: z.enum(['UNIVERSITY', 'MAJOR', 'STRENGTH', 'WEAKNESS']),
    name: z.string().min(1).max(24),
    description: z.string().max(200),
    rarity: z.enum(['common', 'rare']).optional(),
    resourceDeltas: z.partialRecord(ResourceKeySchema, z.number().int().min(-50).max(50)).optional(),
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
/** 등급별 추첨 가중치 (예: { "A": 1, "B": 3, "C": 4 }) */
const GradeWeightsSchema = z
  .partialRecord(CompanyGradeSchema, z.number().int().min(1).max(1000))
  .refine((w) => Object.keys(w).length > 0, '최소 1개 등급');
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

/** S10 난이도 손잡이 하나 */
export const DifficultyKnobsSchema = z
  .object({
    /** 선택지 성공 확률에 더함 (clamp 전) */
    chanceShift: z.number().min(-0.5).max(0.5),
    /** 사건으로 잃는 자원 배율 (‰). 얻는 쪽은 그대로 */
    lossPermille: z.number().int().min(100).max(3000),
    /** 월 생활비 배율 (‰) */
    livingCostPermille: z.number().int().min(100).max(3000),
    /** 카드 시작 현금에 더함 */
    startCashBonus: z.number().int().min(0),
  })
  .strict();
export type DifficultyKnobs = z.infer<typeof DifficultyKnobsSchema>;

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
        /** 지원 카드 3장의 등급 추첨 가중치 (이직 등 일반 구직) */
        offerTiers: z.array(GradeWeightsSchema).length(3),
        /** 첫 구직 카드 1·2장의 등급 가중치. S는 넣지 않고, 높은 등급일수록 낮은 가중치 */
        firstJobOfferTiers: z.array(GradeWeightsSchema).length(2),
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
        /** 평가 항목 가중치: 업무 성과(올해 업무 사건 성공률), 상사 평가, 동료 협업, 평판, 근태·컨디션 */
        weights: z
          .object({
            performance: z.number().int().min(0),
            boss: z.number().int().min(0),
            peers: z.number().int().min(0),
            reputation: z.number().int().min(0),
            condition: z.number().int().min(0),
          })
          .strict(),
        /** S7: 이 나이부터 '근태·컨디션' 가중치에 더하는 값 */
        seniorConditionWeight: z
          .object({ fromAge: z.number().int(), bonus: z.number().int().min(0) })
          .strict(),
        /** 등급별 성과급 (월급 대비 ‰, 1000 = 한 달 치) */
        bonusPermilleByGrade: z.record(ReviewGradeSchema, z.number().int().min(0).max(10000)),
        /** 등급별 상사 코멘트 후보 ({boss} {me} 사용 가능) */
        comments: z.record(ReviewGradeSchema, z.array(z.string().min(1).max(200)).min(1)),
        /** 이 등급들이면 경고 플래그를 세운다 (예: D → 성과 개선 프로그램) */
        warningFlag: z
          .object({
            grades: z.array(ReviewGradeSchema).min(1),
            key: ContentIdSchema,
            expiresInMonths: z.number().int().min(1).max(36),
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
        /** 고정 생활비 항목 (원) */
        livingCosts: z
          .object({
            housing: z.number().int().min(0),
            food: z.number().int().min(0),
            transport: z.number().int().min(0),
            misc: z.number().int().min(0),
          })
          .strict(),
        /** 물가 상승: 생활비가 해마다 이 비율(‰)만큼 복리로 오른다 */
        livingCostGrowthPermille: z.number().int().min(0).max(200),
        debtInterestPermille: z.number().int().min(0).max(100),
        /** 빚이 있으면 매달 갚는 원금 상한 (원) */
        debtRepayment: z.number().int().min(0),
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
    /**
     * S5 승진 심사 (1월, 연봉 조정 직전). 자동 승진 없음: 근속 + 포인트를 채우면 심사가 열리고 확률 판정 (§5.4).
     */
    promotion: z
      .object({
        /** 사다리: 사원→대리→과장→차장→부장 순서, 연속이어야 한다 (검증기) */
        ladder: z
          .array(
            z
              .object({
                from: PlayerRankSchema,
                to: PlayerRankSchema,
                minYears: z.number().int().min(0).max(20),
                points: z.number().int().min(1).max(50),
                raisePermille: z.number().int().min(0).max(1000),
                /** 이 단계의 심사 확률 보정 (위로 갈수록 자리가 적다) */
                chanceAdjust: z.number().min(-0.9).max(0.5),
              })
              .strict(),
          )
          .min(1),
        /** 12월 평가 등급별 승진 포인트 */
        pointsByGrade: z.record(ReviewGradeSchema, z.number().int().min(0).max(20)),
        baseChance: ChanceSchema,
        /** 필요 포인트 초과 1점당 */
        perExtraPoint: z.number().min(0).max(0.5),
        maxExtraBonus: z.number().min(0).max(0.5),
        policy: z
          .object({
            /** SENIORITY: 최소 근속 초과 1년당 */
            seniorityPerYear: z.number().min(0).max(0.5),
            /** PERFORMANCE: 직전 평가 등급별 */
            performanceByGrade: z.record(ReviewGradeSchema, z.number().min(-0.5).max(0.5)),
            /** POLITICS: 상사 호감 기준 */
            politicsFavorHigh: z.number().int().min(0).max(100),
            politicsFavorLow: z.number().int().min(0).max(100),
            politicsBonus: z.number().min(0).max(0.5),
          })
          .strict(),
        bossTrustMin: z.number().int().min(0).max(100),
        bossTrustBonus: z.number().min(0).max(0.5),
        /** 특성 보정 (레벨 치환형), 예: officeStigma { "1": -0.05, "2": -0.15 } */
        traitAdjustments: z.record(
          ContentIdSchema,
          z.object({ '1': z.number().optional(), '2': z.number().optional() }).strict(),
        ),
        /** 이 플래그(COMPANY)가 있으면 심사 자체가 열리지 않음 (PIP 경고) */
        blockedByFlag: ContentIdSchema,
        /** 누락 1회당 다음 심사 보정 */
        missBonus: z.number().min(0).max(0.5),
        missPenalty: z
          .object({
            mental: z.number().int().min(0).max(50),
            reputation: z.number().int().min(0).max(50),
            bossFavor: z.number().int().min(0).max(50),
          })
          .strict(),
        /** 연속 누락이 이 횟수에 도달하면 예약하는 사건 */
        consecutiveMissEvent: z.object({ misses: z.number().int().min(1), eventId: EventIdSchema }).strict(),
        /** 직급별 매달 자연 변화 추가 보정 (부담) */
        rankBurden: z.partialRecord(
          PlayerRankSchema,
          z.partialRecord(ResourceKeySchema, z.number().int().min(-10).max(10)),
        ),
      })
      .strict(),
    /** S7 이직: 제안서 연봉 인상 범위(‰)·등급 상승 폭·한 판 최대 횟수·수습 기간·이직 직후 평판 */
    transfer: z
      .object({
        raisePermille: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).strict(),
        gradeUp: z
          .object({ min: z.number().int().min(0).max(5), max: z.number().int().min(0).max(5) })
          .strict(),
        maxTransfers: z.number().int().min(0).max(10),
        probationMonths: z.number().int().min(0).max(12),
        probationFlag: ContentIdSchema,
        startingReputation: z.number().int().min(0).max(100),
      })
      .strict(),
    /** S8 동료의 인생: 팀원마다 매달 이 확률로 소식이 생긴다. 후속 사건과 플레이어에게 오는 파급 */
    npcLife: z
      .object({
        monthlyChance: z.number().min(0).max(0.5),
        maxNewsPerMonth: z.number().int().min(1).max(3),
        friendlyFavor: z.number().int().min(0).max(100),
        followUps: z
          .object({ wedding: EventIdSchema, farewell: EventIdSchema, peerPromoted: EventIdSchema })
          .strict(),
        /** 소식의 직접 파급 (그달) */
        impact: z
          .object({
            babyFocus: z.number().int().min(-30).max(0),
            sickFocus: z.number().int().min(-30).max(0),
            laidOffMental: z.number().int().min(-30).max(0),
          })
          .strict(),
      })
      .strict(),
    /** S7 나이 듦: 이 나이부터 매달 자연 변화에 보정 (누적) */
    aging: z.array(
      z
        .object({
          fromAge: z.number().int().min(20).max(80),
          naturalChange: z.partialRecord(ResourceKeySchema, z.number().int().min(-10).max(10)),
        })
        .strict(),
    ),
    /** S10 난이도 손잡이 (판 생성 때 고정) */
    difficulty: z
      .object({ EASY: DifficultyKnobsSchema, NORMAL: DifficultyKnobsSchema, REAL: DifficultyKnobsSchema })
      .strict(),
    /** S7 노후 등급: 정상 엔딩 순자산이 (첫해 물가 기준 금액 × 물가 지수) 이상이면 */
    retirement: z
      .object({ comfortable: z.number().int().positive(), modest: z.number().int().positive() })
      .strict(),
    /** 인생 목표 진행 축하 구간(%)과 보상 */
    lifeGoal: z
      .object({
        offerCount: z.number().int().min(1).max(6),
        milestones: z.array(z.number().int().min(1).max(99)),
        milestoneMental: z.number().int().min(0).max(20),
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
    /** S7 노후 등급 문구 */
    retirementTiers: z.object({
      COMFORTABLE: z.object({ title: z.string().min(1).max(20), text: z.string().min(1).max(200) }).strict(),
      MODEST: z.object({ title: z.string().min(1).max(20), text: z.string().min(1).max(200) }).strict(),
      TIGHT: z.object({ title: z.string().min(1).max(20), text: z.string().min(1).max(200) }).strict(),
    }),
    /** 50세 이상 실직 시: "조기 은퇴 — 원인" 제목에 원인 문구 + 이 문구를 덧붙인다 */
    earlyRetirement: EndingTextSchema,
  })
  .strict();
export type Endings = z.infer<typeof EndingsSchema>;

/**
 * S5 인생 목표 카드. 판정은 엔딩 시점, 정상 엔딩(조기 은퇴·정년)에서만 (실패 엔딩은 자동 미달성).
 * - NET_WORTH: 현금 − 빚 ≥ amount
 * - RANK: 최종 직급 ≥ rank
 * - FULL_TENURE: 정년 은퇴 엔딩
 * - DEBT_FREE: 빚 0 그리고 현금 ≥ amount
 * - WELLBEING: 체력·정신력 모두 ≥ stat
 * - ACE: 연말 평가 S ≥ count회
 */
export const LifeGoalKindSchema = z.enum([
  'NET_WORTH',
  'RANK',
  'FULL_TENURE',
  'DEBT_FREE',
  'WELLBEING',
  'ACE',
]);
export type LifeGoalKind = z.infer<typeof LifeGoalKindSchema>;

export const LifeGoalDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    kind: LifeGoalKindSchema,
    title: z.string().min(1).max(20),
    emoji: z.string().min(1).max(4),
    description: z.string().min(1).max(120),
    amount: z.number().int().positive().optional(),
    rank: PlayerRankSchema.optional(),
    stat: z.number().int().min(1).max(100).optional(),
    /** WELLBEING: 커리어 내내 월말 체력·정신력이 이 값 아래로 떨어진 적이 없어야 함 */
    floor: z.number().int().min(0).max(100).optional(),
    count: z.number().int().min(1).max(40).optional(),
    /** 이 배경 특성 중 하나가 있으면 '어울리는 목표'로 우선 제시 */
    affinity: z.array(ContentIdSchema).optional(),
    achievedText: z.string().min(1).max(200),
    failedText: z.string().min(1).max(200),
  })
  .strict()
  .refine((g) => {
    switch (g.kind) {
      case 'NET_WORTH':
      case 'DEBT_FREE':
        return g.amount !== undefined;
      case 'RANK':
        return g.rank !== undefined;
      case 'WELLBEING':
        return g.stat !== undefined;
      case 'ACE':
        return g.count !== undefined;
      default:
        return true;
    }
  }, '목표 종류에 필요한 수치(amount/rank/stat/count)가 없음');
export type LifeGoalDefinition = z.infer<typeof LifeGoalDefinitionSchema>;

/** S9 별명(칭호). 조건은 모두 AND, 엔딩 확정 시점에 판정한다. 빈 rule = 기본 별명. */
export const TITLE_RARITIES = ['COMMON', 'RARE', 'LEGENDARY'] as const;
export const TitleRaritySchema = z.enum(TITLE_RARITIES);
export type TitleRarity = z.infer<typeof TitleRaritySchema>;

const ChoicePickSchema = z.object({ eventId: EventIdSchema, choiceId: z.string().min(1) }).strict();

export const TitleRuleSchema = z
  .object({
    category: z.enum(['FAILURE', 'NORMAL']).optional(),
    endingTypes: z.array(EndingTypeSchema).min(1).optional(),
    endingCauses: z.array(EndingCauseSchema).min(1).optional(),
    endAge: IntRangeSchema.optional(),
    transfers: IntRangeSchema.optional(),
    /** 커리어 최고 직급이 이 중 하나 */
    highestRanks: z.array(PlayerRankSchema).min(1).optional(),
    /** 연간 기록(12월)에서 이 직급이었던 해의 수 */
    rankYears: z
      .object({ rank: PlayerRankSchema, min: z.number().int().min(1) })
      .strict()
      .optional(),
    /** 이 나이 전에 이 직급 이상 승진 */
    rankBeforeAge: z.object({ rank: PlayerRankSchema, age: z.number().int() }).strict().optional(),
    /** 이 나이 이후에 승진한 적 있음 */
    promotedFromAge: z.number().int().optional(),
    reviewCount: z
      .object({ grades: z.array(ReviewGradeSchema).min(1), min: z.number().int().min(1) })
      .strict()
      .optional(),
    /** 평가를 minCount번 이상 받았고 모든 평가가 이 등급들 안 */
    reviewsWithin: z
      .object({ grades: z.array(ReviewGradeSchema).min(1), minCount: z.number().int().min(1) })
      .strict()
      .optional(),
    /** from 등급을 받은 뒤 to 등급을 받은 적 있음 */
    comeback: z
      .object({ from: z.array(ReviewGradeSchema).min(1), to: z.array(ReviewGradeSchema).min(1) })
      .strict()
      .optional(),
    /** 순자산 범위 (첫해 물가 기준, 물가 지수를 곱해 비교) */
    netWorth: IntRangeSchema.optional(),
    lowestWellbeing: IntRangeSchema.optional(),
    nearCollapseMonths: IntRangeSchema.optional(),
    maxHighRiskStreak: IntRangeSchema.optional(),
    /** 커리어 중 부채가 한계선의 몇 ‰까지 갔나 */
    peakDebtPermille: IntRangeSchema.optional(),
    debtAtEnd: IntRangeSchema.optional(),
    /** 이 선택 중 하나라도 한 적 있음 */
    choicesAny: z.array(ChoicePickSchema).min(1).optional(),
    /** 호감 높은 동료 수 (떠난 사람 포함) */
    friends: IntRangeSchema.optional(),
    /** 신뢰 높은 상사 수 */
    trustedBosses: IntRangeSchema.optional(),
    /** S13 이 선택들을 한 횟수 합 (결과와 무관) — '퇴근 후' 일상 사건 별명 */
    choiceCount: z
      .object({ picks: z.array(ChoicePickSchema).min(1), min: z.number().int().min(1) })
      .strict()
      .optional(),
  })
  .strict();
export type TitleRule = z.infer<typeof TitleRuleSchema>;

export const TitleDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(12),
    emoji: z.string().min(1).max(4),
    rarity: TitleRaritySchema,
    /** 높을수록 대표 별명으로 먼저 뽑힌다 */
    priority: z.number().int().min(0).max(1000),
    /** 붙은 이유 한 줄 */
    reason: z.string().min(1).max(80),
    rule: TitleRuleSchema,
  })
  .strict();
export type TitleDefinition = z.infer<typeof TitleDefinitionSchema>;

/** S10 업적: 여러 판의 도감 기록으로 판정. 조건은 모두 AND */
export const AchievementRuleSchema = z
  .object({
    /** 끝까지 마친 판 수 */
    runs: z.number().int().min(1).optional(),
    /** 이 엔딩(들) 중 하나를 본 적 있음 */
    endingTypes: z.array(EndingTypeSchema).min(1).optional(),
    /** 이 분류의 엔딩을 본 적 있음 */
    endingCategory: z.enum(['FAILURE', 'NORMAL']).optional(),
    /** 위 엔딩 조건을 이 난이도에서 */
    difficulty: z.enum(DIFFICULTIES).optional(),
    /** 서로 다른 실패 엔딩 수 */
    failureEndings: z.number().int().min(1).optional(),
    /** 모은 별명 수 */
    titles: z.number().int().min(1).optional(),
    /** 이 희귀도의 별명을 받은 적 있음 */
    titleRarity: TitleRaritySchema.optional(),
    /** 모든 연재를 한 번 이상 완결 */
    allSeries: z.literal(true).optional(),
    /** S12 모든 직무 연재를 한 번 이상 완결 */
    allJobSeries: z.literal(true).optional(),
    /** 한 연재에서 본 서로 다른 결말 수 */
    seriesEndingsInOne: z.number().int().min(1).optional(),
    /** 다녀 본 회사 수 */
    companies: z.number().int().min(1).optional(),
    /** 이 등급 회사에 다녀 본 적 있음 */
    companyGrade: CompanyGradeSchema.optional(),
    /** 달성한 인생 목표 수 */
    goals: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((r) => Object.keys(r).length > 0, '빈 업적 조건');
export type AchievementRule = z.infer<typeof AchievementRuleSchema>;

export const AchievementDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(14),
    emoji: z.string().min(1).max(4),
    description: z.string().min(1).max(60),
    rule: AchievementRuleSchema,
  })
  .strict();
export type AchievementDefinition = z.infer<typeof AchievementDefinitionSchema>;

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
    /** 일상 칸 폴백 (평온한 한 달) */
    fallbackEventId: EventIdSchema,
    /** 업무 칸 폴백 (평범한 업무일) */
    workFallbackEventId: EventIdSchema,
    events: z.array(EventDefinitionSchema),
    endings: EndingsSchema,
    lifeGoals: z.array(LifeGoalDefinitionSchema).min(3),
    titles: z.array(TitleDefinitionSchema).min(1),
    achievements: z.array(AchievementDefinitionSchema).min(1),
  })
  .strict();
export type ContentPack = z.infer<typeof ContentPackSchema>;
