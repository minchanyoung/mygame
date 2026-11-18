import { GameRunStateSchema, type GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { EngineError } from './errors';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 저장된 run을 현재 상태 스키마로 끌어올린다 (업데이트 후에도 이어하기가 되도록).
 * 나중 버전에서 추가된 필드는 안전한 기본값으로 채우고, 제거된 필드는 버린다.
 * 콘텐츠 참조 검사는 하지 않는다 — rebindContentVersion이 담당한다.
 */
export function migrateRunState(raw: unknown): GameRunState {
  if (!isObj(raw)) throw new EngineError('INVARIANT_VIOLATION', 'saved run is not an object');
  const s: Obj = structuredCloneJson(raw);

  // S5: 인생 목표
  s.lifeGoalOffers ??= [];
  s.lifeGoal ??= null;

  // S6: 가정 환경 제거
  const stripCard = (c: unknown) => {
    if (isObj(c)) delete c.familyId;
  };
  if (Array.isArray(s.characterCards)) s.characterCards.forEach(stripCard);
  stripCard(s.selectedCharacter);

  // S5: 승진 필드
  const employment = s.employment;
  if (isObj(employment) && isObj(employment.current)) {
    const cur = employment.current;
    cur.rankSinceTurn ??= cur.startedTurn ?? 0;
    cur.promotionPoints ??= 0;
    cur.promotionMisses ??= 0;
  }

  // S4/S5: 이번 달 기록
  if (isObj(s.currentMonth)) {
    const m = s.currentMonth;
    m.promotion ??= null;
    m.goalMilestone ??= null;
    m.news ??= [];
    m.eventResults ??= [];
  }
  s.pendingEvents ??= [];
  // S8: 예약 사건의 참여 동료
  if (Array.isArray(s.scheduledEvents))
    for (const x of s.scheduledEvents) if (isObj(x)) x.participantNpcId ??= null;

  // S6: 커리어 최저 컨디션 (기록이 없던 세이브는 현재 값으로 시작)
  if (isObj(s.statistics)) {
    const r = isObj(s.resources) ? s.resources : {};
    s.statistics.lowestWellbeing ??= Math.min(Number(r.health ?? 100), Number(r.mental ?? 100));
  }

  // S5: 엔딩의 목표 판정 / S7: 노후 등급
  for (const key of ['ending', 'pendingEnding'] as const) {
    const e = s[key];
    if (isObj(e)) {
      e.goal ??= null;
      e.retirementTier ??= null;
      // S9 별명: 옛 엔딩은 판정하지 않는다
      e.titles ??= null;
    }
  }

  // S9 인생 연대기: 연간 기록은 업데이트 이후부터 쌓인다 (과거 추정치를 만들지 않음)
  s.yearlyRecords ??= [];
  if (isObj(s.statistics)) {
    s.statistics.nearCollapseMonths ??= 0;
    s.statistics.maxHighRiskStreak ??= Number(s.statistics.consecutiveHighRiskMonths ?? 0);
    s.statistics.peakDebtPermille ??= 0;
  }

  // S7: 이직·임원
  s.transferOffer ??= null;
  if (isObj(s.statistics)) s.statistics.transfers ??= 0;
  if (isObj(employment)) {
    employment.promotedToExecutive ??= false;
    if (isObj(employment.current)) employment.current.probationUntilTurn ??= null;
  }

  const parsed = GameRunStateSchema.safeParse(s);
  if (!parsed.success) {
    throw new EngineError('INVARIANT_VIOLATION', 'saved run cannot be migrated', {
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return parsed.data;
}

/**
 * run이 고정된 콘텐츠 버전이 더 이상 서버에 없을 때, 최신 콘텐츠로 옮겨도 되는지 확인하고 옮긴다.
 * 진행 중인 사건·예약 사건·회사·목표·특성 등 run이 가리키는 ID가 최신 콘텐츠에 모두 있어야 한다.
 * 없어진 배경 특성(예: 가정 환경)은 효과가 이미 시작 상태에 반영되어 있으므로 목록에서만 뺀다.
 * 옮길 수 없으면 null.
 */
export function rebindContentVersion(state: GameRunState, content: ContentIndex): GameRunState | null {
  const hasEvent = (id: string) => content.events.has(id);
  const job = state.employment.current;
  const ok =
    (!state.activeEvent || hasEvent(state.activeEvent.eventId)) &&
    state.pendingEvents.every((p) => hasEvent(p.eventId)) &&
    (!job || content.companies.has(job.companyId)) &&
    state.npcs.every((n) => content.companies.has(n.companyId)) &&
    (!state.lifeGoal || content.pack.lifeGoals.some((g) => g.id === state.lifeGoal!.goalId)) &&
    state.lifeGoalOffers.every((id) => content.pack.lifeGoals.some((g) => g.id === id)) &&
    Object.keys({ ...state.skills, ...state.negativeTraits }).every((id) => content.traits.has(id)) &&
    state.jobOffers.every((o) => content.companies.has(o.companyId));
  if (!ok) return null;
  return {
    ...state,
    contentVersion: content.pack.contentVersion,
    backgroundTraits: state.backgroundTraits.filter((id) => content.backgrounds.has(id)),
    // 사라진 사건의 예약은 만료 처리
    scheduledEvents: state.scheduledEvents.map((x) =>
      x.status === 'PENDING' && !hasEvent(x.eventId) ? { ...x, status: 'EXPIRED' as const } : x,
    ),
  };
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
