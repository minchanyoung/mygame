import type { ContentPack } from '@company-life/shared';
import backgrounds from '../data/backgrounds.json' with { type: 'json' };
import companies from '../data/companies.json' with { type: 'json' };
import endings from '../data/endings.json' with { type: 'json' };
import events from '../data/events.json' with { type: 'json' };
import npc from '../data/npc.json' with { type: 'json' };
import policy from '../data/policy.json' with { type: 'json' };
import rules from '../data/rules.json' with { type: 'json' };
import traits from '../data/traits.json' with { type: 'json' };
import { validateContentPack } from './validate';

export * from './validate';

/** 콘텐츠 버전. 데이터가 바뀌면 올린다. 새 run은 생성 시 이 버전에 고정된다 (§23.1). */
export const CONTENT_VERSION = '2026.11.17-p1.5';

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 검증 전 원시 콘텐츠 (관리자 검증·테스트에서 변형해 쓸 수 있도록 공개) */
export function rawContentPack(): unknown {
  return jsonClone({
    contentVersion: CONTENT_VERSION,
    rules,
    policy,
    traits,
    backgroundTraits: backgrounds,
    companies,
    npcPersonalities: npc.personalities,
    npcGeneration: npc.generation,
    fallbackEventId: 'evt_quiet_month',
    workFallbackEventId: 'evt_ordinary_workday',
    events,
    endings,
  });
}

let cached: ContentPack | undefined;

/** 검증된 콘텐츠 팩. 검증 실패 시 서버가 잘못된 콘텐츠로 뜨지 않도록 예외를 던진다. */
export function loadContentPack(): ContentPack {
  if (cached) return cached;
  const result = validateContentPack(rawContentPack());
  if (!result.ok) {
    const lines = result.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n');
    throw new Error(`Content pack ${CONTENT_VERSION} is invalid:\n${lines}`);
  }
  cached = result.pack;
  return cached;
}
