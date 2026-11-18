import {
  DIFFICULTY_LABELS,
  GENDER_LABELS,
  JOB_LABELS,
  JOB_LOSS_REASONS,
  PLAYER_RANKS,
  RANK_LABELS,
  type LifeGoalDefinition,
  type PublicLifeGoal,
  type PublicLifeGoalProgress,
  type PublicPromotionStatus,
  RESOURCE_ENDING_CAUSE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  RISK_LABELS,
  turnInfo,
  eventSlot,
  type DialogueLine,
  type EventDefinition,
  type EventResult,
  type PublicChatLine,
  type PublicReview,
  type PublicStory,
  type ReviewDetail,
  type CharacterCard,
  type Choice,
  type Effect,
  type Ending,
  type GameRunState,
  type Npc,
  type PublicActiveEvent,
  type PublicBackgroundTrait,
  type PublicCalendar,
  type PublicHistoryEntry,
  type PublicCharacterCard,
  type PublicChoice,
  type PublicEffect,
  type PublicEnding,
  type PublicTitle,
  type PublicMonthSummary,
  type PublicNpc,
  type PublicRunView,
  type PublicTrait,
  type PublicWarning,
  type ResourceKey,
  type TraitLevels,
} from '@company-life/shared';
import { toPublicActionResult, toPublicMonthlyActions } from './action-view';
import { backgroundEffects, recommendedJob } from './background-effects';
import { inflate, priceIndex, difficultyKnobs, scaleLoss } from './economy';
import { goalDef, lifeGoalProgress } from './goals';
import { promotionStatus } from './promotion';
import { matchesConditions } from './conditions';
import { requireFrom, type ContentIndex } from './content-index';
import { applyEffects } from './effects';
import { buildChronicle } from './chronicle';
import { buildEnding, debtLimit, detectJobLossCause } from './ending';
import { evaluateChoices } from './events';
import { currentTeamNpcs } from './npcs';
import { cloneForEffects } from './numbers';

const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function bg(id: string, content: ContentIndex): PublicBackgroundTrait {
  const def = requireFrom(content.backgrounds, id, 'background');
  return {
    id: def.id,
    kind: def.kind,
    name: def.name,
    description: def.description,
    rare: def.rarity === 'rare',
    effects: backgroundEffects(def, content),
  };
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
    strength: bg(card.strengthId, content),
    weakness: bg(card.weaknessId, content),
    resources: { ...card.resources },
    cash: card.cash,
    debt: card.debt,
    permanentTraitCount: Object.keys(card.skills).length + Object.keys(card.negativeTraits).length,
    recommendedJob: recommendedJob(card, content),
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
function costLabels(effects: readonly Effect[], index: number, lossPermille: number): string[] {
  const out: string[] = [];
  for (const e of effects) {
    if (e.type === 'RESOURCE_DELTA' && e.amount < 0)
      out.push(`${RESOURCE_LABELS[e.key]} ${scaleLoss(e.amount, lossPermille)}`);
    if (e.type === 'CASH_DELTA' && e.amount < 0) out.push(`현금 -${krw(-inflate(e.amount, index))}`);
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
function guaranteedEnding(
  state: GameRunState,
  choice: Choice,
  participant: Npc | null,
  occurrenceId: string,
  eventId: string,
  content: ContentIndex,
): Ending | null {
  const always = (choice.conditionalEffects ?? [])
    .filter((ce) => ce.on === 'ALWAYS' && matchesConditions(state, ce.when, { participant }, content))
    .flatMap((ce) => ce.effects);
  const effects = [...(choice.guaranteedEffects ?? []), ...always];
  if (effects.length === 0) return null;
  const draft = cloneForEffects(state);
  try {
    applyEffects(draft, effects, {
      eventId,
      occurrenceId,
      participantNpcId: participant?.npcId ?? null,
      priceIndex: priceIndex(state, content),
      lossPermille: difficultyKnobs(state, content).lossPermille,
    });
  } catch {
    return null;
  }
  const found = detectJobLossCause(draft, content);
  return found ? buildEnding(draft, found.cause, found.sourceEventId, content) : null;
}

/**
 * 확정 비용만으로 엔딩에 닿는 선택지 표시.
 * 실패 엔딩이면 빨간 경고(두 번 눌러 확정), 정상 엔딩(50세 이후 조기 은퇴 등)이면 중립 안내만.
 */
function endingNotices(ending: Ending | null): { fatalWarning: string | null; endingNotice: string | null } {
  if (!ending) return { fatalWarning: null, endingNotice: null };
  // 중립 안내는 '사건이 제안한 퇴직'(희망퇴직 수락 등)이 정상 엔딩이 되는 경우만.
  // 50세 이후라도 과로·번아웃·부채 등 무너져서 끝나는 경우는 빨간 경고를 유지한다.
  const offeredExit =
    ending.category === 'NORMAL' && (JOB_LOSS_REASONS as readonly string[]).includes(ending.cause);
  return offeredExit
    ? {
        fatalWarning: null,
        endingNotice: `선택 시 ${ending.title.split(' — ')[0]} · 회사 생활이 여기서 끝납니다`,
      }
    : { fatalWarning: `⚠ 선택 시 ${ending.title}`, endingNotice: null };
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

function toPublicTitle(id: string, content: ContentIndex): PublicTitle | null {
  const t = content.pack.titles.find((x) => x.id === id);
  return t ? { id: t.id, name: t.name, emoji: t.emoji, rarity: t.rarity, reason: t.reason } : null;
}

function toPublicEnding(
  ending: Ending | null,
  state: GameRunState,
  content: ContentIndex,
  final: boolean,
): PublicEnding | null {
  if (!ending) return null;
  const titles = (ending.titles ?? []).map((id) => toPublicTitle(id, content)).filter((t) => t !== null);
  const [main, ...subs] = titles;
  const best = state.statistics.highestRank;
  const def = ending.goal ? content.pack.lifeGoals.find((g) => g.id === ending.goal!.goalId) : undefined;
  return {
    type: ending.type,
    category: ending.category,
    title: ending.title,
    text: ending.text,
    age: ending.age,
    highestRankLabel: best ? RANK_LABELS[best] : null,
    retirement: ending.retirementTier
      ? { tier: ending.retirementTier, ...content.pack.endings.retirementTiers[ending.retirementTier] }
      : null,
    goal:
      ending.goal && def
        ? { title: def.title, emoji: def.emoji, achieved: ending.goal.achieved, text: ending.goal.text }
        : null,
    // 별명·연대기는 확정된 엔딩에서만 공개 (예고 단계에서 미리 보이지 않게)
    titles: final && main ? { main, subs } : null,
    chronicle: final ? buildChronicle(state, content) : null,
  };
}

/** 금액 짧게: 4,200만 · 3억 · 3억 2,000만 · −500만 */
export function krwShort(n: number): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const eok = Math.floor(abs / 100_000_000);
  const man = Math.floor((abs % 100_000_000) / 10_000);
  if (eok > 0) return `${sign}${eok}억${man > 0 ? ` ${man.toLocaleString('ko-KR')}만` : ''}`;
  if (man > 0) return `${sign}${man.toLocaleString('ko-KR')}만`;
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}

function toPublicGoal(def: LifeGoalDefinition, state: GameRunState): PublicLifeGoal {
  return {
    id: def.id,
    title: def.title,
    emoji: def.emoji,
    description: def.description,
    fitting: def.affinity?.some((id) => state.backgroundTraits.includes(id)) ?? false,
  };
}

function toPublicGoalProgress(state: GameRunState, content: ContentIndex): PublicLifeGoalProgress | null {
  if (!state.lifeGoal) return null;
  const def = goalDef(content, state.lifeGoal.goalId);
  const p = lifeGoalProgress(state, content)!;
  let progressLabel: string;
  switch (def.kind) {
    case 'NET_WORTH':
      progressLabel = `순자산 ${krwShort(p.current)} / ${krwShort(p.target)}`;
      break;
    case 'DEBT_FREE':
      progressLabel = `빚 ${krwShort(state.debt)} · 현금 ${krwShort(state.cash)} / ${krwShort(p.target)}`;
      break;
    case 'RANK':
      progressLabel = `현재 ${RANK_LABELS[PLAYER_RANKS[p.current]!]} / 목표 ${RANK_LABELS[def.rank!]}`;
      break;
    case 'FULL_TENURE':
      progressLabel = `${p.current}세 / ${p.target}세 정년`;
      break;
    case 'WELLBEING':
      progressLabel = `지금 ${p.current} · 커리어 최저 ${state.statistics.lowestWellbeing} (은퇴 시 ${p.target}↑, 최저 ${def.floor ?? 0}↑)`;
      break;
    case 'ACE':
      progressLabel = `연말 평가 S ${p.current}회 / ${p.target}회`;
      break;
  }
  return { ...toPublicGoal(def, state), percent: p.percent, progressLabel };
}

function toPublicPromotionStatus(state: GameRunState, content: ContentIndex): PublicPromotionStatus | null {
  const s = promotionStatus(state, content);
  if (!s) return null;
  return {
    nextRankLabel: s.to ? RANK_LABELS[s.to] : null,
    yearsInRank: s.yearsInRank,
    minYears: s.minYears,
    points: s.points,
    requiredPoints: s.requiredPoints,
    blocked: s.blocked,
    eligible: s.eligible,
  };
}

function toMonthSummary(state: GameRunState, content: ContentIndex): PublicMonthSummary | null {
  const m = state.currentMonth;
  if (!m || state.phase !== 'MONTH_SUMMARY') return null;
  const resourceDelta = { ...state.resources };
  for (const key of RESOURCE_KEYS) resourceDelta[key] = state.resources[key] - m.start.resources[key];
  const lb = m.settlement.livingBreakdown;
  return {
    turnIndex: m.turnIndex,
    grossSalary: m.settlement.grossSalary,
    tax: m.settlement.tax,
    netSalary: m.settlement.netSalary,
    livingCost: m.settlement.livingCost,
    livingBreakdown: [
      { label: '월세·관리비', amount: lb.housing },
      { label: '식비', amount: lb.food },
      { label: '교통·통신', amount: lb.transport },
      { label: '생필품·기타', amount: lb.misc },
    ],
    interest: m.settlement.interest,
    debtRepayment: m.settlement.debtRepayment,
    annualReview: m.annualReview ? toPublicReview(m.annualReview) : null,
    salaryAdjustment: m.salaryAdjustment,
    promotion: m.promotion
      ? {
          success: m.promotion.success,
          fromLabel: RANK_LABELS[m.promotion.from],
          toLabel: RANK_LABELS[m.promotion.to],
          salaryFrom: m.promotion.salaryFrom,
          salaryTo: m.promotion.salaryTo,
          newBossName: m.promotion.newBossName,
          misses: m.promotion.misses,
        }
      : null,
    goalMilestone: m.goalMilestone,
    news: m.news.map((n) => ({ kind: n.kind, text: n.text })),
    resourceDelta,
    cashDelta: state.cash - m.start.cash,
    debtDelta: state.debt - m.start.debt,
    events: m.eventResults.flatMap((ev) => {
      const event = content.events.get(ev.eventId);
      return event ? [toStory(state, ev, event, content)] : [];
    }),
    action: m.action ? toPublicActionResult(m.action, content) : null,
  };
}

const REVIEW_ITEM_LABELS: Record<string, string> = {
  performance: '업무 성과',
  boss: '상사 평가',
  peers: '동료 협업',
  reputation: '사내 평판',
  condition: '근태·컨디션',
};

function toPublicReview(r: ReviewDetail): PublicReview {
  return {
    grade: r.grade,
    score: r.score,
    reputationDelta: r.reputationDelta,
    items: r.items.map((i) => ({
      label: REVIEW_ITEM_LABELS[i.key] ?? i.key,
      score: i.score,
      grade: i.grade,
      note: i.note,
    })),
    traitAdjustment: r.traitAdjustment,
    bonus: r.bonus,
    bossName: r.bossName,
    comment: r.comment,
    warning: r.warning,
  };
}

/** 대사의 화자 역할을 실제 인물로 바꾸고 {me} {boss} {peer} {company}를 채운다 */
function chatLines(
  lines: readonly DialogueLine[] | undefined,
  state: GameRunState,
  participant: Npc | null,
  content: ContentIndex,
): PublicChatLine[] {
  const team = currentTeamNpcs(state);
  const boss = team.find((t) => t.role === 'BOSS')?.npc ?? null;
  const peer =
    (participant?.role === 'PEER' ? participant : null) ?? team.find((t) => t.role === 'PEER')?.npc ?? null;
  const company = state.employment.current
    ? (content.companies.get(state.employment.current.companyId)?.name ?? '회사')
    : '회사';
  const fill = (text: string) =>
    text
      .replaceAll('{me}', state.profile.displayName)
      .replaceAll('{boss}', boss?.name ?? '팀장')
      .replaceAll('{peer}', peer?.name ?? '동료')
      .replaceAll('{company}', company);
  return (lines ?? []).map((l) => {
    const text = fill(l.text);
    switch (l.speaker) {
      case 'SELF':
        return { side: 'self', name: state.profile.displayName, initial: null, text };
      case 'SYSTEM':
        return { side: 'system', name: null, initial: null, text };
      case 'NARRATION':
        return { side: 'narration', name: null, initial: null, text };
      case 'NAMED':
        return { side: 'other', name: l.name ?? '?', initial: (l.name ?? '?').slice(0, 1), text };
      default: {
        const npc = l.speaker === 'BOSS' ? boss : l.speaker === 'PEER' ? peer : participant;
        const name = npc?.name ?? (l.speaker === 'BOSS' ? '팀장' : '동료');
        const rank = npc ? ` ${RANK_LABELS[npc.rank]}` : '';
        return { side: 'other', name: `${name}${rank}`, initial: name.slice(0, 1), text };
      }
    }
  });
}

function channelName(event: EventDefinition, state: GameRunState, participant: Npc | null): string {
  if (event.channel) return event.channel;
  if (eventSlot(event) === 'life') return '일상';
  if (participant) return `${participant.name} ${RANK_LABELS[participant.rank]} · 1:1`;
  const job = state.employment.current;
  return job ? `${JOB_LABELS[job.jobId]}팀 단톡방` : '사내 메신저';
}

const STAT_LABELS: Record<string, string> = { favor: '호감', trust: '신뢰', rivalry: '경쟁심' };
const manwonSigned = (n: number) =>
  `${n > 0 ? '+' : '−'}${Math.abs(n) >= 10_000 ? `${Math.round(Math.abs(n) / 10_000).toLocaleString('ko-KR')}만원` : `${Math.abs(n).toLocaleString('ko-KR')}원`}`;

/** 이달의 이야기: 상황 → 선택 → 판정 요인 → 결과 → 영향. 정확한 확률·NPC 수치는 내보내지 않는다. */
function toStory(
  state: GameRunState,
  ev: EventResult,
  event: EventDefinition,
  content: ContentIndex,
): PublicStory {
  const participant = ev.participantNpcId
    ? (state.npcs.find((n) => n.npcId === ev.participantNpcId) ?? null)
    : null;
  const choice = event.choices.find((c) => c.id === ev.choiceId);
  const aftermathLines =
    ev.success === true
      ? choice?.onSuccess?.dialogue
      : ev.success === false
        ? choice?.onFailure?.dialogue
        : choice?.resultDialogue;
  const verdictLabel = ev.success === true ? '성공' : ev.success === false ? '실패' : '확정';
  const fallback =
    ev.success === true
      ? '일이 잘 풀렸다.'
      : ev.success === false
        ? '뜻대로 되지 않았다.'
        : '선택한 대로 일이 흘러갔다.';

  const factors = ev.factors.map((f) => {
    let name = f.id;
    if (f.source === 'SKILL' || f.source === 'NEGATIVE_TRAIT')
      name = `${content.traits.get(f.id)?.name ?? f.id} Lv.${f.level}`;
    else if (f.source === 'BACKGROUND') name = content.backgrounds.get(f.id)?.name ?? f.id;
    else if (f.source === 'NPC') name = participant ? `${participant.name}의 성향·관계` : '상대의 성향';
    else if (f.source === 'RESOURCE') name = `현재 ${RESOURCE_LABELS[f.id as ResourceKey] ?? f.id}`;
    return { label: `${name} — ${f.positive ? '유리하게 작용' : '불리하게 작용'}`, positive: f.positive };
  });

  const effects: PublicEffect[] = [];
  for (const key of RESOURCE_KEYS) {
    const d = ev.resourceDelta[key] ?? 0;
    if (d !== 0)
      effects.push({
        text: `${RESOURCE_LABELS[key]} ${d > 0 ? '+' : '−'}${Math.abs(d)}`,
        tone: d > 0 ? 'good' : 'bad',
      });
  }
  if (ev.cashDelta !== 0)
    effects.push({ text: `현금 ${manwonSigned(ev.cashDelta)}`, tone: ev.cashDelta > 0 ? 'good' : 'bad' });
  if (ev.debtDelta !== 0)
    effects.push({ text: `빚 ${manwonSigned(ev.debtDelta)}`, tone: ev.debtDelta > 0 ? 'bad' : 'good' });

  const relationChanges = ev.npcChanges.map((c) => {
    const npc = state.npcs.find((n) => n.npcId === c.npcId);
    // 경쟁심이 오르는 것은 나쁜 변화
    return `${npc?.name ?? '동료'} · ${STAT_LABELS[c.stat] ?? c.stat} ${c.delta > 0 ? '▲' : '▼'}`;
  });

  return {
    occurrenceId: ev.occurrenceId,
    slot: eventSlot(event),
    title: event.title,
    categoryLabel: CATEGORY_LABELS[event.category] ?? event.category,
    channelName: channelName(event, state, participant),
    situation: event.description,
    participantName: participant?.name ?? null,
    choiceLabel: choice?.label ?? ev.choiceId,
    reply: choice?.reply ?? choice?.label ?? ev.choiceId,
    aftermath: chatLines(aftermathLines, state, participant, content),
    success: ev.success,
    verdictLabel,
    // 반응 대화가 있으면 판에 박힌 기본 문장은 생략 (대화가 결과를 말해준다)
    resultText: ev.resultText ?? ((aftermathLines?.length ?? 0) > 0 ? '' : fallback),
    factors,
    effects,
    relationChanges,
    traitChanges: ev.traitChanges.map((t) => {
      const name = content.traits.get(t.id)?.name ?? t.id;
      if (t.to === 0) return `${name} 극복`;
      return t.from === 0 ? `${name} Lv.${t.to} 획득` : `${name} Lv.${t.from} → Lv.${t.to}`;
    }),
    followUpHint: ev.followUpScheduled ? '이 선택은 몇 달 뒤 다시 돌아올 것 같다.' : null,
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
        reply: c.choice.reply ?? c.choice.label,
        enabled: c.enabled,
        risk: c.risk,
        riskLabel: c.risk ? RISK_LABELS[c.risk] : null,
        appliedTraits,
        costs: costLabels(
          c.choice.guaranteedEffects ?? [],
          priceIndex(state, content),
          difficultyKnobs(state, content).lossPermille,
        ),
        ...endingNotices(
          guaranteedEnding(state, c.choice, participant, active.occurrenceId, event.id, content),
        ),
      };
      if (c.choice.description) view.description = c.choice.description;
      if (!c.enabled) view.lockedHint = lockedHint(c.choice.requirementHint, c.choice.enabledIf, content);
      return view;
    });
  const done = state.currentMonth?.eventResults.length ?? 0;
  return {
    occurrenceId: active.occurrenceId,
    eventId: event.id,
    slot: eventSlot(event),
    position: { index: done + 1, total: done + 1 + state.pendingEvents.length },
    title: event.title,
    description: event.description,
    category: event.category,
    categoryLabel: CATEGORY_LABELS[event.category] ?? event.category,
    channelName: channelName(event, state, participant),
    dialogue: chatLines(event.dialogue, state, participant, content),
    series: event.series
      ? { title: event.series.title, episode: event.series.episode, total: event.series.total }
      : null,
    participantName: participant?.name ?? null,
    participant: participant ? (({ npcId: _id, ...rest }) => rest)(toPublicNpc(participant, content)) : null,
    choices,
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  daily: '일상',
  work: '업무',
  company: '사내 공지',
  social: '사내 관계',
  economy: '경제',
  life: '생활',
  rare: '특별한 일',
};

/** 메인 1년 달력: 지난달·이번 달·12월 평가·예약 사건이 있는 달(내용은 숨김) */
function toCalendar(state: GameRunState, content: ContentIndex): PublicCalendar {
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const yearStart = info.yearIndex * 12;
  const scheduledMonths = new Set(
    state.scheduledEvents
      .filter((s) => s.status === 'PENDING' && s.dueTurn >= yearStart && s.dueTurn < yearStart + 12)
      .map((s) => (s.dueTurn % 12) + 1),
  );
  return {
    age: info.age,
    months: Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        status: month < info.monthOfYear ? 'PAST' : month === info.monthOfYear ? 'CURRENT' : 'FUTURE',
        review: month === 12,
        scheduled: scheduledMonths.has(month),
      };
    }),
  };
}

/** 최근 기록 (최신순). 내부 판정 데이터(roll, chance)는 내보내지 않는다. */
function toHistory(state: GameRunState, content: ContentIndex): PublicHistoryEntry[] {
  return state.eventHistory
    .slice(-40)
    .reverse()
    .map((h) => {
      const info = turnInfo(h.turnIndex, content.pack.rules.startAge);
      return { age: info.age, month: info.monthOfYear, kind: h.kind, summary: h.summary };
    });
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
    difficulty: state.difficulty,
    difficultyLabel: DIFFICULTY_LABELS[state.difficulty],
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
      startedAge: job ? turnInfo(job.startedTurn, content.pack.rules.startAge).age : null,
      startedMonth: job ? turnInfo(job.startedTurn, content.pack.rules.startAge).monthOfYear : null,
      promotion: toPublicPromotionStatus(state, content),
      probationMonthsLeft:
        job?.probationUntilTurn != null && job.probationUntilTurn > state.turnIndex
          ? job.probationUntilTurn - state.turnIndex
          : null,
      transfers: state.statistics.transfers,
    },
    transferOffer: (() => {
      const o = state.transferOffer;
      if (!o || !job || state.phase !== 'MONTH_SUMMARY' || o.turnIndex !== state.turnIndex) return null;
      const c = requireFrom(content.companies, o.companyId, 'company');
      return {
        companyName: c.name,
        companyDescription: c.description,
        grade: c.grade,
        industry: c.industry,
        jobLabel: JOB_LABELS[o.jobId],
        annualSalary: o.annualSalary,
        currentSalary: job.annualSalary,
        raisePercent: Math.round(((o.annualSalary - job.annualSalary) / job.annualSalary) * 100),
        workload: c.workload,
        stability: c.stability,
      };
    })(),
    lifeGoalOffers:
      state.phase === 'GOAL_SELECTION'
        ? state.lifeGoalOffers.map((id) => toPublicGoal(goalDef(content, id), state))
        : [],
    lifeGoal: toPublicGoalProgress(state, content),
    resources: { ...state.resources },
    cash: state.cash,
    debt: state.debt,
    netWorth: state.cash - state.debt,
    skills: toPublicTraits(state.skills, content),
    negativeTraits: toPublicTraits(state.negativeTraits, content),
    npcs: currentTeamNpcs(state).map((t) => toPublicNpc(t.npc, content)),
    formerColleagues: (() => {
      const here = new Set(currentTeamNpcs(state).map((t) => t.npc.npcId));
      return state.npcs
        .filter((n) => !here.has(n.npcId))
        .slice(-10)
        .reverse()
        .map((n) => ({
          name: n.name,
          rankLabel: RANK_LABELS[n.rank],
          relationLabel: relationLabel(n),
          note: !n.active
            ? '회사를 떠남'
            : n.companyId !== state.employment.current?.companyId
              ? (content.companies.get(n.companyId)?.name ?? '전 직장') + ' 시절'
              : '다른 자리로',
        }));
    })(),
    activeEvent: toPublicActiveEvent(state, content),
    warnings: computeWarnings(state, content),
    monthSummary: toMonthSummary(state, content),
    pendingEnding: toPublicEnding(state.pendingEnding, state, content, false),
    ending: toPublicEnding(state.ending, state, content, true),
    playtestModified: state.playtestModified,
    calendar: toCalendar(state, content),
    history: toHistory(state, content),
    lastStory: (() => {
      const ev = state.currentMonth?.eventResults.at(-1);
      const event = ev ? content.events.get(ev.eventId) : undefined;
      return ev && event ? toStory(state, ev, event, content) : null;
    })(),
    monthlyActions: toPublicMonthlyActions(state, content),
  };
}
