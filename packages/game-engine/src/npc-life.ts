import {
  NPC_RANKS,
  RANK_LABELS,
  type GameRunState,
  type NewsItem,
  type Npc,
  type NpcAssignment,
  type NpcRank,
  type ScheduledEvent,
} from '@company-life/shared';
import { requireFrom, type ContentIndex } from './content-index';
import { clampStat } from './numbers';
import { currentTeamNpcs, generateCompanyNpcs } from './npcs';
import { SeededRng } from './rng';

/**
 * S8 동료의 인생. 매달 정산 뒤, 팀원(상사 1 + 동료 2) 각자에게 작은 확률로 인생 소식이 생긴다 (시드 고정).
 * 결혼 → 축의금 사건, 퇴사(친했던 사람) → 송별회, 동료가 나보다 높아지는 승진 → 감정 사건을 그달 예약한다.
 * 떠난 사람은 지우지 않고 비활성으로 남기며(§21.2 기억 보존), 같은 역할의 새 사람이 충원된다.
 */

export const MARRIED_FLAG = 'life_married';
type Kind = NewsItem['kind'];

const rankIdx = (r: NpcRank) => NPC_RANKS.indexOf(r);

function pickKind(npc: Npc, state: GameRunState, rng: SeededRng, content: ContentIndex): Kind {
  const job = state.employment.current!;
  const company = requireFrom(content.companies, job.companyId, 'company');
  const married = npc.memoryFlags.includes(MARRIED_FLAG);
  const lowGrade = company.grade === 'D' || company.grade === 'F';
  const options: Array<[Kind, number]> = [
    ['MARRIAGE', married ? 0 : 2],
    ['BABY', married ? 1.2 : 0],
    ['PROMOTION', npc.rank === 'EXECUTIVE' ? 0 : 0.5 + npc.ambition / 100],
    ['LEAVE', 0.4 + npc.ambition / 150 + (lowGrade ? 0.6 : 0)],
    ['LAID_OFF', company.financialHealth < 50 ? 0.8 : 0.15],
    ['SICK', company.cultureTags.includes('overtime') ? 0.8 : 0.3],
  ];
  // RNG는 정수 가중치만 받으므로 100배해 반올림
  return options[rng.weightedIndex(options.map(([, w]) => Math.round(w * 100)))]![0];
}

/** 떠난 사람의 자리에 같은 역할의 새 사람을 들인다 */
function replaceNpc(
  state: GameRunState,
  leaving: Npc,
  role: 'BOSS' | 'PEER',
  stream: number,
  content: ContentIndex,
): { state: GameRunState; joined: Npc | null } {
  const job = state.employment.current!;
  const generated = generateCompanyNpcs(
    {
      seed: state.seed,
      companyId: job.companyId,
      teamId: job.teamId,
      turnIndex: state.turnIndex,
      playerRank: job.rank,
      stream,
    },
    content,
  );
  const joined = generated.find((n) => n.role === role) ?? null;
  const npcAssignments = state.npcAssignments.map((a): NpcAssignment =>
    a.npcId === leaving.npcId && a.toTurn === null ? { ...a, toTurn: state.turnIndex } : a,
  );
  const npcs = state.npcs.map((n) => (n.npcId === leaving.npcId ? { ...n, active: false } : n));
  if (!joined) return { state: { ...state, npcs, npcAssignments }, joined: null };
  return {
    joined,
    state: {
      ...state,
      npcs: [...npcs, joined],
      npcAssignments: [
        ...npcAssignments,
        {
          npcId: joined.npcId,
          companyId: job.companyId,
          teamId: job.teamId,
          role,
          fromTurn: state.turnIndex,
          toTurn: null,
        },
      ],
    },
  };
}

function schedule(eventId: string, npcId: string, turn: number): ScheduledEvent {
  return {
    scheduleId: `news_${npcId}_t${turn}_${eventId}`,
    eventId,
    dueTurn: turn,
    priority: 5,
    sourceOccurrenceId: null,
    participantNpcId: npcId,
    status: 'PENDING',
  };
}

/** 월 시작(정산 뒤·사건 선정 전)에 호출. 소식과 바뀐 상태를 돌려준다. */
export function rollNpcLife(
  state: GameRunState,
  content: ContentIndex,
): { state: GameRunState; news: NewsItem[] } {
  const job = state.employment.current;
  if (!job || state.employment.status !== 'EMPLOYED') return { state, news: [] };
  const cfg = content.pack.rules.npcLife;
  const news: NewsItem[] = [];
  let s = state;

  currentTeamNpcs(state).forEach(({ npc, role }, i) => {
    if (news.length >= cfg.maxNewsPerMonth) return;
    const rng = SeededRng.derive(state.seed, 'npcLife', state.turnIndex, npc.npcId);
    if (rng.nextFloat() >= cfg.monthlyChance) return;
    const current = s.npcs.find((n) => n.npcId === npc.npcId)!;
    const who = `${current.name} ${RANK_LABELS[current.rank]}`;
    const kind = pickKind(current, s, rng, content);

    switch (kind) {
      case 'MARRIAGE':
        s = {
          ...s,
          npcs: s.npcs.map((n) =>
            n.npcId === npc.npcId ? { ...n, memoryFlags: [...n.memoryFlags, MARRIED_FLAG] } : n,
          ),
          scheduledEvents: [...s.scheduledEvents, schedule(cfg.followUps.wedding, npc.npcId, s.turnIndex)],
        };
        news.push({ kind, npcId: npc.npcId, text: `💍 ${who}님이 다음 달 결혼합니다! 청첩장이 돌았어요.` });
        break;
      case 'BABY':
        s = {
          ...s,
          resources: { ...s.resources, focus: clampStat(s.resources.focus + cfg.impact.babyFocus) },
        };
        news.push({
          kind,
          npcId: npc.npcId,
          text: `👶 ${who}님이 아빠·엄마가 됐어요. 육아휴직 동안 업무를 나눠 맡습니다.`,
        });
        break;
      case 'SICK':
        s = {
          ...s,
          resources: { ...s.resources, focus: clampStat(s.resources.focus + cfg.impact.sickFocus) },
        };
        news.push({ kind, npcId: npc.npcId, text: `🏥 ${who}님이 과로로 병가를 냈어요. 일이 늘었습니다.` });
        break;
      case 'PROMOTION': {
        const next = NPC_RANKS[Math.min(rankIdx(current.rank) + 1, NPC_RANKS.length - 1)] as NpcRank;
        s = { ...s, npcs: s.npcs.map((n) => (n.npcId === npc.npcId ? { ...n, rank: next } : n)) };
        news.push({
          kind,
          npcId: npc.npcId,
          text: `🎉 ${current.name}님이 ${RANK_LABELS[next]}(으)로 승진했어요.`,
        });
        // 동료가 나를 앞질렀다
        if (
          role === 'PEER' &&
          rankIdx(next) > rankIdx(job.rank) &&
          rankIdx(current.rank) <= rankIdx(job.rank)
        ) {
          s = {
            ...s,
            scheduledEvents: [
              ...s.scheduledEvents,
              schedule(cfg.followUps.peerPromoted, npc.npcId, s.turnIndex),
            ],
          };
        }
        break;
      }
      case 'LEAVE':
      case 'LAID_OFF': {
        const friendly = current.favor >= cfg.friendlyFavor;
        const replaced = replaceNpc(s, current, role, 100 + s.turnIndex * 3 + i, content);
        s = replaced.state;
        news.push({
          kind,
          npcId: npc.npcId,
          text:
            kind === 'LEAVE'
              ? `🚪 ${who}님이 이직으로 회사를 떠납니다.`
              : `📉 ${who}님이 권고사직 대상이 됐어요. 사무실이 조용합니다.`,
        });
        if (kind === 'LAID_OFF') {
          s = {
            ...s,
            resources: { ...s.resources, mental: clampStat(s.resources.mental + cfg.impact.laidOffMental) },
          };
        }
        if (kind === 'LEAVE' && friendly) {
          s = {
            ...s,
            scheduledEvents: [...s.scheduledEvents, schedule(cfg.followUps.farewell, npc.npcId, s.turnIndex)],
          };
        }
        if (replaced.joined) {
          const j = replaced.joined;
          news.push({
            kind: 'JOINED',
            npcId: j.npcId,
            text: `👋 새 ${role === 'BOSS' ? '팀장' : '동료'} ${j.name} ${RANK_LABELS[j.rank]}님이 합류했어요.`,
          });
        }
        break;
      }
      default:
        break;
    }
  });
  // 인생 기록에도 남긴다 (사람 탭·연대기)
  if (news.length > 0) {
    s = {
      ...s,
      eventHistory: [
        ...s.eventHistory,
        ...news.map((n) => ({
          turnIndex: s.turnIndex,
          kind: 'NEWS' as const,
          summary: n.text,
          data: { kind: n.kind, npcId: n.npcId },
        })),
      ],
    };
  }
  return { state: s, news };
}
