import { describe, expect, it } from 'vitest';
import { GameRunStateSchema, type GameRunState } from '@company-life/shared';
import { indexContent } from './content-index';
import { getEligibleEvents, resolveChoice } from './events';
import { startMonth } from './month';
import { rollNpcLife } from './npc-life';
import { currentTeamNpcs } from './npcs';
import { content, employedRun, open, withNpc } from './test-fixtures';
import { toPublicActiveEvent, toPublicView } from './view';

const base: GameRunState = {
  ...employedRun(),
  turnIndex: 24,
  resources: { health: 90, mental: 90, focus: 90, reputation: 70 },
};
const peer = currentTeamNpcs(base).find((t) => t.role === 'PEER')!.npc;
const rivalPeer = withNpc(base, peer.npcId, { personalityTags: ['COMPETITIVE'] });

/** 소식 확률을 1로 올린 콘텐츠 (테스트 전용) */
function contentWith(chance: number) {
  const pack = content.pack;
  return indexContent({
    ...pack,
    rules: { ...pack.rules, npcLife: { ...pack.rules.npcLife, monthlyChance: chance } },
  });
}

describe('S8 연재형 사건', () => {
  it('1화의 참여 동료를 2화가 이어받고, 사건 화면에 "라이벌 동기 2/4화"가 보인다', () => {
    const ep1 = open(rivalPeer, 'evt_arc_rival_1', { participantNpcId: peer.npcId });
    expect(toPublicActiveEvent(ep1, content)?.series).toEqual({ title: '라이벌 동기', episode: 1, total: 4 });
    const after = resolveChoice(ep1, 'split', content).state;
    const sched = after.scheduledEvents.at(-1)!;
    expect(sched).toMatchObject({ eventId: 'evt_arc_rival_2', participantNpcId: peer.npcId, dueTurn: 26 });
    // 협력을 골랐으므로 동료 기억에 'ally' 플래그
    expect(after.flags.some((f) => f.key === 'arc_rival_ally' && f.ownerId === peer.npcId)).toBe(true);

    const month = startMonth({ ...after, phase: 'MONTH_START', turnIndex: 26, activeEvent: null }, content);
    expect(month.activeEvent).toMatchObject({ eventId: 'evt_arc_rival_2', participantNpcId: peer.npcId });
    const view = toPublicActiveEvent(month, content)!;
    expect(view.series).toEqual({ title: '라이벌 동기', episode: 2, total: 4 });
    // ally 플래그가 있으므로 '둘 이름을 같이 올리자' 선택지가 보인다
    expect(view.choices.map((c) => c.id)).toContain('co_sign');
    expect(view.participantName).toBe(peer.name);
  });

  it('연재가 진행 중이면 다른 연재 1화는 후보가 아니다 (동시에 한 편)', () => {
    const ids = (s: GameRunState) => getEligibleEvents(s, content, 'work').map((c) => c.event.id);
    const withBossMentor = withNpc(base, currentTeamNpcs(base).find((t) => t.role === 'BOSS')!.npc.npcId, {
      personalityTags: ['MENTOR'],
    });
    expect(ids(withBossMentor)).toContain('evt_arc_mentor_1');
    const ongoing = resolveChoice(
      open(rivalPeer, 'evt_arc_rival_1', { participantNpcId: peer.npcId }),
      'split',
      content,
    ).state;
    expect(ids({ ...ongoing, npcs: withBossMentor.npcs, phase: 'MONTH_START' })).not.toContain(
      'evt_arc_mentor_1',
    );
  });

  it('참여 동료가 팀을 떠나면 다음 화 대신 정리 화가 열린다', () => {
    const after = resolveChoice(
      open(rivalPeer, 'evt_arc_rival_1', { participantNpcId: peer.npcId }),
      'split',
      content,
    ).state;
    const gone: GameRunState = {
      ...after,
      phase: 'MONTH_START',
      activeEvent: null,
      turnIndex: 26,
      npcs: after.npcs.map((n) => (n.npcId === peer.npcId ? { ...n, active: false } : n)),
      npcAssignments: after.npcAssignments.map((a) => (a.npcId === peer.npcId ? { ...a, toTurn: 25 } : a)),
    };
    const month = startMonth(gone, content);
    expect(month.activeEvent).toMatchObject({
      eventId: 'evt_arc_rival_farewell',
      participantNpcId: peer.npcId,
    });
    expect(toPublicActiveEvent(month, content)!.dialogue[0]!.name).toContain(peer.name);
  });
});

describe('S8 동료의 인생', () => {
  it('시드 고정: 같은 상태면 같은 소식', () => {
    const c = contentWith(1);
    expect(rollNpcLife(base, c).news).toEqual(rollNpcLife(base, c).news);
  });

  it('소식은 한 달에 최대 2건, 퇴사하면 같은 역할의 새 사람이 들어오고 떠난 사람은 기억에 남는다', () => {
    const c = contentWith(1);
    for (let t = 24; t < 60; t++) {
      const s = { ...base, turnIndex: t };
      const { state, news } = rollNpcLife(s, c);
      expect(news.filter((n) => n.kind !== 'JOINED').length).toBeLessThanOrEqual(2);
      const team = currentTeamNpcs(state);
      expect(team.filter((x) => x.role === 'BOSS')).toHaveLength(1);
      expect(team.filter((x) => x.role === 'PEER')).toHaveLength(2);
      const left = news.find((n) => n.kind === 'LEAVE' || n.kind === 'LAID_OFF');
      if (left) {
        expect(state.npcs.find((n) => n.npcId === left.npcId)?.active).toBe(false);
        expect(news.some((n) => n.kind === 'JOINED')).toBe(true);
        expect(GameRunStateSchema.safeParse(state).success).toBe(true);
        const view = toPublicView(state, c);
        expect(view.formerColleagues.some((p) => p.note === '회사를 떠남')).toBe(true);
        return;
      }
    }
    throw new Error('36개월 동안 퇴사 소식이 한 번도 없음');
  });

  it('결혼 소식은 그달 일상 칸에 축의금 사건을 그 동료와 함께 연다', () => {
    const c = contentWith(1);
    for (let t = 24; t < 60; t++) {
      const { state, news } = rollNpcLife({ ...base, turnIndex: t }, c);
      const wed = news.find((n) => n.kind === 'MARRIAGE');
      if (!wed) continue;
      expect(state.scheduledEvents.at(-1)).toMatchObject({
        eventId: 'evt_news_wedding_gift',
        participantNpcId: wed.npcId,
        dueTurn: t,
      });
      return;
    }
    throw new Error('결혼 소식이 없음');
  });

  it('결산에 사내 소식이 보이고, 인생 기록에도 남는다', () => {
    const c = contentWith(1);
    const month = startMonth({ ...base, phase: 'MONTH_START' }, c);
    const news = month.currentMonth!.news;
    expect(news.length).toBeGreaterThan(0);
    expect(month.eventHistory.some((h) => h.kind === 'NEWS')).toBe(true);
  });
});
