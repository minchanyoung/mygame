import type { Choice, GameRunState, GameRules, RiskLevel, TraitLevel } from '@company-life/shared';
import { inRange, traitLevel, type EvalContext } from './conditions';
import type { ContentIndex } from './content-index';
import { clamp, roundChance } from './numbers';

export interface ChanceBreakdownItem {
  source: 'BASE' | 'SKILL' | 'NEGATIVE_TRAIT' | 'NPC' | 'BACKGROUND' | 'RESOURCE';
  id: string | null;
  /** SKILL/NEGATIVE_TRAIT: 판정에 사용한 보유 레벨 */
  level?: TraitLevel;
  bonus: number;
}

export interface ChanceResult {
  chance: number;
  /** clamp 전 합계 */
  rawChance: number;
  breakdown: ChanceBreakdownItem[];
}

/**
 * 레벨별 보너스는 누적이 아닌 치환형: 보유 레벨 이하에서 가장 높은 정의된 레벨 1개만 적용 (§7.5, §23.2).
 * 예) levels {"2": 0.2} + Lv.1 → 0 / levels {"1": 0.1, "2": 0.12} + Lv.2 → 0.12 (0.22가 아님)
 */
export function levelBonus(
  levels: { '1'?: number | undefined; '2'?: number | undefined },
  current: TraitLevel,
): number {
  if (current >= 2 && levels['2'] !== undefined) return levels['2'];
  if (current >= 1 && levels['1'] !== undefined) return levels['1'];
  return 0;
}

/**
 * 선택지 성공 확률 = clamp(base + Σ능력(최고 충족 레벨 1개) + Σ부정특성 + ΣNPC + Σ배경 + Σ상황, min, max).
 * 반드시 사건 해결 "직전" 상태로 계산한다. 이번 결과로 얻는 능력은 소급되지 않는다 (§4.2).
 * 판정이 없는 선택지는 null.
 */
export function calculateChoiceChance(
  state: GameRunState,
  choice: Choice,
  ctx: EvalContext,
  content: ContentIndex,
): ChanceResult | null {
  if (!choice.outcome) return null;
  const { chanceMin, chanceMax } = content.pack.rules;
  const breakdown: ChanceBreakdownItem[] = [{ source: 'BASE', id: null, bonus: choice.outcome.baseChance }];

  for (const m of choice.outcome.modifiers ?? []) {
    switch (m.source) {
      case 'SKILL':
      case 'NEGATIVE_TRAIT': {
        const level = traitLevel(m.source === 'SKILL' ? state.skills : state.negativeTraits, m.id);
        const bonus = levelBonus(m.levels, level);
        if (bonus !== 0) breakdown.push({ source: m.source, id: m.id, level, bonus });
        break;
      }
      case 'NPC': {
        // NPC가 실제로 사건에 참여하는 경우에만 적용 (§8.3-3)
        const npc = ctx.participant;
        if (!npc) break;
        if (m.personalityAny && !m.personalityAny.some((t) => npc.personalityTags.includes(t))) break;
        if (m.relation) {
          const ok = Object.entries(m.relation).every(
            ([stat, range]) => !range || inRange(npc[stat as 'favor' | 'trust' | 'rivalry'], range),
          );
          if (!ok) break;
        }
        breakdown.push({ source: 'NPC', id: npc.npcId, bonus: m.bonus });
        break;
      }
      case 'BACKGROUND':
        if (state.backgroundTraits.includes(m.id))
          breakdown.push({ source: 'BACKGROUND', id: m.id, bonus: m.bonus });
        break;
      case 'RESOURCE':
        if (inRange(state.resources[m.key], m.range))
          breakdown.push({ source: 'RESOURCE', id: m.key, bonus: m.bonus });
        break;
    }
  }

  const rawChance = roundChance(breakdown.reduce((sum, b) => sum + b.bonus, 0));
  return { chance: roundChance(clamp(rawChance, chanceMin, chanceMax)), rawChance, breakdown };
}

/** §22.1 위험 등급: 서버가 보정 후 확률로 결정. 정확한 확률은 공개하지 않는다. */
export function riskLevel(chance: number, rules: GameRules): RiskLevel {
  if (chance >= rules.riskThresholds.low) return 'LOW';
  if (chance >= rules.riskThresholds.medium) return 'MEDIUM';
  return 'HIGH';
}
