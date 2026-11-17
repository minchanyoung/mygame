import { z } from 'zod';
import type {
  CompanyGrade,
  EmploymentStatus,
  EndingType,
  Gender,
  JobId,
  NpcRank,
  NpcRole,
  PlayerRank,
  RiskLevel,
  RunPhase,
} from './enums';
import type { Resources } from './state-schema';

/** §23.3 API 계약. 쓰기 요청은 idempotencyKey + expectedRevision을 포함한다. */

export const GUEST_TOKEN_HEADER = 'x-guest-token';

const IdempotencyKeySchema = z.string().min(8).max(100);
const RevisionSchema = z.number().int().min(0);

export const ChooseCharacterRequestSchema = z
  .object({
    cardId: z.string().min(1).max(100),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type ChooseCharacterRequest = z.infer<typeof ChooseCharacterRequestSchema>;

export const ApplyJobRequestSchema = z
  .object({
    offerId: z.string().min(1).max(100),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type ApplyJobRequest = z.infer<typeof ApplyJobRequestSchema>;

/** startMonth / nextMonth: 본문은 재시도 보호 정보뿐 */
export const CommandRequestSchema = z
  .object({ idempotencyKey: IdempotencyKeySchema, expectedRevision: RevisionSchema })
  .strict();
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

/** 현재 사건(occurrenceId)에 대한 선택. 다른 사건의 선택지를 잘못 제출하는 것을 막는다. */
export const ChooseRequestSchema = z
  .object({
    occurrenceId: z.string().min(1).max(100),
    choiceId: z.string().min(1).max(60),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type ChooseRequest = z.infer<typeof ChooseRequestSchema>;

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_PHASE'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CONTENT_VERSION_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | (string & {});

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details: unknown;
  requestId: string;
}

// ───────── 공개 뷰 (서버 정본 상태에서 공개 가능한 정보만 투영) ─────────

export interface PublicBackgroundTrait {
  id: string;
  kind: 'UNIVERSITY' | 'MAJOR' | 'FAMILY' | 'STRENGTH' | 'WEAKNESS';
  name: string;
  description: string;
}

export interface PublicCharacterCard {
  cardId: string;
  displayName: string;
  gender: Gender;
  genderLabel: string;
  startAge: number;
  university: PublicBackgroundTrait;
  major: PublicBackgroundTrait;
  family: PublicBackgroundTrait;
  strength: PublicBackgroundTrait;
  weakness: PublicBackgroundTrait;
  resources: Resources;
  cash: number;
  debt: number;
  /** 항상 0 — 영구 능력/부정 특성은 시작 시 비어 있다. */
  permanentTraitCount: number;
}

export interface PublicJobOffer {
  offerId: string;
  companyName: string;
  companyDescription: string;
  grade: CompanyGrade;
  industry: string;
  jobId: JobId;
  jobLabel: string;
  /** 정확한 합격률(정수 %) — 채용 카드만 공개 (§22.1). */
  hireChancePercent: number;
  annualSalary: number;
  workload: number;
  stability: number;
  /** 첫 구직 합격 확정 카드 (§26.4) */
  guaranteed: boolean;
  reasons: string[];
}

export interface PublicTrait {
  id: string;
  name: string;
  level: 1 | 2;
  effect: string;
}

export interface PublicNpc {
  npcId: string;
  name: string;
  role: NpcRole;
  roleLabel: string;
  rank: NpcRank;
  rankLabel: string;
  personalities: Array<{ id: string; name: string }>;
  /** 정확한 호감/신뢰 수치는 비공개, 대략적인 관계 표현만 (§22.1). */
  relationLabel: string;
}

export interface PublicChoice {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  lockedHint?: string;
  /** 판정 없는 선택지는 null. 정확한 확률은 비공개 (§22.1). */
  risk: RiskLevel | null;
  riskLabel: string | null;
  appliedTraits: string[];
  costs: string[];
  /** 확정 비용만으로 실직 엔딩에 닿는 선택지 경고 (§26.3), 예: "⚠ 선택 시 과로 실직" */
  fatalWarning: string | null;
}

export interface PublicWarning {
  code: 'HEALTH_CRITICAL' | 'MENTAL_CRITICAL' | 'FOCUS_CRITICAL' | 'REPUTATION_CRITICAL' | 'DEBT_CRITICAL';
  message: string;
}

export interface PublicEnding {
  type: EndingType;
  category: 'FAILURE' | 'NORMAL';
  title: string;
  text: string;
  age: number;
}

export interface PublicMonthSummary {
  turnIndex: number;
  netSalary: number;
  livingCost: number;
  interest: number;
  resourceDelta: Resources;
  cashDelta: number;
  debtDelta: number;
  event: {
    title: string;
    choiceLabel: string;
    success: boolean | null;
    resultText: string | null;
    traitChanges: string[];
  } | null;
}

export interface PublicActiveEvent {
  occurrenceId: string;
  eventId: string;
  title: string;
  description: string;
  participantName: string | null;
  choices: PublicChoice[];
}

export interface PublicRunView {
  runId: string;
  revision: number;
  phase: RunPhase;
  contentVersion: string;
  turn: { turnIndex: number; age: number; yearIndex: number; monthOfYear: number };
  profile: { displayName: string; gender: Gender; genderLabel: string };
  characterCards: PublicCharacterCard[];
  selectedCardId: string | null;
  jobOffers: PublicJobOffer[];
  jobSearch: {
    consecutiveRejections: number;
    lastResult: { companyName: string; hired: boolean; autoAssignedCompanyName: string | null } | null;
  };
  employment: {
    status: EmploymentStatus;
    companyName: string | null;
    grade: CompanyGrade | null;
    jobLabel: string | null;
    rank: PlayerRank | null;
    rankLabel: string | null;
    annualSalary: number | null;
  };
  resources: Resources;
  cash: number;
  debt: number;
  netWorth: number;
  skills: PublicTrait[];
  negativeTraits: PublicTrait[];
  npcs: PublicNpc[];
  activeEvent: PublicActiveEvent | null;
  warnings: PublicWarning[];
  monthSummary: PublicMonthSummary | null;
  /** MONTH_SUMMARY에서 예고된 엔딩 (다음 달을 누르면 확정) */
  pendingEnding: PublicEnding | null;
  ending: PublicEnding | null;
  /** 플레이테스트 도구로 조작된 run */
  playtestModified: boolean;
}

export interface CreateRunResponse {
  runId: string;
  guestToken: string;
  view: PublicRunView;
}

// ───────── 플레이테스트 도구 (서버 환경 변수 PLAYTEST_TOOLS=1일 때만 활성) ─────────
// 조작된 run은 state.playtestModified = true로 영구 표시되어 이후 기록/랭킹에서 구분된다.

const Stat = z.number().int().min(0).max(100);
const OwnedLevel = z.union([z.literal(1), z.literal(2)]);

export const PlaytestPatchRequestSchema = z
  .object({
    resources: z
      .object({ health: Stat, mental: Stat, focus: Stat, reputation: Stat })
      .partial()
      .strict()
      .optional(),
    cash: z.number().int().min(0).max(100_000_000_000).optional(),
    debt: z.number().int().min(0).max(100_000_000_000).optional(),
    /** 나이만 바꾸고 월은 유지한다 */
    age: z.number().int().min(15).max(79).optional(),
    /** 지정하면 해당 컬렉션 전체를 교체한다 */
    skills: z.record(z.string(), OwnedLevel).optional(),
    negativeTraits: z.record(z.string(), OwnedLevel).optional(),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type PlaytestPatchRequest = z.infer<typeof PlaytestPatchRequestSchema>;

export const PlaytestForceEventRequestSchema = z
  .object({
    eventId: z.string().min(1).max(80),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type PlaytestForceEventRequest = z.infer<typeof PlaytestForceEventRequestSchema>;

/** 플레이테스트 전용: 평소에는 숨기는 정확한 확률·숨김 수치 */
export interface PlaytestDebugView {
  seed: string;
  rngState: number;
  playtestModified: boolean;
  activeEventChoices: Array<{
    id: string;
    label: string;
    visible: boolean;
    enabled: boolean;
    exactChancePercent: number | null;
    breakdown: string[];
  }>;
  eligibleEvents: Array<{ eventId: string; title: string; weight: number; chancePercent: number }>;
  npcs: Array<{
    name: string;
    role: string;
    personalityTags: string[];
    favor: number;
    trust: number;
    rivalry: number;
    competence: number;
  }>;
  flags: Array<{ key: string; scope: string; expiresTurn: number | null }>;
  debtLimit: number | null;
}

export interface PlaytestCatalog {
  events: Array<{ id: string; title: string; special: boolean; highRisk: boolean; tags: string[] }>;
  traits: Array<{ id: string; name: string; polarity: 'POSITIVE' | 'NEGATIVE'; active: boolean }>;
}
