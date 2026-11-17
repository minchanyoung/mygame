import { describe, expect, it } from 'vitest';
import { NPC_RANKS, PLAYER_RANKS } from '@company-life/shared';
import { ensureCompanyTeam, generateCompanyNpcs } from './npcs';
import { content, employedRun } from './test-fixtures';

const base = {
  seed: 'npc-seed',
  companyId: 'company_junggyeon_tech',
  teamId: 'DEV',
  turnIndex: 0,
  playerRank: 'STAFF' as const,
};

describe('company NPC generation (§8)', () => {
  it('creates exactly 1 boss and 2 peers with ranks above/around the player', () => {
    for (let i = 0; i < 100; i++) {
      const npcs = generateCompanyNpcs({ ...base, seed: `npc-${i}` }, content);
      const boss = npcs.filter((n) => n.role === 'BOSS');
      const peers = npcs.filter((n) => n.role === 'PEER');
      expect(boss).toHaveLength(1);
      expect(peers).toHaveLength(2);
      const bossIdx = NPC_RANKS.indexOf(boss[0]!.rank);
      expect(bossIdx).toBeGreaterThan(PLAYER_RANKS.indexOf('STAFF'));
      for (const p of peers) expect(NPC_RANKS.indexOf(p.rank)).toBeLessThan(bossIdx);
      expect(new Set(npcs.map((n) => n.name)).size).toBe(3);
      expect(new Set(npcs.map((n) => n.npcId)).size).toBe(3);
    }
  });

  it('a department-head player gets an EXECUTIVE boss (§21.2)', () => {
    const [boss] = generateCompanyNpcs({ ...base, playerRank: 'DEPARTMENT_HEAD' }, content);
    expect(boss!.rank).toBe('EXECUTIVE');
  });

  it('is deterministic for run seed + company + team + turn, and changes with any of them', () => {
    expect(generateCompanyNpcs(base, content)).toEqual(generateCompanyNpcs(base, content));
    expect(generateCompanyNpcs(base, content)).not.toEqual(
      generateCompanyNpcs({ ...base, companyId: 'company_pyeongbeom' }, content),
    );
    expect(generateCompanyNpcs(base, content)).not.toEqual(
      generateCompanyNpcs({ ...base, turnIndex: 7 }, content),
    );
    expect(generateCompanyNpcs(base, content)).not.toEqual(
      generateCompanyNpcs({ ...base, stream: 1 }, content),
    );
  });

  it('every company can produce both good and bad bosses and peers (§8.1)', () => {
    for (const company of content.pack.companies) {
      const seen = new Set<string>();
      for (let i = 0; i < 150; i++) {
        for (const npc of generateCompanyNpcs(
          { ...base, seed: `fair-${i}`, companyId: company.id },
          content,
        )) {
          const primary = content.personalities.get(npc.personalityTags[0]!)!;
          seen.add(`${npc.role}:${primary.polarity}`);
        }
      }
      expect([...seen].sort(), company.id).toEqual(['BOSS:BAD', 'BOSS:GOOD', 'PEER:BAD', 'PEER:GOOD']);
    }
  });

  it('reuses the existing team instead of re-rolling, and survives a JSON save/load', () => {
    const s = employedRun();
    const job = s.employment.current!;
    const again = ensureCompanyTeam(s, job.companyId, job.teamId, content);
    expect(again.created).toBe(false);
    expect(again.state.npcs).toEqual(s.npcs);
    const reloaded = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(reloaded.npcs).toEqual(s.npcs);
    expect(reloaded.npcAssignments).toEqual(s.npcAssignments);
  });

  it('starts relations within configured ranges', () => {
    for (const npc of generateCompanyNpcs(base, content)) {
      for (const v of [npc.favor, npc.trust, npc.rivalry, npc.competence, npc.fairness, npc.ambition]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(npc.memoryFlags).toEqual([]);
      expect(npc.active).toBe(true);
    }
  });
});
