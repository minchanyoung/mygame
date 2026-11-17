import { z } from 'zod';

/**
 * 엔진 구조에 직접 관여하는 열거형만 코드에 둔다.
 * 특성(능력/부정 특성)·NPC 성향·배경 특성 ID는 콘텐츠 데이터가 정의하며,
 * 콘텐츠 검증기에서 마스터 데이터 존재 여부를 확인한다.
 */

export const ENGINE_VERSION = '0.1.0';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'] as const;
export const GenderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;
/** enum과 표시명을 분리한다 (§3.1). 서비스 정책에 따라 표시명만 바꿀 수 있다. */
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: '남성',
  FEMALE: '여성',
  OTHER: '기타',
  UNSPECIFIED: '밝히지 않음',
};

/**
 * 저장되는(지속) 런 단계. §2.2/§20.1의 CREATED, JOB_APPLICATION, SETTLEMENT, SCHEDULED_CHECK,
 * EVENT_RESOLUTION은 한 명령 안에서 원자적으로 지나가는 내부 단계이므로 저장하지 않는다.
 */
export const RUN_PHASES = [
  'PROFILE_INPUT',
  'CHARACTER_SELECTION',
  'JOB_OFFERS',
  'MONTH_START',
  'EVENT_PENDING',
  'MONTH_SUMMARY',
  'GAME_OVER',
] as const;
export const RunPhaseSchema = z.enum(RUN_PHASES);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RUN_COMMANDS = [
  'createCards',
  'chooseCharacter',
  'apply',
  'startMonth',
  'choose',
  'nextMonth',
  'getResult',
] as const;
export type RunCommand = (typeof RUN_COMMANDS)[number];

export const COMPANY_GRADES = ['S', 'A', 'B', 'C', 'D', 'F'] as const;
export const CompanyGradeSchema = z.enum(COMPANY_GRADES);
export type CompanyGrade = z.infer<typeof CompanyGradeSchema>;

export const JOB_IDS = ['DEV', 'HR', 'SALES', 'FINANCE', 'PLANNING'] as const;
export const JobIdSchema = z.enum(JOB_IDS);
export type JobId = z.infer<typeof JobIdSchema>;
export const JOB_LABELS: Record<JobId, string> = {
  DEV: '개발',
  HR: '인사',
  SALES: '영업',
  FINANCE: '재무',
  PLANNING: '기획',
};

export const PLAYER_RANKS = ['STAFF', 'ASSISTANT_MANAGER', 'MANAGER', 'DEPARTMENT_HEAD'] as const;
export const PlayerRankSchema = z.enum(PLAYER_RANKS);
export type PlayerRank = z.infer<typeof PlayerRankSchema>;
/** NPC 계층 전용 확장 직급 EXECUTIVE (§21.2). 플레이어 직급이 아니다. */
export const NPC_RANKS = [...PLAYER_RANKS, 'EXECUTIVE'] as const;
export const NpcRankSchema = z.enum(NPC_RANKS);
export type NpcRank = z.infer<typeof NpcRankSchema>;
export const RANK_LABELS: Record<NpcRank, string> = {
  STAFF: '사원',
  ASSISTANT_MANAGER: '대리',
  MANAGER: '과장',
  DEPARTMENT_HEAD: '부장',
  EXECUTIVE: '임원',
};

export const EMPLOYMENT_STATUSES = ['EMPLOYED', 'UNEMPLOYED', 'ON_LEAVE', 'RETIRED', 'ENDED'] as const;
export const EmploymentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = z.infer<typeof EmploymentStatusSchema>;

/** 0~100 단기 자원. 돈/부채는 별도 원화 정수 (§4.1). */
export const RESOURCE_KEYS = ['health', 'mental', 'focus', 'reputation'] as const;
export const ResourceKeySchema = z.enum(RESOURCE_KEYS);
export type ResourceKey = z.infer<typeof ResourceKeySchema>;
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  health: '체력',
  mental: '정신력',
  focus: '집중력',
  reputation: '평판',
};

export const NPC_ROLES = ['BOSS', 'PEER'] as const;
export const NpcRoleSchema = z.enum(NPC_ROLES);
export type NpcRole = z.infer<typeof NpcRoleSchema>;
export const NPC_ASSIGNMENT_ROLES = ['BOSS', 'PEER', 'FORMER_BOSS'] as const;
export const NpcAssignmentRoleSchema = z.enum(NPC_ASSIGNMENT_ROLES);

export const NPC_RELATION_STATS = ['favor', 'trust', 'rivalry'] as const;
export const NpcRelationStatSchema = z.enum(NPC_RELATION_STATS);
export type NpcRelationStat = z.infer<typeof NpcRelationStatSchema>;

export const FLAG_SCOPES = ['RUN', 'COMPANY', 'NPC', 'TEMPORARY'] as const;
export const FlagScopeSchema = z.enum(FLAG_SCOPES);
export type FlagScope = z.infer<typeof FlagScopeSchema>;

export const EVENT_CATEGORIES = ['daily', 'work', 'company', 'social', 'economy', 'life', 'rare'] as const;
export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

export const RARITIES = ['common', 'uncommon', 'rare', 'epic'] as const;
export const RaritySchema = z.enum(RARITIES);

export const EVENT_STATUSES = ['draft', 'published', 'archived'] as const;
export const EventStatusSchema = z.enum(EVENT_STATUSES);

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LABELS: Record<RiskLevel, string> = { LOW: '낮음', MEDIUM: '보통', HIGH: '높음' };

/** 콘텐츠 정의 ID 형식 (특성/성향/배경/플래그 키). */
export const ContentIdSchema = z.string().regex(/^[a-zA-Z][A-Za-z0-9_]{1,63}$/, '영문으로 시작하는 ID');
export const EventIdSchema = z.string().regex(/^evt_[a-z0-9_]{2,63}$/, 'evt_ 접두사 소문자 ID');
export const CompanyIdSchema = z.string().regex(/^company_[a-z0-9_]{2,63}$/, 'company_ 접두사 소문자 ID');

/** §26.5 이벤트로 인한 비자발적 실직 사유. 자발적 퇴사 사유는 존재하지 않는다 (§26.1). */
export const JOB_LOSS_REASONS = ['LAYOFF', 'RESTRUCTURING', 'FORCED_RESIGNATION', 'COMPANY_CLOSURE'] as const;
export const JobLossReasonSchema = z.enum(JOB_LOSS_REASONS);
export type JobLossReason = z.infer<typeof JobLossReasonSchema>;

/**
 * §26 엔딩 원인. 배열 순서 앞부분(자원 0 → 부채 → 이벤트 실직)이 같은 달 판정 우선순위다.
 * RETIREMENT는 nextMonth에서 별도 판정한다.
 */
export const ENDING_CAUSES = [
  'OVERWORK_DISMISSAL',
  'BURNOUT_DISMISSAL',
  'FATAL_MISTAKE',
  'OUSTED',
  'DEBT_SPIRAL',
  ...JOB_LOSS_REASONS,
  'RETIREMENT',
] as const;
export const EndingCauseSchema = z.enum(ENDING_CAUSES);
export type EndingCause = z.infer<typeof EndingCauseSchema>;
export const EndingTypeSchema = z.enum([...ENDING_CAUSES, 'EARLY_RETIREMENT']);
export type EndingType = z.infer<typeof EndingTypeSchema>;

/** 0이 되면 즉시 실직하는 자원과 원인 (§26.1). 순서 = 우선순위. */
export const RESOURCE_ENDING_CAUSE = {
  health: 'OVERWORK_DISMISSAL',
  mental: 'BURNOUT_DISMISSAL',
  focus: 'FATAL_MISTAKE',
  reputation: 'OUSTED',
} as const satisfies Record<ResourceKey, EndingCause>;

/** 영구 특성 레벨: 0 = 미보유(저장하지 않음), 1, 2. MVP 상한 2 (§4.2). */
export const TraitLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type TraitLevel = z.infer<typeof TraitLevelSchema>;
export const OwnedTraitLevelSchema = z.union([z.literal(1), z.literal(2)]);
export type OwnedTraitLevel = z.infer<typeof OwnedTraitLevelSchema>;
