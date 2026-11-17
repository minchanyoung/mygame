import {
  NPC_RANKS,
  PLAYER_RANKS,
  type GameRunState,
  type Npc,
  type NpcAssignment,
  type NpcPersonalityDefinition,
  type NpcRank,
  type NpcRole,
  type PlayerRank,
} from '@company-life/shared';
import { requireFrom, type ContentIndex } from './content-index';
import { clampStat } from './numbers';
import { SeededRng } from './rng';

export interface GenerateNpcParams {
  seed: string;
  companyId: string;
  teamId: string;
  turnIndex: number;
  playerRank: PlayerRank;
  /** 교체 상사 등 추가 생성 시 별도 시드 스트림 (§21.3) */
  stream?: number;
}

const PEER_COUNT = 2;

function pickPersonality(
  rng: SeededRng,
  role: NpcRole,
  cultureTags: readonly string[],
  content: ContentIndex,
): NpcPersonalityDefinition {
  const { npcGeneration } = content.pack;
  const pool = content.pack.npcPersonalities.filter((p) => p.role === role);
  // 기본 가중치가 모든 성향에 있으므로 어떤 회사에서도 좋은/나쁜 NPC가 모두 나올 수 있다 (§8.1).
  const weights = pool.map(
    (p) =>
      npcGeneration.baseTagWeight +
      cultureTags.reduce((sum, tag) => sum + (npcGeneration.cultureWeightBonus[tag]?.[p.id] ?? 0), 0),
  );
  return pool[rng.weightedIndex(weights)] as NpcPersonalityDefinition;
}

function makeNpc(
  rng: SeededRng,
  params: GenerateNpcParams,
  role: NpcRole,
  rank: NpcRank,
  slot: string,
  usedNames: Set<string>,
  cultureTags: readonly string[],
  content: ContentIndex,
): Npc {
  const { npcGeneration } = content.pack;
  const primary = pickPersonality(rng, role, cultureTags, content);
  const tags = [primary.id];
  // 혼합 성향: 태그가 선악을 완전히 결정하지 않도록 보조 성향을 붙일 수 있다 (§8.2).
  if (rng.nextFloat() < npcGeneration.secondaryTagChance) {
    const others = content.pack.npcPersonalities.filter((p) => p.id !== primary.id);
    tags.push(rng.pick(others).id);
  }
  const bias = (key: 'competence' | 'fairness' | 'ambition' | 'favor' | 'trust' | 'rivalry') =>
    tags.reduce(
      (sum, id) => sum + (requireFrom(content.personalities, id, 'personality').statBias?.[key] ?? 0),
      0,
    );

  let name = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    name = rng.pick(npcGeneration.surnames) + rng.pick(npcGeneration.givenNames);
    if (!usedNames.has(name)) break;
  }
  usedNames.add(name);

  const rel = (stat: 'favor' | 'trust' | 'rivalry') => {
    const range = npcGeneration.relationInitial[stat] ?? { min: 40, max: 60 };
    return clampStat(rng.int(range.min, range.max) + bias(stat));
  };

  const stream = params.stream ?? 0;
  return {
    npcId: `npc_${params.companyId.replace(/^company_/, '')}_${params.teamId}_t${params.turnIndex}_s${stream}_${slot}`,
    companyId: params.companyId,
    teamId: params.teamId,
    name,
    role,
    rank,
    personalityTags: tags,
    competence: clampStat(rng.int(30, 80) + bias('competence')),
    fairness: clampStat(rng.int(30, 80) + bias('fairness')),
    ambition: clampStat(rng.int(30, 80) + bias('ambition')),
    favor: rel('favor'),
    trust: rel('trust'),
    rivalry: rel('rivalry'),
    memoryFlags: [],
    relationshipHistory: [],
    active: true,
    createdAtTurn: params.turnIndex,
  };
}

/**
 * §8 회사 입사 시 상사 1명 + 동료 2명 생성. 시드는 run 시드 + 회사 + 팀 + 입사 턴 + 스트림에 결합된다.
 * 직속 상사의 직급은 항상 플레이어보다 높다 (§21.2).
 */
export function generateCompanyNpcs(params: GenerateNpcParams, content: ContentIndex): Npc[] {
  const company = requireFrom(content.companies, params.companyId, 'company');
  const rng = SeededRng.derive(
    params.seed,
    'npc',
    params.companyId,
    params.teamId,
    params.turnIndex,
    params.stream ?? 0,
  );
  const usedNames = new Set<string>();
  const playerIdx = PLAYER_RANKS.indexOf(params.playerRank);
  const maxIdx = NPC_RANKS.length - 1;
  const bossIdx = Math.min(playerIdx + rng.int(1, 2), maxIdx);
  const boss = makeNpc(
    rng,
    params,
    'BOSS',
    NPC_RANKS[bossIdx] as NpcRank,
    'boss',
    usedNames,
    company.cultureTags,
    content,
  );
  const peers = Array.from({ length: PEER_COUNT }, (_, i) => {
    const peerIdx = Math.min(playerIdx + rng.int(0, 1), bossIdx - 1);
    return makeNpc(
      rng,
      params,
      'PEER',
      NPC_RANKS[Math.max(0, peerIdx)] as NpcRank,
      `peer${i + 1}`,
      usedNames,
      company.cultureTags,
      content,
    );
  });
  return [boss, ...peers];
}

export function activeAssignments(state: GameRunState, companyId: string, teamId: string): NpcAssignment[] {
  return state.npcAssignments.filter(
    (a) => a.companyId === companyId && a.teamId === teamId && a.toTurn === null,
  );
}

/** 현재 근무 중인 팀의 활성 NPC (상사/동료) */
export function currentTeamNpcs(state: GameRunState): Array<{ npc: Npc; role: NpcRole }> {
  const job = state.employment.current;
  if (state.employment.status !== 'EMPLOYED' || !job) return [];
  const result: Array<{ npc: Npc; role: NpcRole }> = [];
  for (const a of activeAssignments(state, job.companyId, job.teamId)) {
    if (a.role === 'FORMER_BOSS') continue;
    const npc = state.npcs.find((n) => n.npcId === a.npcId && n.active);
    if (npc) result.push({ npc, role: a.role });
  }
  // 상사 먼저, 그 다음 ID 순 — 결정적 순서
  return result.sort((x, y) =>
    x.role === y.role ? x.npc.npcId.localeCompare(y.npc.npcId) : x.role === 'BOSS' ? -1 : 1,
  );
}

/**
 * §21.2 직속 상사의 직급은 항상 플레이어보다 높아야 한다. 플레이어가 상사와 같거나 높아지면
 * 기존 상사는 FORMER_BOSS로 남기고(ID·관계·기억 보존, 삭제하지 않음) 별도 시드 스트림으로 새 상사를 생성한다.
 * 이미 조건을 만족하면 아무것도 바꾸지 않는다 (재호출해도 다시 굴리지 않음).
 */
export function reassignBossIfNeeded(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; replaced: boolean } {
  const job = state.employment.current;
  if (!job) return { state, replaced: false };
  const bossEntry = currentTeamNpcs(state).find((t) => t.role === 'BOSS');
  const playerIdx = NPC_RANKS.indexOf(job.rank);
  if (bossEntry && NPC_RANKS.indexOf(bossEntry.npc.rank) > playerIdx) return { state, replaced: false };

  const bossesSoFar = new Set(
    state.npcs
      .filter((n) => n.companyId === job.companyId && n.teamId === job.teamId && n.role === 'BOSS')
      .map((n) => n.npcId),
  ).size;
  const [newBoss] = generateCompanyNpcs(
    {
      seed: state.seed,
      companyId: job.companyId,
      teamId: job.teamId,
      turnIndex: state.turnIndex,
      playerRank: job.rank,
      stream: bossesSoFar,
    },
    content,
  );
  if (!newBoss) return { state, replaced: false };

  const npcAssignments = state.npcAssignments.flatMap((a): NpcAssignment[] =>
    bossEntry && a.npcId === bossEntry.npc.npcId && a.role === 'BOSS' && a.toTurn === null
      ? [
          { ...a, toTurn: state.turnIndex },
          { ...a, role: 'FORMER_BOSS', fromTurn: state.turnIndex, toTurn: null },
        ]
      : [a],
  );
  npcAssignments.push({
    npcId: newBoss.npcId,
    companyId: job.companyId,
    teamId: job.teamId,
    role: 'BOSS',
    fromTurn: state.turnIndex,
    toTurn: null,
  });
  return { state: { ...state, npcs: [...state.npcs, newBoss], npcAssignments }, replaced: true };
}

/**
 * 입사한 회사·팀의 NPC 구성을 보장한다. 같은 run에서 이미 생성된 활성 팀이 있으면 재사용하고
 * (§8.1, 새로고침/재입사 시 다시 굴리지 않음), 없으면 새로 생성한다. 입력 상태는 변경하지 않는다.
 */
export function ensureCompanyTeam(
  state: GameRunState,
  companyId: string,
  teamId: string,
  content: ContentIndex,
): { state: GameRunState; created: boolean } {
  // 부분 결원(상사 교체 등)의 재배치는 §21.2 교체 규칙 작업에서 처리한다. 여기서는 팀이 있으면 그대로 재사용.
  const existing = activeAssignments(state, companyId, teamId).filter((a) => a.role !== 'FORMER_BOSS');
  if (existing.length > 0) return { state, created: false };
  const playerRank = state.employment.current?.rank ?? 'STAFF';
  const npcs = generateCompanyNpcs(
    { seed: state.seed, companyId, teamId, turnIndex: state.turnIndex, playerRank },
    content,
  );
  const assignments: NpcAssignment[] = npcs.map((npc) => ({
    npcId: npc.npcId,
    companyId,
    teamId,
    role: npc.role,
    fromTurn: state.turnIndex,
    toTurn: null,
  }));
  return {
    state: {
      ...state,
      npcs: [...state.npcs, ...npcs],
      npcAssignments: [...state.npcAssignments, ...assignments],
    },
    created: true,
  };
}
