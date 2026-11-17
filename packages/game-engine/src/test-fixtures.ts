/**
 * 테스트 전용 픽스처 (§22.3: 테스트 픽스처는 개발 도구에서만 사용). 패키지 index에서 export하지 않는다.
 */
import { loadContentPack } from '@company-life/content';
import type { GameRunState, Npc, PlayerProfile } from '@company-life/shared';
import { indexContent, type ContentIndex } from './content-index';
import { openEvent } from './events';
import { applyForJob } from './jobs';
import { chooseCharacter, createRun } from './run';
import { SeededRng } from './rng';

export const content: ContentIndex = indexContent(loadContentPack());

export const PROFILE: PlayerProfile = { displayName: '김하늘', gender: 'FEMALE' };

export function newRun(seed = 'test-seed', profile: PlayerProfile = PROFILE): GameRunState {
  return createRun(
    { runId: 'run-test', guestOwnerId: 'guest-test', seed, profile, now: '2026-11-17T00:00:00.000Z' },
    content,
  );
}

/** 확정 합격(픽스처)으로 입사까지 진행한 상태 */
export function employedRun(seed = 'test-seed', offerIndex = 2): GameRunState {
  const chosen = chooseCharacter(newRun(seed), 'card_1', content);
  const offer = chosen.jobOffers[offerIndex]!;
  const forced: GameRunState = {
    ...chosen,
    jobOffers: chosen.jobOffers.map((o) => (o.offerId === offer.offerId ? { ...o, hireChance: 1 } : o)),
  };
  return applyForJob(forced, offer.offerId, content).state;
}

/** 판정 결과를 고정하기 위한 RNG 상태: 'low'는 roll < 0.05(clamp 하한 → 항상 성공), 'high'는 roll >= 0.95(항상 실패) */
export function rngStateFor(kind: 'low' | 'high'): number {
  for (let s = 1; s < 1_000_000; s++) {
    const roll = new SeededRng(s).nextFloat();
    if (kind === 'low' ? roll < 0.05 : roll >= 0.95) return s;
  }
  throw new Error('no rng state found');
}
export const ALWAYS_SUCCEED = rngStateFor('low');
export const ALWAYS_FAIL = rngStateFor('high');

export function withTraits(
  state: GameRunState,
  skills: Record<string, 1 | 2> = {},
  negativeTraits: Record<string, 1 | 2> = {},
): GameRunState {
  return { ...state, skills: { ...skills }, negativeTraits: { ...negativeTraits } };
}

export function team(state: GameRunState): { boss: Npc; peers: Npc[] } {
  const active = state.npcs.filter((n) => n.active);
  return { boss: active.find((n) => n.role === 'BOSS')!, peers: active.filter((n) => n.role === 'PEER') };
}

/** NPC 하나의 성향/관계를 덮어쓴 상태 (NPC 이벤트 픽스처) */
export function withNpc(state: GameRunState, npcId: string, patch: Partial<Npc>): GameRunState {
  return { ...state, npcs: state.npcs.map((n) => (n.npcId === npcId ? { ...n, ...patch } : n)) };
}

export function open(
  state: GameRunState,
  eventId: string,
  opts: { participantNpcId?: string | null; rng?: number } = {},
): GameRunState {
  const opened = openEvent(state, { eventId, participantNpcId: opts.participantNpcId ?? null }, content);
  return { ...opened, rngState: opts.rng ?? opened.rngState };
}
