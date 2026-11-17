import {
  GENDER_LABELS,
  JOB_LABELS,
  RANK_LABELS,
  RESOURCE_ENDING_CAUSE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  RISK_LABELS,
  turnInfo,
  type CharacterCard,
  type Choice,
  type Effect,
  type Ending,
  type GameRunState,
  type Npc,
  type PublicActiveEvent,
  type PublicBackgroundTrait,
  type PublicCharacterCard,
  type PublicChoice,
  type PublicEnding,
  type PublicMonthSummary,
  type PublicNpc,
  type PublicRunView,
  type PublicTrait,
  type PublicWarning,
  type ResourceKey,
  type TraitLevels,
} from '@company-life/shared';
import { matchesConditions } from './conditions';
import { requireFrom, type ContentIndex } from './content-index';
import { applyEffects } from './effects';
import { buildEnding, debtLimit, detectJobLossCause } from './ending';
import { evaluateChoices } from './events';
import { currentTeamNpcs } from './npcs';
import { cloneForEffects } from './numbers';

const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function bg(id: string, content: ContentIndex): PublicBackgroundTrait {
  const def = requireFrom(content.backgrounds, id, 'background');
  return { id: def.id, kind: def.kind, name: def.name, description: def.description };
}

export function toPublicCard(card: CharacterCard, content: ContentIndex): PublicCharacterCard {
  return {
    cardId: card.cardId,
    displayName: card.profile.displayName,
    gender: card.profile.gender,
    genderLabel: GENDER_LABELS[card.profile.gender],
    startAge: card.startAge,
    university: bg(card.universityId, content),
    major: bg(card.majorId, content),
    family: bg(card.familyId, content),
    strength: bg(card.strengthId, content),
    weakness: bg(card.weaknessId, content),
    resources: { ...card.resources },
    cash: card.cash,
    debt: card.debt,
    permanentTraitCount: Object.keys(card.skills).length + Object.keys(card.negativeTraits).length,
  };
}

function toPublicTraits(levels: TraitLevels, content: ContentIndex): PublicTrait[] {
  return Object.entries(levels).map(([id, level]) => {
    const def = requireFrom(content.traits, id, 'trait');
    return { id, name: def.name, level, effect: def.levelEffects[String(level) as '1' | '2'] };
  });
}

function relationLabel(npc: Npc): string {
  const score = npc.favor + npc.trust - npc.rivalry;
  if (score >= 110) return '우호적';
  if (score >= 60) return '무난함';
  return '껄끄러움';
}

function toPublicNpc(npc: Npc, content: ContentIndex): PublicNpc {
  return {
    npcId: npc.npcId,
    name: npc.name,
    role: npc.role,
    roleLabel: npc.role === 'BOSS' ? '직속 상사' : '동료',
    rank: npc.rank,
    rankLabel: RANK_LABELS[npc.rank],
    personalities: npc.personalityTags.map((id) => ({ id, name: content.personalities.get(id)?.name ?? id })),
    relationLabel: relationLabel(npc),
  };
}

/** §22.1 확정 비용만 표시 (확률은 비공개) */
function costLabels(effects: readonly Effect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    if (e.type === 'RESOURCE_DELTA' && e.amount < 0) out.push(`${RESOURCE_LABELS[e.key]} ${e.amount}`);
    if (e.type === 'CASH_DELTA' && e.amount < 0) out.push(`현금 -${krw(-e.amount)}`);
  }
  return out;
}

function lockedHint(
  choiceHint: string | undefined,
  enabledIf: Choice['enabledIf'],
  content: ContentIndex,
): string {
  if (choiceHint) return choiceHint;
  // 잠긴 특수 선택지는 요구 능력의 이름/레벨만 보여준다 (스포일러 금지, §22.1)
  const parts = Object.entries(enabledIf?.skillLevels ?? {}).map(
    ([id, range]) => `${content.traits.get(id)?.name ?? id} Lv.${range.min ?? 1} 필요`,
  );
  return parts.length > 0 ? parts.join(', ') : '조건 미충족';
}

/**
 * §26.3 확정 비용(guaranteedEffects + 일치하는 ALWAYS 조건부 효과)만으로 실직 엔딩에 닿는지 미리 계산한다.
 * 확률이 걸린 결과는 여기서 다루지 않는다 (위험 등급만 표시, §22.1).
 */
function fatalWarning(
  state: GameRunState,
  choice: Choice,
  participant: Npc | null,
  occurrenceId: string,
  eventId: string,
  content: ContentIndex,
): string | null {
  const always = (choice.conditionalEffects ?? [])
    .filter((ce) => ce.on === 'ALWAYS' && matchesConditions(state, ce.when, { participant }, content))
    .flatMap((ce) => ce.effects);
  const effects = [...(choice.guaranteedEffects ?? []), ...always];
  if (effects.length === 0) return null;
  const draft = cloneForEffects(state);
  try {
    applyEffects(draft, effects, { eventId, occurrenceId, participantNpcId: participant?.npcId ?? null });
  } catch {
    return null;
  }
  const found = detectJobLossCause(draft, content);
  return found ? `⚠ 선택 시 ${buildEnding(draft, found.cause, found.sourceEventId, content).title}` : null;
}

/** §26.3 경고 임계치 이하 자원·부채 경고 */
export function computeWarnings(state: GameRunState, content: ContentIndex): PublicWarning[] {
  if (!state.employment.current || state.phase === 'GAME_OVER') return [];
  const { warningThreshold, debtWarningPermille } = content.pack.rules.gameOver;
  const codes: Record<ResourceKey, PublicWarning['code']> = {
    health: 'HEALTH_CRITICAL',
    mental: 'MENTAL_CRITICAL',
    focus: 'FOCUS_CRITICAL',
    reputation: 'REPUTATION_CRITICAL',
  };
  const out: PublicWarning[] = [];
  for (const key of RESOURCE_KEYS) {
    if (state.resources[key] <= warningThreshold) {
      const title = content.pack.endings.causes[RESOURCE_ENDING_CAUSE[key]].title;
      out.push({
        code: codes[key],
        message: `${RESOURCE_LABELS[key]} ${state.resources[key]} — 0이 되면 ${title}입니다.`,
      });
    }
  }
  const limit = debtLimit(state, content);
  if (limit !== null && state.debt * 1000 >= limit * debtWarningPermille) {
    out.push({
      code: 'DEBT_CRITICAL',
      message: `부채 ${krw(state.debt)} — ${krw(limit)}에 닿으면 ${content.pack.endings.causes.DEBT_SPIRAL.title}입니다.`,
    });
  }
  return out;
}

function toPublicEnding(ending: Ending | null): PublicEnding | null {
  return ending
    ? {
        type: ending.type,
        category: ending.category,
        title: ending.title,
        text: ending.text,
        age: ending.age,
      }
    : null;
}

function toMonthSummary(state: GameRunState, content: ContentIndex): PublicMonthSummary | null {
  const m = state.currentMonth;
  if (!m || state.phase !== 'MONTH_SUMMARY') return null;
  const resourceDelta = { ...state.resources };
  for (const key of RESOURCE_KEYS) resourceDelta[key] = state.resources[key] - m.start.resources[key];
  const ev = m.eventResult;
  const event = ev ? content.events.get(ev.eventId) : undefined;
  return {
    turnIndex: m.turnIndex,
    netSalary: m.settlement.netSalary,
    livingCost: m.settlement.livingCost,
    interest: m.settlement.interest,
    annualReview: m.annualReview
      ? { grade: m.annualReview.grade, reputationDelta: m.annualReview.reputationDelta }
      : null,
    salaryAdjustment: m.salaryAdjustment,
    resourceDelta,
    cashDelta: state.cash - m.start.cash,
    debtDelta: state.debt - m.start.debt,
    event:
      ev && event
        ? {
            title: event.title,
            choiceLabel: event.choices.find((c) => c.id === ev.choiceId)?.label ?? ev.choiceId,
            success: ev.success,
            resultText: ev.resultText,
            traitChanges: ev.traitChanges.map((t) => {
              const name = content.traits.get(t.id)?.name ?? t.id;
              if (t.to === 0) return `${name} 극복`;
              return t.from === 0 ? `${name} Lv.${t.to} 획득` : `${name} Lv.${t.from} → Lv.${t.to}`;
            }),
          }
        : null,
  };
}

export function toPublicActiveEvent(state: GameRunState, content: ContentIndex): PublicActiveEvent | null {
  const active = state.activeEvent;
  if (!active) return null;
  const event = requireFrom(content.events, active.eventId, 'event');
  const participant = active.participantNpcId
    ? (state.npcs.find((n) => n.npcId === active.participantNpcId) ?? null)
    : null;
  const choices: PublicChoice[] = evaluateChoices(state, event, participant, content)
    .filter((c) => c.visible)
    .map((c) => {
      const appliedTraits = (c.chance?.breakdown ?? [])
        .filter((b) => (b.source === 'SKILL' || b.source === 'NEGATIVE_TRAIT') && b.bonus !== 0 && b.id)
        .map((b) => `${content.traits.get(b.id as string)?.name ?? b.id} Lv.${b.level}`);
      const view: PublicChoice = {
        id: c.choice.id,
        label: c.choice.label,
        enabled: c.enabled,
        risk: c.risk,
        riskLabel: c.risk ? RISK_LABELS[c.risk] : null,
        appliedTraits,
        costs: costLabels(c.choice.guaranteedEffects ?? []),
        fatalWarning: fatalWarning(state, c.choice, participant, active.occurrenceId, event.id, content),
      };
      if (c.choice.description) view.description = c.choice.description;
      if (!c.enabled) view.lockedHint = lockedHint(c.choice.requirementHint, c.choice.enabledIf, content);
      return view;
    });
  return {
    occurrenceId: active.occurrenceId,
    eventId: event.id,
    title: event.title,
    description: event.description,
    participantName: participant?.name ?? null,
    choices,
  };
}

/** 정본 상태 → 공개 뷰. 시드·RNG 상태·NPC 수치·정확한 사건 확률은 포함하지 않는다. */
export function toPublicView(state: GameRunState, content: ContentIndex): PublicRunView {
  const job = state.employment.current;
  const company = job ? content.companies.get(job.companyId) : undefined;
  const last = state.jobSearch.lastResult;
  return {
    runId: state.runId,
    revision: state.stateRevision,
    phase: state.phase,
    contentVersion: state.contentVersion,
    turn: turnInfo(state.turnIndex, content.pack.rules.startAge),
    profile: {
      displayName: state.profile.displayName,
      gender: state.profile.gender,
      genderLabel: GENDER_LABELS[state.profile.gender],
    },
    characterCards: state.characterCards.map((c) => toPublicCard(c, content)),
    selectedCardId: state.selectedCharacter?.cardId ?? null,
    jobOffers: state.jobOffers.map((o) => {
      const c = requireFrom(content.companies, o.companyId, 'company');
      return {
        offerId: o.offerId,
        companyName: c.name,
        companyDescription: c.description,
        grade: o.grade,
        industry: c.industry,
        jobId: o.jobId,
        jobLabel: JOB_LABELS[o.jobId],
        hireChancePercent: Math.round(o.hireChance * 100),
        annualSalary: o.annualSalary,
        workload: c.workload,
        stability: c.stability,
        guaranteed: o.guaranteed,
        reasons: [...o.reasons],
      };
    }),
    jobSearch: {
      consecutiveRejections: state.jobSearch.consecutiveRejections,
      lastResult: last
        ? {
            companyName: content.companies.get(last.companyId)?.name ?? last.companyId,
            hired: last.hired,
            autoAssignedCompanyName: last.autoAssignedCompanyId
              ? (content.companies.get(last.autoAssignedCompanyId)?.name ?? last.autoAssignedCompanyId)
              : null,
          }
        : null,
    },
    employment: {
      status: state.employment.status,
      companyName: company?.name ?? null,
      grade: company?.grade ?? null,
      jobLabel: job ? JOB_LABELS[job.jobId] : null,
      rank: job?.rank ?? null,
      rankLabel: job ? RANK_LABELS[job.rank] : null,
      annualSalary: job?.annualSalary ?? null,
      lastReviewGrade: state.annualReviews.at(-1)?.grade ?? null,
    },
    resources: { ...state.resources },
    cash: state.cash,
    debt: state.debt,
    netWorth: state.cash - state.debt,
    skills: toPublicTraits(state.skills, content),
    negativeTraits: toPublicTraits(state.negativeTraits, content),
    npcs: currentTeamNpcs(state).map((t) => toPublicNpc(t.npc, content)),
    activeEvent: toPublicActiveEvent(state, content),
    warnings: computeWarnings(state, content),
    monthSummary: toMonthSummary(state, content),
    pendingEnding: toPublicEnding(state.pendingEnding),
    ending: toPublicEnding(state.ending),
    playtestModified: state.playtestModified,
  };
}
