import {
  turnInfo,
  type Conditions,
  type FlagRecord,
  type FlagRef,
  type GameRunState,
  type IntRange,
  type LevelRange,
  type Npc,
  type NpcCondition,
  type TraitLevel,
  type TraitLevels,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';

/** 조건 평가 컨텍스트. participant는 사건에 참여하는 NPC (없으면 null). */
export interface EvalContext {
  participant: Npc | null;
}

export function traitLevel(levels: TraitLevels, id: string): TraitLevel {
  return levels[id] ?? 0;
}

export function inRange(value: number, range: IntRange | LevelRange): boolean {
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

/** §21.1 플래그 유효성: 만료(currentTurn >= expiresTurn)·회사·NPC 범위 경계 */
export function isFlagActive(flag: FlagRecord, state: GameRunState, ctx: EvalContext): boolean {
  if (flag.expiresTurn !== null && state.turnIndex >= flag.expiresTurn) return false;
  switch (flag.scope) {
    case 'RUN':
    case 'TEMPORARY':
      return true;
    case 'COMPANY':
      return flag.ownerId !== null && flag.ownerId === state.employment.current?.companyId;
    case 'NPC':
      return flag.ownerId !== null && flag.ownerId === ctx.participant?.npcId;
  }
}

export function hasActiveFlag(state: GameRunState, ref: FlagRef, ctx: EvalContext): boolean {
  return state.flags.some((f) => f.key === ref.key && f.scope === ref.scope && isFlagActive(f, state, ctx));
}

export function npcMatches(npc: Npc, cond: NpcCondition): boolean {
  if (!npc.active || npc.role !== cond.role) return false;
  if (cond.personalityAny && !cond.personalityAny.some((t) => npc.personalityTags.includes(t))) return false;
  if (cond.relation) {
    for (const [stat, range] of Object.entries(cond.relation)) {
      if (range && !inRange(npc[stat as 'favor' | 'trust' | 'rivalry'], range)) return false;
    }
  }
  return true;
}

/** 선언형 조건 평가. eval 없이 필드별 규칙만 해석한다 (§7.5). */
export function matchesConditions(
  state: GameRunState,
  cond: Conditions | undefined,
  ctx: EvalContext,
  content: ContentIndex,
): boolean {
  if (!cond) return true;
  const job = state.employment.current;

  if (cond.employment !== undefined) {
    const allowed = Array.isArray(cond.employment) ? cond.employment : [cond.employment];
    if (!allowed.includes(state.employment.status)) return false;
  }
  if (cond.age && !inRange(turnInfo(state.turnIndex, content.pack.rules.startAge).age, cond.age))
    return false;
  if (cond.companyGrades) {
    const grade = job ? content.companies.get(job.companyId)?.grade : undefined;
    if (!grade || !cond.companyGrades.includes(grade)) return false;
  }
  if (cond.jobs && (!job || !cond.jobs.includes(job.jobId))) return false;
  if (cond.ranks && (!job || !cond.ranks.includes(job.rank))) return false;
  if (cond.resources) {
    for (const [key, range] of Object.entries(cond.resources)) {
      if (range && !inRange(state.resources[key as keyof GameRunState['resources']], range)) return false;
    }
  }
  if (cond.transfers && !inRange(state.statistics.transfers, cond.transfers)) return false;
  // S8 동시에 한 편: 아직 열리지 않은 연재 화가 예약돼 있으면 새 연재를 시작하지 않는다
  if (
    cond.seriesNone &&
    state.scheduledEvents.some((s) => s.status === 'PENDING' && content.events.get(s.eventId)?.series)
  )
    return false;
  if (cond.tenureMonths && (!job || !inRange(state.turnIndex - job.startedTurn, cond.tenureMonths)))
    return false;
  if (cond.cash && !inRange(state.cash, cond.cash)) return false;
  if (cond.debt && !inRange(state.debt, cond.debt)) return false;
  if (cond.skillAbsent?.some((id) => traitLevel(state.skills, id) > 0)) return false;
  if (cond.skillLevels) {
    for (const [id, range] of Object.entries(cond.skillLevels)) {
      if (!inRange(traitLevel(state.skills, id), range)) return false;
    }
  }
  if (cond.negativeTraitAbsent?.some((id) => traitLevel(state.negativeTraits, id) > 0)) return false;
  if (cond.negativeTraitLevels) {
    for (const [id, range] of Object.entries(cond.negativeTraitLevels)) {
      if (!inRange(traitLevel(state.negativeTraits, id), range)) return false;
    }
  }
  if (
    cond.backgroundTraitsAny &&
    !cond.backgroundTraitsAny.some((id) => state.backgroundTraits.includes(id))
  ) {
    return false;
  }
  if (cond.flagsAll && !cond.flagsAll.every((ref) => hasActiveFlag(state, ref, ctx))) return false;
  if (cond.flagsNone?.some((ref) => hasActiveFlag(state, ref, ctx))) return false;
  if (cond.npc && (!ctx.participant || !npcMatches(ctx.participant, cond.npc))) return false;
  return true;
}
