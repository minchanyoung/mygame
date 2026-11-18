import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  turnInfo,
  type GameRunState,
  type MonthActionResult,
  type MonthlyActionDefinition,
  type PublicActionOption,
  type PublicActionResult,
  type PublicMonthlyActions,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { difficultyKnobs, scaleLoss } from './economy';
import {
  actionCost,
  actionDef,
  actionLockReason,
  activeHabits,
  defaultActionId,
  streakOf,
  totalOf,
} from './monthly-actions';

/** S11 월간 행동의 화면용 뷰. 효과는 확정 수치라 그대로 보여 준다 (난이도 배율 반영). */

const won = (n: number) => {
  const abs = Math.abs(n);
  const body = abs >= 10_000 ? `${Math.round(abs / 10_000).toLocaleString('ko-KR')}만원` : `${abs}원`;
  return `${n > 0 ? '+' : '−'}${body}`;
};
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

function effectLines(def: MonthlyActionDefinition, state: GameRunState, content: ContentIndex): string[] {
  const loss = difficultyKnobs(state, content).lossPermille;
  const lines = RESOURCE_KEYS.flatMap((key) => {
    const amount = def.resources[key];
    return amount ? [`${RESOURCE_LABELS[key]} ${signed(scaleLoss(amount, loss))}`] : [];
  });
  if (def.performance > 0) lines.push(`올해 평가 성과 +${def.performance}`);
  if (def.favor) lines.push(`동료 한 명 호감 +${def.favor}`);
  if (def.income) lines.push(`부수입 월급의 ${def.income.minPermille / 10}~${def.income.maxPermille / 10}%`);
  return lines;
}

const traitName = (content: ContentIndex, id: string) => content.traits.get(id)?.name ?? id;

/** 다음 누적 보상·연속 경고 한 줄 */
function progressOf(
  def: MonthlyActionDefinition,
  state: GameRunState,
  content: ContentIndex,
): { text: string | null; warn: boolean } {
  const last = state.actionLog.at(-1);
  const continuing = last?.actionId === def.id && last.turnIndex === state.turnIndex - 1;
  const nextStreak = continuing ? streakOf(state.actionLog, def.id, last.turnIndex) + 1 : 1;
  const total = totalOf(state.actionLog, def.id);

  // 연속 경고 (번아웃·피로·들킴)가 누적 보상 안내보다 먼저
  for (const m of def.milestones ?? []) {
    if (m.by !== 'streak' || m.kind !== 'NEGATIVE_TRAIT') continue;
    const left = m.at - nextStreak;
    if (nextStreak >= 2 && left >= 0 && left <= 3)
      return {
        text:
          left === 0
            ? `이번 달이 연속 ${nextStreak}개월째 — '${traitName(content, m.traitId)}'가 생긴다`
            : `연속 ${nextStreak}개월째 — ${left}개월 더 하면 '${traitName(content, m.traitId)}'`,
        warn: true,
      };
  }
  if (def.fatigue && nextStreak >= def.fatigue.from)
    return { text: `연속 ${nextStreak}개월째 — 피로 누적 (추가 소모)`, warn: true };
  if (def.risk && nextStreak >= 2)
    return { text: `연속 ${nextStreak}개월째 — 오래 할수록 들킬 위험↑`, warn: true };

  const next = (def.milestones ?? [])
    .filter((m) => m.by === 'total' && m.at > total)
    .find((m) => {
      const levels = m.kind === 'SKILL' ? state.skills : state.negativeTraits;
      const level = levels[m.traitId] ?? 0;
      return m.viaEventId ? level === 0 : level < (content.traits.get(m.traitId)?.maxLevel ?? 0);
    });
  if (next)
    return {
      text: next.viaEventId
        ? `${next.at - total}개월 더 하면 '${traitName(content, next.traitId)}'을 얻을 기회`
        : `'${traitName(content, next.traitId)}'까지 ${next.at - total}개월`,
      warn: false,
    };
  if (def.habit) {
    const recent = state.actionLog.filter(
      (e) => e.actionId === def.id && e.turnIndex > state.turnIndex - def.habit!.window,
    ).length;
    if (recent >= def.habit.min) return { text: `습관 유지 중 · ${def.habit.label}`, warn: false };
    return {
      text: `최근 ${def.habit.window}개월 ${recent}/${def.habit.min} — ${def.habit.label}`,
      warn: false,
    };
  }
  return { text: total > 0 ? `지금까지 ${total}개월` : null, warn: false };
}

export function toPublicMonthlyActions(
  state: GameRunState,
  content: ContentIndex,
): PublicMonthlyActions | null {
  if (state.employment.status !== 'EMPLOYED' || state.phase === 'GAME_OVER') return null;
  const start = content.pack.rules.startAge;
  const options: PublicActionOption[] = content.pack.monthlyActions.actions.map((def) => {
    const cost = actionCost(def, state, content);
    const progress = progressOf(def, state, content);
    return {
      id: def.id,
      name: def.name,
      emoji: def.emoji,
      description: def.description,
      effects: effectLines(def, state, content),
      costLabel: cost > 0 ? won(-cost) : null,
      locked: actionLockReason(def, state, content),
      progress: progress.text,
      warn: progress.warn,
    };
  });
  return {
    options,
    selected: defaultActionId(state, content),
    habits: activeHabits(state, content, state.turnIndex - 1).map((h) => h.habit!.label),
    recent: state.actionLog.slice(-12).map((e) => {
      const info = turnInfo(e.turnIndex, start);
      const def = actionDef(content, e.actionId);
      return {
        age: info.age,
        month: info.monthOfYear,
        actionId: e.actionId,
        emoji: def.emoji,
        name: def.name,
      };
    }),
  };
}

export function toPublicActionResult(r: MonthActionResult, content: ContentIndex): PublicActionResult {
  const def = actionDef(content, r.actionId);
  const lines = RESOURCE_KEYS.flatMap((key) => {
    const d = r.resourceDelta[key] ?? 0;
    return d ? [`${RESOURCE_LABELS[key]} ${signed(d)}`] : [];
  });
  if (r.cashDelta) lines.push(`현금 ${won(r.cashDelta)}`);
  if (r.performance > 0) lines.push(`올해 평가 성과 누적 +${r.performance}`);
  return {
    name: r.streak > 1 ? `${def.name} (연속 ${r.streak}개월)` : def.name,
    emoji: def.emoji,
    lines,
    notes: r.notes,
    traitGains: r.traitChanges.map((t) =>
      t.kind === 'SKILL'
        ? t.from === 0
          ? `능력 '${traitName(content, t.id)}' 획득!`
          : `'${traitName(content, t.id)}' Lv.${t.to}로 성장!`
        : `상처 '${traitName(content, t.id)}' Lv.${t.to}`,
    ),
  };
}
