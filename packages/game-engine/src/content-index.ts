import type {
  BackgroundTraitDefinition,
  CompanyDefinition,
  ContentPack,
  EventDefinition,
  NpcPersonalityDefinition,
  TraitDefinition,
} from '@company-life/shared';
import { EngineError } from './errors';

/** 콘텐츠 팩 조회용 인덱스. 엔진은 ContentPack 대신 이 인덱스를 받는다. */
export interface ContentIndex {
  pack: ContentPack;
  traits: Map<string, TraitDefinition>;
  backgrounds: Map<string, BackgroundTraitDefinition>;
  companies: Map<string, CompanyDefinition>;
  personalities: Map<string, NpcPersonalityDefinition>;
  events: Map<string, EventDefinition>;
}

const cache = new WeakMap<ContentPack, ContentIndex>();

export function indexContent(pack: ContentPack): ContentIndex {
  const cached = cache.get(pack);
  if (cached) return cached;
  const index: ContentIndex = {
    pack,
    traits: new Map(pack.traits.map((t) => [t.id, t])),
    backgrounds: new Map(pack.backgroundTraits.map((b) => [b.id, b])),
    companies: new Map(pack.companies.map((c) => [c.id, c])),
    personalities: new Map(pack.npcPersonalities.map((p) => [p.id, p])),
    events: new Map(pack.events.map((e) => [e.id, e])),
  };
  cache.set(pack, index);
  return index;
}

export function requireFrom<T>(map: Map<string, T>, id: string, kind: string): T {
  const value = map.get(id);
  if (value === undefined) throw new EngineError('UNKNOWN_REFERENCE', `unknown ${kind}: ${id}`, { kind, id });
  return value;
}
