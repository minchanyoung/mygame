import {
  JOB_IDS,
  JOB_LABELS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  type BackgroundTraitDefinition,
  type CharacterCard,
  type JobId,
  type PublicEffect,
} from '@company-life/shared';
import { requireFrom, type ContentIndex } from './content-index';

/**
 * 배경 특성(대학·전공·가정·강점·약점)의 "실제" 효과를 콘텐츠 데이터에서 계산한다.
 * 카드에 쓰인 문구가 곧 엔진이 쓰는 규칙이 되도록, 설명 문장이 아니라 데이터만 근거로 삼는다.
 */

const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%p`;
const manwon = (n: number) => `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`;
const toneOf = (v: number): PublicEffect['tone'] => (v > 0 ? 'good' : v < 0 ? 'bad' : 'neutral');

interface EventBonus {
  bonus: number;
  titles: string[];
}

const eventBonusCache = new WeakMap<ContentIndex, Map<string, EventBonus[]>>();

/** 배경 특성 ID → 사건 판정 보정 목록 (부호별로 묶음) */
function eventBonuses(content: ContentIndex): Map<string, EventBonus[]> {
  const cached = eventBonusCache.get(content);
  if (cached) return cached;
  const raw = new Map<string, Map<number, Set<string>>>();
  for (const event of content.pack.events) {
    if (event.status !== 'published') continue;
    for (const choice of event.choices) {
      for (const m of choice.outcome?.modifiers ?? []) {
        if (m.source !== 'BACKGROUND') continue;
        const byBonus = raw.get(m.id) ?? new Map<number, Set<string>>();
        const titles = byBonus.get(m.bonus) ?? new Set<string>();
        titles.add(event.title);
        byBonus.set(m.bonus, titles);
        raw.set(m.id, byBonus);
      }
    }
  }
  const out = new Map<string, EventBonus[]>();
  for (const [id, byBonus] of raw) {
    out.set(
      id,
      [...byBonus.entries()]
        .map(([bonus, titles]) => ({ bonus, titles: [...titles] }))
        .sort((a, b) => b.bonus - a.bonus),
    );
  }
  eventBonusCache.set(content, out);
  return out;
}

export function backgroundEffects(def: BackgroundTraitDefinition, content: ContentIndex): PublicEffect[] {
  const effects: PublicEffect[] = [];

  for (const key of RESOURCE_KEYS) {
    const d = def.resourceDeltas?.[key];
    if (d)
      effects.push({
        text: `시작 ${RESOURCE_LABELS[key]} ${d > 0 ? '+' : '−'}${Math.abs(d)}`,
        tone: toneOf(d),
      });
  }
  if (def.cash !== undefined) effects.push({ text: `시작 현금 ${manwon(def.cash)}`, tone: 'neutral' });
  if (def.cashDelta) {
    effects.push({
      text: `시작 현금 ${def.cashDelta > 0 ? '+' : '−'}${manwon(Math.abs(def.cashDelta))}`,
      tone: toneOf(def.cashDelta),
    });
  }
  if (def.debtDelta) effects.push({ text: `빚 ${manwon(def.debtDelta)}을 안고 시작`, tone: 'bad' });

  if (def.fitsJobs?.length) {
    const fit = content.pack.rules.hiring.majorFitBonus;
    effects.push({
      text: `${def.fitsJobs.map((j) => JOB_LABELS[j]).join('·')} 지원 시 합격률 ${pct(fit)}`,
      tone: 'good',
    });
  }
  if (def.hireBonus?.all) {
    effects.push({ text: `모든 회사 합격률 ${pct(def.hireBonus.all)}`, tone: toneOf(def.hireBonus.all) });
  }
  for (const job of JOB_IDS) {
    const b = def.hireBonus?.byJob?.[job];
    if (b) effects.push({ text: `${JOB_LABELS[job]} 지원 시 합격률 ${pct(b)}`, tone: toneOf(b) });
  }

  for (const { bonus, titles } of eventBonuses(content).get(def.id) ?? []) {
    effects.push({
      text: `관련 사건 ${titles.length}개 성공률 ${pct(bonus)}`,
      tone: toneOf(bonus),
      detail: titles.join(', '),
    });
  }
  return effects;
}

/** 카드의 전공·강점·약점·대학 합격률 보정을 직무별로 합산해 가장 유리한 직무 */
export function recommendedJob(
  card: CharacterCard,
  content: ContentIndex,
): { jobId: JobId; label: string; bonusPercent: number } {
  const defs = card.backgroundTraits.map((id) => requireFrom(content.backgrounds, id, 'background'));
  const fitBonus = content.pack.rules.hiring.majorFitBonus;
  let best: { jobId: JobId; total: number } = { jobId: JOB_IDS[0], total: -Infinity };
  for (const job of JOB_IDS) {
    const total = defs.reduce(
      (sum, d) =>
        sum +
        (d.hireBonus?.all ?? 0) +
        (d.hireBonus?.byJob?.[job] ?? 0) +
        (d.fitsJobs?.includes(job) ? fitBonus : 0),
      0,
    );
    if (total > best.total) best = { jobId: job, total };
  }
  return { jobId: best.jobId, label: JOB_LABELS[best.jobId], bonusPercent: Math.round(best.total * 100) };
}
