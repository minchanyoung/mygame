import { describe, expect, it } from 'vitest';
import type { GameRunState } from '@company-life/shared';
import { resolveChoice } from './events';
import { practiceCounts } from './practice';
import { ALWAYS_SUCCEED, content, employedRun, open } from './test-fixtures';

/** 처세술(socialSkill)이 성공률을 올려 주는 선택지 하나 */
const target = (() => {
  for (const e of content.pack.events) {
    if (e.scheduledOnly || e.series || e.conditions?.npc || e.conditions?.jobs) continue;
    const c = e.choices.find(
      (c) =>
        c.outcome?.modifiers?.some((m) => m.source === 'SKILL' && m.id === 'socialSkill') &&
        !c.enabledIf &&
        !c.visibleIf,
    );
    if (c) return { eventId: e.id, choiceId: c.id };
  }
  throw new Error('no practice choice');
})();

const succeed = (s: GameRunState) =>
  resolveChoice(open(s, target.eventId, { rng: ALWAYS_SUCCEED }), target.choiceId, content);

describe('D1 반복으로 자라는 능력', () => {
  it('그 능력이 돕는 선택지에서 성공한 횟수를 세고, 기준에 닿으면 Lv.1을 얻는다', () => {
    const { lv1 } = content.pack.rules.practice;
    let s = employedRun();
    for (let i = 0; i < lv1 - 1; i++) s = succeed(s).state;
    expect(practiceCounts(s, content)['socialSkill']).toBe(lv1 - 1);
    expect(s.skills['socialSkill'] ?? 0).toBe(0);
    const r = succeed(s);
    expect(r.state.skills['socialSkill']).toBe(1);
    expect(r.result.traitChanges.some((t) => t.id === 'socialSkill' && t.to === 1)).toBe(true);
  });
});
