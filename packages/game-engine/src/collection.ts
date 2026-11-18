import {
  COLLECTION_KINDS,
  DIFFICULTY_LABELS,
  type AchievementRule,
  type CollectionKind,
  type Difficulty,
  type EndingType,
  type GameRunState,
  type PlayerCollection,
  type PublicAchievement,
  type PublicCollection,
  type PublicCollectionCategory,
  type PublicCollectionItem,
  type RunDiscovery,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';

/** S10 도감: 한 판에서 발견한 것 → 플레이어 도감에 합치고 업적을 판정한다. 모두 순수 함수. */

export type RunFinds = Record<CollectionKind, string[]>;

const NORMAL_TYPES: readonly EndingType[] = ['RETIREMENT', 'EXECUTIVE_PROMOTION', 'EARLY_RETIREMENT'];
export const endingCategoryOf = (type: string): 'FAILURE' | 'NORMAL' =>
  (NORMAL_TYPES as readonly string[]).includes(type) ? 'NORMAL' : 'FAILURE';

const RECENT_LIMIT = 10;
const RUN_ID_LIMIT = 500;

/** 연재 결말 = 마지막 화(정리 화 포함)의 선택 하나 */
function seriesEndingDefs(content: ContentIndex) {
  return content.pack.events
    .filter((e) => e.series && e.series.episode === e.series.total)
    .flatMap((e) =>
      e.choices.map((c) => ({
        key: `${e.id}:${c.id}`,
        seriesId: e.series!.id,
        seriesTitle: e.series!.title,
        name: e.id.endsWith('_farewell')
          ? `${e.title} · ${c.label.replace(/^"|"$/g, '')}`
          : `“${c.label.replace(/^"|"$/g, '')}”`,
      })),
    );
}

/** 끝난 판 하나에서 발견한 것 (엔딩이 확정된 상태여야 한다) */
export function collectRun(state: GameRunState, content: ContentIndex): RunFinds {
  const ending = state.ending;
  if (!ending) return { titles: [], endings: [], goals: [], companies: [], seriesEndings: [], traits: [] };
  const finales = new Set(seriesEndingDefs(content).map((d) => d.key));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    titles: uniq(ending.titles ?? []),
    endings: [ending.type],
    goals: ending.goal?.achieved ? [ending.goal.goalId] : [],
    // 팀이 만들어진 회사 = 입사·이직으로 다닌 회사
    companies: uniq([
      ...state.npcAssignments.map((a) => a.companyId),
      ...state.yearlyRecords.flatMap((r) => (r.companyId ? [r.companyId] : [])),
    ]).filter((id) => content.companies.has(id)),
    seriesEndings: uniq(
      state.eventOccurrences.map((o) => `${o.eventId}:${o.choiceId}`).filter((k) => finales.has(k)),
    ),
    traits: uniq(
      [...state.skillHistory, ...state.traitHistory]
        .filter((t) => t.to > 0)
        .map((t) => t.traitId)
        .filter((id) => content.traits.get(id)?.active),
    ),
  };
}

function matchesAchievement(rule: AchievementRule, col: PlayerCollection, content: ContentIndex): boolean {
  if (rule.runs !== undefined && col.runsFinished < rule.runs) return false;
  if (rule.endingTypes || rule.endingCategory || rule.difficulty) {
    const ok = Object.entries(col.endings).some(
      ([type, e]) =>
        (!rule.endingTypes || (rule.endingTypes as readonly string[]).includes(type)) &&
        (!rule.endingCategory || endingCategoryOf(type) === rule.endingCategory) &&
        (!rule.difficulty || e.difficulties.includes(rule.difficulty)),
    );
    if (!ok) return false;
  }
  if (
    rule.failureEndings !== undefined &&
    Object.keys(col.endings).filter((t) => endingCategoryOf(t) === 'FAILURE').length < rule.failureEndings
  )
    return false;
  if (rule.titles !== undefined && Object.keys(col.titles).length < rule.titles) return false;
  if (
    rule.titleRarity &&
    !Object.keys(col.titles).some(
      (id) => content.pack.titles.find((t) => t.id === id)?.rarity === rule.titleRarity,
    )
  )
    return false;
  if (rule.allSeries || rule.seriesEndingsInOne !== undefined) {
    const defs = seriesEndingDefs(content);
    const perSeries = new Map<string, number>();
    for (const d of defs) perSeries.set(d.seriesId, perSeries.get(d.seriesId) ?? 0);
    for (const d of defs)
      if (col.seriesEndings[d.key]) perSeries.set(d.seriesId, perSeries.get(d.seriesId)! + 1);
    if (rule.allSeries && [...perSeries.values()].some((n) => n === 0)) return false;
    if (rule.seriesEndingsInOne !== undefined && Math.max(0, ...perSeries.values()) < rule.seriesEndingsInOne)
      return false;
  }
  if (rule.companies !== undefined && Object.keys(col.companies).length < rule.companies) return false;
  if (
    rule.companyGrade &&
    !Object.keys(col.companies).some((id) => content.companies.get(id)?.grade === rule.companyGrade)
  )
    return false;
  if (rule.goals !== undefined && Object.keys(col.goals).length < rule.goals) return false;
  return true;
}

/**
 * 끝난 판을 도감에 합친다. 같은 판은 두 번 반영하지 않는다(그때의 발견 기록을 그대로 돌려줌).
 * 새로 달성한 업적도 함께 기록한다.
 */
export function mergeRun(
  col: PlayerCollection,
  runId: string,
  finds: RunFinds,
  difficulty: Difficulty,
  now: string,
  content: ContentIndex,
): { collection: PlayerCollection; discovery: RunDiscovery } {
  if (col.runIds.includes(runId)) {
    const prev = col.recent.find((r) => r.runId === runId);
    return {
      collection: col,
      discovery: prev ?? {
        runId,
        newly: { titles: [], endings: [], goals: [], companies: [], seriesEndings: [], traits: [] },
        achievements: [],
      },
    };
  }
  const next = JSON.parse(JSON.stringify(col)) as PlayerCollection;
  const newly = {} as RunDiscovery['newly'];
  for (const kind of COLLECTION_KINDS) {
    newly[kind] = [];
    for (const id of finds[kind]) {
      const entry = next[kind][id];
      if (entry) {
        entry.count += 1;
        if (!entry.difficulties.includes(difficulty)) entry.difficulties.push(difficulty);
      } else {
        next[kind][id] = { count: 1, firstAt: now, difficulties: [difficulty] };
        newly[kind].push(id);
      }
    }
  }
  next.runsFinished += 1;
  next.runIds = [...next.runIds, runId].slice(-RUN_ID_LIMIT);
  const achievements = content.pack.achievements
    .filter((a) => !next.achievements[a.id] && matchesAchievement(a.rule, next, content))
    .map((a) => a.id);
  for (const id of achievements) next.achievements[id] = { at: now };
  const discovery: RunDiscovery = { runId, newly, achievements };
  next.recent = [...next.recent, discovery].slice(-RECENT_LIMIT);
  return { collection: next, discovery };
}

const RARITY_LABEL = { LEGENDARY: '전설', RARE: '드묾', COMMON: '흔함' } as const;
const hint = (text: string, n = 9) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** 화면용 도감. runId를 주면 그 판의 새 발견을 함께 돌려준다. */
export function toPublicCollection(
  col: PlayerCollection,
  content: ContentIndex,
  runId?: string,
): PublicCollection {
  const item = (
    kind: CollectionKind,
    id: string,
    shown: { name: string; emoji: string | null; text: string; tag: string | null },
    hidden: { text: string; tag: string | null; emoji?: string | null; name?: string },
  ): PublicCollectionItem => {
    const e = col[kind][id];
    return e
      ? {
          id,
          found: true,
          ...shown,
          count: e.count,
          firstAt: e.firstAt,
          difficulties: e.difficulties.map((d) => DIFFICULTY_LABELS[d]),
        }
      : {
          id,
          found: false,
          name: hidden.name ?? '???',
          emoji: hidden.emoji ?? null,
          text: hidden.text,
          tag: hidden.tag,
          count: 0,
          firstAt: null,
          difficulties: [],
        };
  };
  const { endings } = content.pack;
  const endingTypes = [...Object.keys(endings.causes), 'EARLY_RETIREMENT'];
  const endingDef = (t: string) =>
    t === 'EARLY_RETIREMENT' ? endings.earlyRetirement : endings.causes[t as keyof typeof endings.causes];

  const categories: Omit<PublicCollectionCategory, 'found' | 'total'>[] = [
    {
      key: 'titles',
      label: '별명',
      items: content.pack.titles.map((t) =>
        item(
          'titles',
          t.id,
          { name: t.name, emoji: t.emoji, text: t.reason, tag: RARITY_LABEL[t.rarity] },
          { text: hint(t.reason), tag: RARITY_LABEL[t.rarity] },
        ),
      ),
    },
    {
      key: 'endings',
      label: '엔딩',
      items: endingTypes.map((t) => {
        const def = endingDef(t);
        const tag = endingCategoryOf(t) === 'NORMAL' ? '정상 엔딩' : '실패 엔딩';
        return item(
          'endings',
          t,
          { name: def.title, emoji: null, text: def.text, tag },
          { text: hint(def.text, 10), tag },
        );
      }),
    },
    {
      key: 'goals',
      label: '인생 목표',
      // 목표는 고를 때 이미 공개되므로 이름은 보여 주고, '달성'만 수집으로 친다
      items: content.pack.lifeGoals.map((g) =>
        item(
          'goals',
          g.id,
          { name: g.title, emoji: g.emoji, text: g.achievedText, tag: '달성' },
          { name: g.title, emoji: g.emoji, text: g.description, tag: '미달성' },
        ),
      ),
    },
    {
      key: 'companies',
      label: '회사',
      items: content.pack.companies.map((c) =>
        item(
          'companies',
          c.id,
          { name: c.name, emoji: null, text: c.description, tag: `${c.grade}등급 · ${c.industry}` },
          { text: '아직 다녀 보지 않은 회사', tag: `${c.grade}등급 · ${c.industry}` },
        ),
      ),
    },
    {
      key: 'seriesEndings',
      label: '연재 결말',
      items: seriesEndingDefs(content).map((d) =>
        item(
          'seriesEndings',
          d.key,
          { name: d.name, emoji: '📖', text: d.seriesTitle, tag: d.seriesTitle },
          { text: '아직 보지 못한 결말', tag: d.seriesTitle },
        ),
      ),
    },
    {
      key: 'traits',
      label: '특성',
      items: content.pack.traits
        .filter((t) => t.active)
        .map((t) => {
          const tag = t.polarity === 'POSITIVE' ? '능력' : '상처';
          return item(
            'traits',
            t.id,
            { name: t.name, emoji: t.polarity === 'POSITIVE' ? '✨' : '🩹', text: t.description, tag },
            { text: '아직 발견하지 못했다', tag },
          );
        }),
    },
  ];
  const full = categories.map((c) => ({
    ...c,
    found: c.items.filter((i) => i.found).length,
    total: c.items.length,
  }));
  const achievements: PublicAchievement[] = content.pack.achievements.map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    description: a.description,
    done: Boolean(col.achievements[a.id]),
    at: col.achievements[a.id]?.at ?? null,
  }));

  const recent = runId ? col.recent.find((r) => r.runId === runId) : undefined;
  const discovery = recent
    ? {
        items: COLLECTION_KINDS.flatMap((kind) => {
          const cat = full.find((c) => c.key === kind)!;
          return recent.newly[kind].flatMap((id) => {
            const it = cat.items.find((i) => i.id === id);
            return it ? [{ category: cat.label, name: it.name, emoji: it.emoji }] : [];
          });
        }),
        achievements: achievements.filter((a) => recent.achievements.includes(a.id)),
      }
    : null;

  return {
    runsFinished: col.runsFinished,
    found: full.reduce((s, c) => s + c.found, 0),
    total: full.reduce((s, c) => s + c.total, 0),
    categories: full,
    achievements,
    discovery,
  };
}
