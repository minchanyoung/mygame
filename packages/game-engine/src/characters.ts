import {
  RESOURCE_KEYS,
  type BackgroundTraitDefinition,
  type CharacterCard,
  type PlayerProfile,
  type Resources,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { EngineError } from './errors';
import { clampStat } from './numbers';
import { SeededRng } from './rng';

export const CARD_COUNT = 3;

/**
 * §3.1 랜덤 캐릭터 카드 3장 생성. 프로필(이름·성별)은 입력값으로만 쓰고 RNG에 영향을 주지 않는다.
 * RNG는 배경·특성·초기 자원에만 사용한다. 각 범주는 섞은 뒤 앞에서 3개를 뽑으므로
 * 세 카드의 대학·전공·강점·약점이 서로 겹치지 않는다(다양성 보장).
 * 영구 능력/부정 특성은 모든 카드에서 빈 컬렉션이다.
 */
export function generateCharacterCards(
  profile: PlayerProfile,
  seed: string,
  content: ContentIndex,
): CharacterCard[] {
  const rng = SeededRng.derive(seed, 'cards');
  const { rules } = content.pack;
  const byKind = (kind: BackgroundTraitDefinition['kind']) =>
    content.pack.backgroundTraits.filter((b) => b.kind === kind);

  const draw = (kind: BackgroundTraitDefinition['kind']): BackgroundTraitDefinition[] => {
    const pool = byKind(kind);
    if (pool.length < CARD_COUNT) {
      throw new EngineError(
        'UNKNOWN_REFERENCE',
        `background pool '${kind}' needs at least ${CARD_COUNT} entries`,
      );
    }
    return rng.shuffle(pool).slice(0, CARD_COUNT);
  };

  const universities = draw('UNIVERSITY');
  const majors = draw('MAJOR');
  const strengths = draw('STRENGTH');
  const weaknesses = draw('WEAKNESS');

  return Array.from({ length: CARD_COUNT }, (_, i) => {
    const parts = [universities[i], majors[i], strengths[i], weaknesses[i]] as BackgroundTraitDefinition[];
    const [university, major, strength, weakness] = parts as [
      BackgroundTraitDefinition,
      BackgroundTraitDefinition,
      BackgroundTraitDefinition,
      BackgroundTraitDefinition,
    ];

    const resources = {} as Resources;
    for (const key of RESOURCE_KEYS) {
      const jitter =
        key === 'reputation' ? 0 : rng.int(-rules.character.resourceJitter, rules.character.resourceJitter);
      const delta = parts.reduce((sum, p) => sum + (p.resourceDeltas?.[key] ?? 0), 0);
      resources[key] = clampStat(rules.character.baseResources[key] + delta + jitter);
    }

    // 가정 환경은 S6에서 제거: 시작 현금은 모두 같은 기준에서 강점·약점 보정만 받는다
    const cash = Math.max(
      0,
      rules.character.baseCash + parts.reduce((sum, p) => sum + (p.cashDelta ?? 0), 0),
    );
    const debt = parts.reduce((sum, p) => sum + (p.debtDelta ?? 0), 0);

    return {
      cardId: `card_${i + 1}`,
      profile: { displayName: profile.displayName, gender: profile.gender },
      startAge: rules.startAge,
      universityId: university.id,
      majorId: major.id,
      strengthId: strength.id,
      weaknessId: weakness.id,
      backgroundTraits: parts.map((p) => p.id),
      resources,
      cash,
      debt,
      skills: {},
      negativeTraits: {},
    };
  });
}
