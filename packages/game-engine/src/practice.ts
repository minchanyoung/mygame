import type { GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { applyEffects, type EffectContext, type TraitChange } from './effects';

/**
 * D1 반복으로 자라는 능력: 어떤 능력이 성공률을 올려 주는 선택지에서 성공할 때마다 그 능력의 '연습' 1회.
 * 연습이 쌓이면 Lv.1, 더 쌓이면 Lv.2 (규칙 `rules.practice`). 특별 사건으로 얻는 길은 그대로다.
 */
export function practiceCounts(state: GameRunState, content: ContentIndex): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of state.eventOccurrences) {
    if (o.success !== true) continue;
    const choice = content.events.get(o.eventId)?.choices.find((c) => c.id === o.choiceId);
    for (const m of choice?.outcome?.modifiers ?? []) {
      if (m.source === 'SKILL') counts[m.id] = (counts[m.id] ?? 0) + 1;
    }
  }
  return counts;
}

/** 방금 쌓인 연습으로 다음 레벨에 닿았으면 올린다 (한 번에 한 단계) */
export function applyPractice(draft: GameRunState, content: ContentIndex, ctx: EffectContext): TraitChange[] {
  const { lv1, lv2 } = content.pack.rules.practice;
  const counts = practiceCounts(draft, content);
  const changes: TraitChange[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (!content.traits.get(id)?.active) continue;
    const level = draft.skills[id] ?? 0;
    const target = n >= lv2 ? 2 : n >= lv1 ? 1 : 0;
    if (target > level) {
      changes.push(
        ...applyEffects(
          draft,
          [{ type: 'SKILL_SET_LEVEL', id, from: level as 0 | 1, to: (level + 1) as 1 | 2 }],
          ctx,
        ),
      );
    }
  }
  return changes;
}

/** 화면용: 다음 레벨까지 남은 연습 (Lv.2면 null) */
export function practiceProgress(state: GameRunState, content: ContentIndex) {
  const { lv1, lv2 } = content.pack.rules.practice;
  const counts = practiceCounts(state, content);
  return content.pack.traits
    .filter((t) => t.active && t.polarity === 'POSITIVE')
    .map((t) => {
      const level = state.skills[t.id] ?? 0;
      const n = counts[t.id] ?? 0;
      return { id: t.id, name: t.name, level, count: n, next: level >= 2 ? null : level === 1 ? lv2 : lv1 };
    });
}
