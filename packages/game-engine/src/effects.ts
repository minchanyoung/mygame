import type {
  Effect,
  GameRunState,
  Npc,
  OwnedTraitLevel,
  TraitHistoryEntry,
  TraitLevel,
} from '@company-life/shared';
import { inflate } from './economy';
import { EngineError } from './errors';
import { clampStat } from './numbers';
import { currentTeamNpcs } from './npcs';

export interface EffectContext {
  eventId: string;
  occurrenceId: string;
  participantNpcId: string | null;
  /** 물가 지수 (생략 시 1). CASH_DELTA는 첫해 물가 기준 금액이라 이 지수를 곱해 적용한다. */
  priceIndex?: number;
}

export interface TraitChange {
  kind: 'SKILL' | 'NEGATIVE_TRAIT';
  id: string;
  from: TraitLevel;
  to: TraitLevel;
  reason: TraitHistoryEntry['reason'];
}

function setLevel(levels: Record<string, OwnedTraitLevel>, id: string, to: TraitLevel): void {
  if (to === 0) delete levels[id];
  else levels[id] = to;
}

function negativeReason(from: TraitLevel, to: TraitLevel): TraitHistoryEntry['reason'] {
  if (from === 0) return 'grant';
  return to > from ? 'worsen' : 'recover';
}

/** 레벨 효과의 from이 현재 레벨과 일치하는지 (불일치 시 선택지 비적격, §23.2) */
export function levelEffectsApplicable(state: GameRunState, effects: readonly Effect[]): boolean {
  return effects.every((e) => {
    if (e.type === 'SKILL_SET_LEVEL') return (state.skills[e.id] ?? 0) === e.from;
    if (e.type === 'NEGATIVE_TRAIT_SET_LEVEL') return (state.negativeTraits[e.id] ?? 0) === e.from;
    return true;
  });
}

/**
 * 효과 목록을 draft(이미 복제된 상태)에 순서대로 적용한다.
 * 하나라도 실패(레벨 불일치 등)하면 예외를 던지고, 호출자는 draft를 버리므로 상태는 원자적으로 유지된다.
 */
export function applyEffects(
  draft: GameRunState,
  effects: readonly Effect[],
  ctx: EffectContext,
): TraitChange[] {
  const changes: TraitChange[] = [];
  const findNpc = (id: string | null): Npc | undefined =>
    id === null ? undefined : draft.npcs.find((n) => n.npcId === id);

  effects.forEach((effect, index) => {
    switch (effect.type) {
      case 'RESOURCE_DELTA':
        draft.resources[effect.key] = clampStat(draft.resources[effect.key] + effect.amount);
        break;

      case 'CASH_DELTA':
      case 'SALARY_MONTHS': {
        // 현금은 음수로 두지 않고 부족분만 부채로 전환한다 (§20.2)
        const amount =
          effect.type === 'SALARY_MONTHS'
            ? Math.floor((draft.employment.current?.annualSalary ?? 0) / 12) * effect.months
            : inflate(effect.amount, ctx.priceIndex ?? 1);
        const next = draft.cash + amount;
        if (amount < 0) draft.statistics.totalSpent += -amount;
        if (next < 0) {
          draft.debt += -next;
          draft.cash = 0;
        } else {
          draft.cash = next;
        }
        break;
      }

      case 'DEBT_DELTA':
        draft.debt = Math.max(0, draft.debt + effect.amount);
        break;

      case 'TRANSFER_OFFER':
        // 회사·연봉 추첨에 콘텐츠와 RNG가 필요해 resolveChoice가 효과 적용 뒤에 처리한다
        break;

      case 'COUNTER_OFFER':
        if (draft.employment.current) {
          const cur = draft.employment.current;
          cur.annualSalary =
            Math.floor((cur.annualSalary * (1000 + effect.raisePermille)) / 1000 / 100_000) * 100_000;
        }
        break;

      case 'EXECUTIVE_PROMOTION':
        if (draft.employment.current) draft.employment.promotedToExecutive = true;
        break;

      case 'PROMOTION_POINT_DELTA':
        // 재직 중일 때만 의미가 있다. 실직 상태면 무시.
        if (draft.employment.current) {
          draft.employment.current.promotionPoints = Math.max(
            0,
            draft.employment.current.promotionPoints + effect.amount,
          );
        }
        break;

      case 'SKILL_SET_LEVEL': {
        const current = draft.skills[effect.id] ?? 0;
        if (current !== effect.from) {
          throw new EngineError(
            'LEVEL_MISMATCH',
            `skill ${effect.id}: expected Lv.${effect.from}, has Lv.${current}`,
            {
              effect,
              current,
            },
          );
        }
        setLevel(draft.skills, effect.id, effect.to);
        const reason = effect.from === 0 ? 'grant' : 'upgrade';
        draft.skillHistory.push({
          eventId: ctx.eventId,
          occurrenceId: ctx.occurrenceId,
          traitId: effect.id,
          from: effect.from,
          to: effect.to,
          turnIndex: draft.turnIndex,
          reason,
        });
        changes.push({ kind: 'SKILL', id: effect.id, from: effect.from, to: effect.to, reason });
        break;
      }

      case 'NEGATIVE_TRAIT_SET_LEVEL': {
        const current = draft.negativeTraits[effect.id] ?? 0;
        if (current !== effect.from) {
          throw new EngineError(
            'LEVEL_MISMATCH',
            `negative trait ${effect.id}: expected Lv.${effect.from}, has Lv.${current}`,
            { effect, current },
          );
        }
        setLevel(draft.negativeTraits, effect.id, effect.to);
        const reason = negativeReason(effect.from, effect.to);
        draft.traitHistory.push({
          eventId: ctx.eventId,
          occurrenceId: ctx.occurrenceId,
          traitId: effect.id,
          from: effect.from,
          to: effect.to,
          turnIndex: draft.turnIndex,
          reason,
        });
        changes.push({ kind: 'NEGATIVE_TRAIT', id: effect.id, from: effect.from, to: effect.to, reason });
        break;
      }

      case 'NPC_RELATION_DELTA': {
        let targets: Npc[];
        if (effect.target === 'PARTICIPANT') {
          const npc = findNpc(ctx.participantNpcId);
          if (!npc) throw new EngineError('INVARIANT_VIOLATION', 'participant NPC missing', { ctx });
          targets = [npc];
        } else {
          const role = effect.target === 'BOSS' ? 'BOSS' : 'PEER';
          const ids = new Set(
            currentTeamNpcs(draft)
              .filter((t) => t.role === role)
              .map((t) => t.npc.npcId),
          );
          targets = draft.npcs.filter((n) => ids.has(n.npcId));
        }
        for (const npc of targets) {
          const from = npc[effect.stat];
          const to = clampStat(from + effect.amount);
          npc[effect.stat] = to;
          npc.relationshipHistory.push({
            turnIndex: draft.turnIndex,
            eventId: ctx.eventId,
            stat: effect.stat,
            from,
            to,
          });
        }
        break;
      }

      case 'FLAG_SET': {
        let ownerId: string | null = null;
        if (effect.scope === 'COMPANY') ownerId = draft.employment.current?.companyId ?? null;
        if (effect.scope === 'NPC') ownerId = ctx.participantNpcId;
        if ((effect.scope === 'COMPANY' || effect.scope === 'NPC') && ownerId === null) {
          throw new EngineError(
            'INVARIANT_VIOLATION',
            `flag ${effect.key} needs an owner for scope ${effect.scope}`,
          );
        }
        const record = {
          key: effect.key,
          scope: effect.scope,
          ownerId,
          value: effect.value ?? true,
          createdTurn: draft.turnIndex,
          expiresTurn: effect.expiresInMonths !== undefined ? draft.turnIndex + effect.expiresInMonths : null,
          sourceEventId: ctx.eventId,
        };
        // (key, scope, ownerId) 기준 덮어쓰기 — 중복 생성하지 않는다 (§21.1)
        const idx = draft.flags.findIndex(
          (f) => f.key === effect.key && f.scope === effect.scope && f.ownerId === ownerId,
        );
        if (idx >= 0) draft.flags[idx] = record;
        else draft.flags.push(record);
        if (effect.scope === 'NPC') {
          const npc = findNpc(ownerId);
          if (npc && !npc.memoryFlags.includes(effect.key)) npc.memoryFlags.push(effect.key);
        }
        break;
      }

      case 'FLAG_CLEAR': {
        const ownerId =
          effect.scope === 'COMPANY'
            ? (draft.employment.current?.companyId ?? null)
            : effect.scope === 'NPC'
              ? ctx.participantNpcId
              : null;
        draft.flags = draft.flags.filter(
          (f) => !(f.key === effect.key && f.scope === effect.scope && f.ownerId === ownerId),
        );
        break;
      }

      case 'SCHEDULE_EVENT':
        draft.scheduledEvents.push({
          scheduleId: `${ctx.occurrenceId}_s${index}`,
          eventId: effect.eventId,
          dueTurn: draft.turnIndex + effect.delayMonths,
          priority: effect.priority ?? 0,
          sourceOccurrenceId: ctx.occurrenceId,
          // S8 연재: 이 사건의 참여 동료를 다음 화로 이어받는다
          participantNpcId: ctx.participantNpcId,
          status: 'PENDING',
        });
        break;

      case 'EMPLOYMENT_CHANGE': {
        // §26 비자발적 실직. 직장 정보(current)는 엔딩 문구 판정을 위해 엔딩 확정 시점까지 남겨 두고,
        // 고용 상태와 실직 사유만 기록한다. 실제 팀 배정 종료는 finalizeEnding에서 처리한다.
        if (draft.employment.status !== 'EMPLOYED' || !draft.employment.current) {
          throw new EngineError('INVARIANT_VIOLATION', 'job loss effect while not employed', { ctx });
        }
        draft.employment.status = effect.status;
        draft.employment.jobLoss = {
          reason: effect.reason,
          eventId: ctx.eventId,
          turnIndex: draft.turnIndex,
        };
        break;
      }
    }
  });
  return changes;
}
