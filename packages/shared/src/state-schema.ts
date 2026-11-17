import { z } from 'zod';
import {
  CompanyGradeSchema,
  CompanyIdSchema,
  ContentIdSchema,
  EmploymentStatusSchema,
  EndingCauseSchema,
  EndingTypeSchema,
  EventIdSchema,
  FlagScopeSchema,
  JobIdSchema,
  JobLossReasonSchema,
  NpcAssignmentRoleSchema,
  NpcRankSchema,
  NpcRelationStatSchema,
  NpcRoleSchema,
  OwnedTraitLevelSchema,
  PlayerRankSchema,
  ReviewGradeSchema,
  RetirementTierSchema,
  RunPhaseSchema,
  TraitLevelSchema,
} from './enums';
import { PlayerProfileSchema } from './profile';

/** §23.1 서버 정본 상태 GameRunState. 클라이언트에는 공개 뷰만 투영한다. */

const Krw = z.number().int();
const Stat100 = z.number().int().min(0).max(100);

export const ResourcesSchema = z
  .object({ health: Stat100, mental: Stat100, focus: Stat100, reputation: Stat100 })
  .strict();
export type Resources = z.infer<typeof ResourcesSchema>;

/** 키 부재 = 미보유(Lv.0). 값은 1 | 2만 저장. XP 필드는 존재하지 않는다 (§4.2). */
export const TraitLevelsSchema = z.record(ContentIdSchema, OwnedTraitLevelSchema);
export type TraitLevels = z.infer<typeof TraitLevelsSchema>;

export const CharacterCardSchema = z
  .object({
    cardId: z.string().min(1),
    profile: PlayerProfileSchema,
    startAge: z.number().int(),
    universityId: ContentIdSchema,
    majorId: ContentIdSchema,
    strengthId: ContentIdSchema,
    weaknessId: ContentIdSchema,
    backgroundTraits: z.array(ContentIdSchema),
    resources: ResourcesSchema,
    cash: Krw.nonnegative(),
    debt: Krw.nonnegative(),
    /** 모든 카드 공통으로 빈 컬렉션 (§3.1). */
    skills: TraitLevelsSchema,
    negativeTraits: TraitLevelsSchema,
  })
  .strict();
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

export const JobOfferSchema = z
  .object({
    offerId: z.string().min(1),
    companyId: CompanyIdSchema,
    grade: CompanyGradeSchema,
    jobId: JobIdSchema,
    /** 정확한 합격률 공개 (§22.1). 0.01 단위로 반올림된 값이 실제 판정에 쓰인다. */
    hireChance: z.number().min(0).max(1),
    annualSalary: Krw.positive(),
    /** §26.4 첫 구직 합격 확정 카드 (hireChance = 1) */
    guaranteed: z.boolean(),
    reasons: z.array(z.string()),
  })
  .strict();
export type JobOffer = z.infer<typeof JobOfferSchema>;

/** S7 이직 제안서 */
export const TransferOfferSchema = z
  .object({
    offerId: z.string().min(1),
    companyId: CompanyIdSchema,
    grade: CompanyGradeSchema,
    jobId: JobIdSchema,
    annualSalary: Krw.positive(),
    /** 이 턴의 결산에서만 수락 가능 */
    turnIndex: z.number().int().min(0),
  })
  .strict();
export type TransferOffer = z.infer<typeof TransferOfferSchema>;

export const JobSearchSchema = z
  .object({
    round: z.number().int().min(0),
    consecutiveRejections: z.number().int().min(0),
    lastResult: z
      .object({
        offerId: z.string(),
        companyId: CompanyIdSchema,
        hired: z.boolean(),
        /** 지원한 카드에 불합격해 확정 카드로 자동 입사한 경우 그 회사 */
        autoAssignedCompanyId: CompanyIdSchema.nullable(),
        turnIndex: z.number().int(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const EmploymentSchema = z
  .object({
    status: EmploymentStatusSchema,
    current: z
      .object({
        companyId: CompanyIdSchema,
        teamId: z.string().min(1),
        jobId: JobIdSchema,
        rank: PlayerRankSchema,
        annualSalary: Krw.positive(),
        startedTurn: z.number().int().min(0),
        /** 현 직급이 된 턴 (승진 최소 근속 계산) */
        rankSinceTurn: z.number().int().min(0),
        /** 현 직급에서 쌓은 승진 포인트 (승진 시 0, 회사 내부 값) */
        promotionPoints: z.number().int().min(0),
        /** 현 직급에서 연속 승진 누락 횟수 */
        promotionMisses: z.number().int().min(0),
        /** S7 이직 직후 수습 기간이 끝나는 턴 (없으면 null) */
        probationUntilTurn: z.number().int().min(0).nullable(),
      })
      .strict()
      .nullable(),
    /** §26 이벤트로 인한 비자발적 실직 기록 (엔딩 판정용) */
    jobLoss: z
      .object({ reason: JobLossReasonSchema, eventId: EventIdSchema, turnIndex: z.number().int().min(0) })
      .strict()
      .nullable(),
    /** S7 임원 승진 확정 ('별을 달다' 엔딩 판정용) */
    promotedToExecutive: z.boolean(),
  })
  .strict();
export type Employment = z.infer<typeof EmploymentSchema>;

/** §26.5 엔딩. 문구는 판정 시점에 고정 저장한다. */
export const EndingSchema = z
  .object({
    type: EndingTypeSchema,
    cause: EndingCauseSchema,
    category: z.enum(['FAILURE', 'NORMAL']),
    age: z.number().int(),
    turnIndex: z.number().int().min(0),
    sourceEventId: EventIdSchema.nullable(),
    title: z.string(),
    text: z.string(),
    /** 인생 목표 판정. 실패 엔딩은 자동 미달성 (S5 Q3) */
    goal: z.object({ goalId: ContentIdSchema, achieved: z.boolean(), text: z.string() }).strict().nullable(),
    /** S7 노후 등급 (정상 엔딩만, 실패 엔딩은 null) */
    retirementTier: RetirementTierSchema.nullable(),
  })
  .strict();
export type Ending = z.infer<typeof EndingSchema>;

/** 1월 승진 심사 결과 */
export const PromotionResultSchema = z
  .object({
    from: PlayerRankSchema,
    to: PlayerRankSchema,
    success: z.boolean(),
    /** 승진 시 연봉 인상분이 반영된 금액 (누락 시 null) */
    salaryFrom: Krw.positive().nullable(),
    salaryTo: Krw.positive().nullable(),
    newBossName: z.string().nullable(),
    misses: z.number().int().min(0),
  })
  .strict();
export type PromotionResult = z.infer<typeof PromotionResultSchema>;

export const LifeGoalStateSchema = z
  .object({
    goalId: ContentIdSchema,
    /** 이미 축하한 진행도 구간 (25, 50, 75) */
    milestones: z.array(z.number().int().min(1).max(100)),
  })
  .strict();
export type LifeGoalState = z.infer<typeof LifeGoalStateSchema>;

const MoneySnapshot = z.object({ resources: ResourcesSchema, cash: Krw, debt: Krw }).strict();

/** §20.1 연말 인사평가 기록 (승진 심사 등에서 참조) */
export const AnnualReviewSchema = z
  .object({
    yearIndex: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    companyId: CompanyIdSchema,
    grade: ReviewGradeSchema,
    score: z.number().int().min(0).max(100),
    bonus: Krw.nonnegative(),
  })
  .strict();
export type AnnualReview = z.infer<typeof AnnualReviewSchema>;

/** 인사평가표 상세 (결산 화면 표시용) */
export const ReviewDetailSchema = z
  .object({
    grade: ReviewGradeSchema,
    score: z.number().int(),
    reputationDelta: z.number().int(),
    items: z.array(
      z
        .object({
          key: z.enum(['performance', 'boss', 'peers', 'reputation', 'condition']),
          score: z.number().int().min(0).max(100),
          grade: ReviewGradeSchema,
          note: z.string(),
        })
        .strict(),
    ),
    traitAdjustment: z.number().int(),
    bonus: Krw.nonnegative(),
    bossName: z.string().nullable(),
    comment: z.string(),
    warning: z.boolean(),
  })
  .strict();
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;

/** 한 사건의 결과 기록 (이달의 이야기) */
export const EventResultSchema = z
  .object({
    occurrenceId: z.string(),
    eventId: EventIdSchema,
    choiceId: z.string(),
    participantNpcId: z.string().nullable(),
    success: z.boolean().nullable(),
    resultText: z.string().nullable(),
    traitChanges: z.array(
      z
        .object({
          kind: z.enum(['SKILL', 'NEGATIVE_TRAIT']),
          id: ContentIdSchema,
          from: TraitLevelSchema,
          to: TraitLevelSchema,
        })
        .strict(),
    ),
    /** 이 사건만으로 생긴 변화 (월 정산과 분리) */
    resourceDelta: z.record(z.string(), z.number().int()),
    cashDelta: Krw,
    debtDelta: Krw,
    /** 판정에 작용한 요인 (공개 시 수치 없이 이름만) */
    factors: z.array(
      z
        .object({
          source: z.enum(['SKILL', 'NEGATIVE_TRAIT', 'BACKGROUND', 'NPC', 'RESOURCE']),
          id: z.string(),
          level: TraitLevelSchema.nullable(),
          positive: z.boolean(),
        })
        .strict(),
    ),
    npcChanges: z.array(
      z.object({ npcId: z.string(), stat: NpcRelationStatSchema, delta: z.number().int() }).strict(),
    ),
    followUpScheduled: z.boolean(),
  })
  .strict();
export type EventResult = z.infer<typeof EventResultSchema>;

/** S8 동료의 인생 소식 */
export const NEWS_KINDS = ['MARRIAGE', 'BABY', 'PROMOTION', 'LEAVE', 'LAID_OFF', 'SICK', 'JOINED'] as const;
export const NewsItemSchema = z
  .object({
    kind: z.enum(NEWS_KINDS),
    npcId: z.string(),
    text: z.string(),
  })
  .strict();
export type NewsItem = z.infer<typeof NewsItemSchema>;

/** 이번 달 기록 (월말 요약 표시용) */
export const MonthLogSchema = z
  .object({
    turnIndex: z.number().int().min(0),
    start: MoneySnapshot,
    settlement: z
      .object({
        grossSalary: Krw.nonnegative(),
        tax: Krw.nonnegative(),
        netSalary: Krw.nonnegative(),
        livingCost: Krw.nonnegative(),
        livingBreakdown: z
          .object({
            housing: Krw.nonnegative(),
            food: Krw.nonnegative(),
            transport: Krw.nonnegative(),
            misc: Krw.nonnegative(),
          })
          .strict(),
        interest: Krw.nonnegative(),
        debtRepayment: Krw.nonnegative(),
      })
      .strict(),
    /** 12월이면 이번 달 처리된 인사평가 */
    annualReview: ReviewDetailSchema.nullable(),
    /** 1월이면 이번 달 적용된 연봉 조정 */
    salaryAdjustment: z
      .object({ grade: ReviewGradeSchema.nullable(), from: Krw.positive(), to: Krw.positive() })
      .strict()
      .nullable(),
    /** 1월이면 이번 달 승진 심사 결과 (자격이 없으면 null) */
    promotion: PromotionResultSchema.nullable(),
    /** S8 이번 달 사내 소식 (동료의 인생) */
    news: z.array(NewsItemSchema),
    /** 이번 달 새로 넘은 인생 목표 진행 구간 (25/50/75) */
    goalMilestone: z.number().int().nullable(),
    /** 이번 달 사건 결과 (업무 → 일상 순) */
    eventResults: z.array(EventResultSchema),
  })
  .strict();
export type MonthLog = z.infer<typeof MonthLogSchema>;

/** 이번 달 아직 열리지 않은 사건 (업무 다음 일상) */
export const PendingEventSchema = z
  .object({ eventId: EventIdSchema, participantNpcId: z.string().nullable() })
  .strict();

export const NpcSchema = z
  .object({
    npcId: z.string().min(1),
    companyId: CompanyIdSchema,
    teamId: z.string().min(1),
    name: z.string().min(1),
    role: NpcRoleSchema,
    rank: NpcRankSchema,
    personalityTags: z.array(ContentIdSchema).min(1),
    competence: Stat100,
    fairness: Stat100,
    ambition: Stat100,
    favor: Stat100,
    trust: Stat100,
    rivalry: Stat100,
    memoryFlags: z.array(ContentIdSchema),
    relationshipHistory: z.array(
      z
        .object({
          turnIndex: z.number().int(),
          eventId: EventIdSchema,
          stat: NpcRelationStatSchema,
          from: Stat100,
          to: Stat100,
        })
        .strict(),
    ),
    active: z.boolean(),
    createdAtTurn: z.number().int().min(0),
  })
  .strict();
export type Npc = z.infer<typeof NpcSchema>;

export const NpcAssignmentSchema = z
  .object({
    npcId: z.string().min(1),
    companyId: CompanyIdSchema,
    teamId: z.string().min(1),
    role: NpcAssignmentRoleSchema,
    fromTurn: z.number().int().min(0),
    toTurn: z.number().int().min(0).nullable(),
  })
  .strict();
export type NpcAssignment = z.infer<typeof NpcAssignmentSchema>;

/** §21.1 장기 기억 플래그 레코드. (key, scope, ownerId) 기준 중복 없음. */
export const FlagRecordSchema = z
  .object({
    key: ContentIdSchema,
    scope: FlagScopeSchema,
    ownerId: z.string().nullable(),
    value: z.union([z.boolean(), z.number(), z.string()]),
    createdTurn: z.number().int().min(0),
    expiresTurn: z.number().int().min(0).nullable(),
    sourceEventId: EventIdSchema.nullable(),
  })
  .strict();
export type FlagRecord = z.infer<typeof FlagRecordSchema>;

export const ScheduledEventSchema = z
  .object({
    scheduleId: z.string().min(1),
    eventId: EventIdSchema,
    dueTurn: z.number().int().min(0),
    priority: z.number().int(),
    sourceOccurrenceId: z.string().nullable(),
    /** S8 예약한 사건의 참여 동료를 다음 화로 이어받는다 */
    participantNpcId: z.string().nullable(),
    status: z.enum(['PENDING', 'DONE', 'EXPIRED']),
  })
  .strict();
export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;

export const ActiveEventSchema = z
  .object({
    occurrenceId: z.string().min(1),
    eventId: EventIdSchema,
    eventVersion: z.number().int().min(1),
    participantNpcId: z.string().nullable(),
    presentedTurn: z.number().int().min(0),
  })
  .strict();
export type ActiveEvent = z.infer<typeof ActiveEventSchema>;

export const EventOccurrenceSchema = z
  .object({
    occurrenceId: z.string().min(1),
    eventId: EventIdSchema,
    eventVersion: z.number().int().min(1),
    turnIndex: z.number().int().min(0),
    choiceId: z.string(),
    participantNpcId: z.string().nullable(),
    /** 판정 없는 선택지는 null */
    success: z.boolean().nullable(),
    chance: z.number().nullable(),
    roll: z.number().nullable(),
    highRisk: z.boolean(),
  })
  .strict();
export type EventOccurrence = z.infer<typeof EventOccurrenceSchema>;

export const TraitHistoryEntrySchema = z
  .object({
    eventId: EventIdSchema,
    occurrenceId: z.string(),
    traitId: ContentIdSchema,
    from: TraitLevelSchema,
    to: TraitLevelSchema,
    turnIndex: z.number().int().min(0),
    reason: z.enum(['grant', 'upgrade', 'worsen', 'recover']),
  })
  .strict();
export type TraitHistoryEntry = z.infer<typeof TraitHistoryEntrySchema>;

export const HistoryEntrySchema = z
  .object({
    turnIndex: z.number().int().min(0),
    kind: z.enum([
      'RUN_CREATED',
      'CHARACTER_SELECTED',
      'GOAL_SELECTED',
      'JOB_APPLICATION',
      'PROMOTION',
      'TRANSFER',
      'NEWS',
      'NPC_TEAM_CREATED',
      'EVENT_RESOLVED',
      'ENDING',
      'PLAYTEST_OVERRIDE',
    ]),
    summary: z.string(),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const GameRunStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    guestOwnerId: z.string().min(1),
    seed: z.string().min(1),
    /** 판정용 주 RNG 스트림 상태 (uint32) */
    rngState: z.number().int().min(0).max(0xffffffff),
    engineVersion: z.string(),
    /** 새 플레이 생성 시 고정 (§23.1) */
    contentVersion: z.string(),
    stateRevision: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    phase: RunPhaseSchema,
    profile: PlayerProfileSchema,
    characterCards: z.array(CharacterCardSchema),
    selectedCharacter: CharacterCardSchema.nullable(),
    /** 인생 목표 후보 3장 (GOAL_SELECTION에서 고정) */
    lifeGoalOffers: z.array(ContentIdSchema),
    lifeGoal: LifeGoalStateSchema.nullable(),
    jobOffers: z.array(JobOfferSchema),
    /** S7 이직 제안서 (헤드헌터 사건 성공 시, 그달 결산에서만 유효) */
    transferOffer: TransferOfferSchema.nullable(),
    jobSearch: JobSearchSchema,
    employment: EmploymentSchema,
    resources: ResourcesSchema,
    cash: Krw.nonnegative(),
    debt: Krw.nonnegative(),
    skills: TraitLevelsSchema,
    negativeTraits: TraitLevelsSchema,
    skillHistory: z.array(TraitHistoryEntrySchema),
    traitHistory: z.array(TraitHistoryEntrySchema),
    backgroundTraits: z.array(ContentIdSchema),
    flags: z.array(FlagRecordSchema),
    scheduledEvents: z.array(ScheduledEventSchema),
    eventOccurrences: z.array(EventOccurrenceSchema),
    activeEvent: ActiveEventSchema.nullable(),
    /** 이번 달 대기 중인 다음 사건 (월 2개: 업무 → 일상) */
    pendingEvents: z.array(PendingEventSchema),
    npcs: z.array(NpcSchema),
    npcAssignments: z.array(NpcAssignmentSchema),
    eventHistory: z.array(HistoryEntrySchema),
    annualReviews: z.array(AnnualReviewSchema),
    annualReviewProcessedYear: z.number().int().nullable(),
    salaryAdjustedYear: z.number().int().nullable(),
    statistics: z
      .object({
        totalEarned: Krw.nonnegative(),
        totalSpent: Krw.nonnegative(),
        jobChanges: z.number().int().min(0),
        highestRank: PlayerRankSchema.nullable(),
        consecutiveHighRiskMonths: z.number().int().min(0),
        /** 매달 말 체력·정신력 중 낮은 쪽의 커리어 최저값 (워라밸 목표 판정) */
        lowestWellbeing: z.number().int().min(0).max(100),
        /** S7 이직 횟수 */
        transfers: z.number().int().min(0),
      })
      .strict(),
    currentMonth: MonthLogSchema.nullable(),
    /** MONTH_SUMMARY에서 판정된 엔딩. nextMonth에서 ending으로 확정된다 (§26.2). */
    pendingEnding: EndingSchema.nullable(),
    ending: EndingSchema.nullable(),
    /** 플레이테스트 도구로 조작된 적이 있는 run (기록·랭킹 제외 대상) */
    playtestModified: z.boolean(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .strict();
export type GameRunState = z.infer<typeof GameRunStateSchema>;
