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
  ReviewGrade,
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

export const ChooseGoalRequestSchema = z
  .object({
    goalId: z.string().min(1).max(64),
    idempotencyKey: IdempotencyKeySchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type ChooseGoalRequest = z.infer<typeof ChooseGoalRequestSchema>;

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

/** 게임 데이터에서 자동 계산한 실제 효과 한 줄 (카드 문구 = 실제 규칙) */
export interface PublicEffect {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  /** 관련 사건 이름 등 근거 */
  detail?: string;
}

export interface PublicBackgroundTrait {
  id: string;
  kind: 'UNIVERSITY' | 'MAJOR' | 'FAMILY' | 'STRENGTH' | 'WEAKNESS';
  name: string;
  description: string;
  rare: boolean;
  effects: PublicEffect[];
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
  /** 전공·강점·약점의 합격률 보정 합이 가장 큰 직무 (근거 있는 추천) */
  recommendedJob: { jobId: JobId; label: string; bonusPercent: number };
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
  /** 고르면 메신저에 보내는 내 답장 */
  reply: string;
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
  /** 커리어 최고 직급 */
  highestRankLabel: string | null;
  /** 인생 목표 판정 (목표가 없으면 null). 실패 엔딩은 자동 미달성. */
  goal: { title: string; emoji: string; achieved: boolean; text: string } | null;
}

/** S5 인생 목표 카드 */
export interface PublicLifeGoal {
  id: string;
  title: string;
  emoji: string;
  description: string;
  /** 배경 특성과 어울리는 목표 */
  fitting: boolean;
}

export interface PublicLifeGoalProgress extends PublicLifeGoal {
  percent: number;
  /** 예: "순자산 4,200만 / 3억" */
  progressLabel: string;
}

/** 메인 화면 승진 진행 (확률은 비공개, 근속·포인트만) */
export interface PublicPromotionStatus {
  nextRankLabel: string | null;
  yearsInRank: number;
  minYears: number;
  points: number;
  requiredPoints: number;
  /** PIP 경고 등으로 심사가 막힘 */
  blocked: boolean;
  /** 다음 1월 심사 대상 */
  eligible: boolean;
}

/** 1월 인사발령 */
export interface PublicPromotionResult {
  success: boolean;
  fromLabel: string;
  toLabel: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  newBossName: string | null;
  misses: number;
}

export interface PublicMonthSummary {
  turnIndex: number;
  /** 급여명세서: 월 기본급(세전) → 공제 → 실지급 */
  grossSalary: number;
  tax: number;
  netSalary: number;
  livingCost: number;
  livingBreakdown: Array<{ label: string; amount: number }>;
  interest: number;
  debtRepayment: number;
  /** 12월 인사평가표 */
  annualReview: PublicReview | null;
  /** 1월 연봉 조정 */
  salaryAdjustment: { grade: ReviewGrade | null; from: number; to: number } | null;
  /** 1월 승진 심사 (대상이 아니면 null) */
  promotion: PublicPromotionResult | null;
  /** 이번 달 새로 넘은 인생 목표 진행 구간 */
  goalMilestone: number | null;
  resourceDelta: Resources;
  cashDelta: number;
  debtDelta: number;
  /** 이달의 이야기들 (업무 → 일상) */
  events: PublicStory[];
}

export interface PublicReview {
  grade: ReviewGrade;
  score: number;
  reputationDelta: number;
  items: Array<{ label: string; score: number; grade: ReviewGrade; note: string }>;
  traitAdjustment: number;
  bonus: number;
  bossName: string | null;
  comment: string;
  /** 성과 개선 프로그램 경고 대상 */
  warning: boolean;
}

/** 메신저 한 줄 (화자 이름은 실제 NPC로 채워짐) */
export interface PublicChatLine {
  side: 'other' | 'self' | 'system' | 'narration';
  name: string | null;
  initial: string | null;
  text: string;
}

/** 이야기: 상황 → 선택(내 답장) → 반응 대화 → 결과 → 영향 */
export interface PublicStory {
  occurrenceId: string;
  slot: 'work' | 'life';
  title: string;
  categoryLabel: string;
  channelName: string;
  /** 상황 설명 */
  situation: string;
  participantName: string | null;
  choiceLabel: string;
  /** 내가 보낸 답장 */
  reply: string;
  /** 선택 후 이어진 대화 */
  aftermath: PublicChatLine[];
  success: boolean | null;
  verdictLabel: '성공' | '실패' | '확정';
  /** 결과 문장 (콘텐츠 문장이 없으면 판정에 맞는 기본 문장) */
  resultText: string;
  /** 판정에 작용한 요인 — 수치 없이 이름과 유불리만 (§22.1) */
  factors: Array<{ label: string; positive: boolean }>;
  /** 이 사건으로 생긴 변화 */
  effects: PublicEffect[];
  /** NPC 관계 변화 — 방향만 */
  relationChanges: string[];
  traitChanges: string[];
  followUpHint: string | null;
}

export interface PublicActiveEvent {
  occurrenceId: string;
  eventId: string;
  slot: 'work' | 'life';
  /** 이번 달 몇 번째 사건인지 (1/2) */
  position: { index: number; total: number };
  title: string;
  description: string;
  category: string;
  /** 표시용 사건 분류 이름 (업무, 사내 공지 등) */
  categoryLabel: string;
  /** 메신저 채널 이름 */
  channelName: string;
  /** 사건 시작 대화 */
  dialogue: PublicChatLine[];
  participantName: string | null;
  participant: Omit<PublicNpc, 'npcId'> | null;
  choices: PublicChoice[];
}

/** 메인 화면 1년 달력 (§UI-1). 예약 사건이 있는 달은 내용 없이 '?'로만 알린다. */
export interface PublicCalendar {
  age: number;
  months: Array<{
    month: number;
    status: 'PAST' | 'CURRENT' | 'FUTURE';
    review: boolean;
    scheduled: boolean;
  }>;
}

export interface PublicHistoryEntry {
  age: number;
  month: number;
  kind: string;
  summary: string;
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
    /** 가장 최근 인사평가 등급 */
    lastReviewGrade: ReviewGrade | null;
    /** 현재 회사 입사 시점 */
    startedAge: number | null;
    startedMonth: number | null;
    promotion: PublicPromotionStatus | null;
  };
  /** GOAL_SELECTION에서 고를 인생 목표 후보 */
  lifeGoalOffers: PublicLifeGoal[];
  lifeGoal: PublicLifeGoalProgress | null;
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
  calendar: PublicCalendar;
  /** 최근 인생 기록 (최신순, 내부 판정 수치 제외) */
  history: PublicHistoryEntry[];
  /** 방금 끝난 사건의 이야기 (같은 달 안에서 결과 대화를 보여주기 위함) */
  lastStory: PublicStory | null;
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
