import { turnInfo, type GameRunState } from '@company-life/shared';
import type { ContentIndex } from './content-index';
import { rankIndex } from './promotion';

/**
 * S21 오늘의 출근: 같은 날 모두 같은 시드(카드·동료·사건 추첨 흐름)로 한 판.
 * 점수는 엔딩 뒤에만 매기며, 항목별로 보여 줄 수 있게 나눠 둔다.
 */
export const DAILY_SEED_PREFIX = 'daily-';

/** 한국 시간 기준 날짜 (YYYY-MM-DD). 서버 시계로만 정한다 */
export function dailyDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function dailySeed(date: string): string {
  return `${DAILY_SEED_PREFIX}${date}`;
}

export interface DailyScore {
  total: number;
  parts: { label: string; points: number }[];
}

const NET_WORTH_UNIT = 10_000_000; // 1천만 원 = 1점
const NET_WORTH_CAP = 300;

export function dailyScore(state: GameRunState, content: ContentIndex): DailyScore | null {
  const ending = state.ending;
  if (!ending) return null;
  const years = turnInfo(state.turnIndex, content.pack.rules.startAge).age - content.pack.rules.startAge;
  const rank = state.statistics.highestRank;
  const netWorth = state.cash - state.debt;
  const parts = [
    { label: '버틴 햇수', points: years * 10 },
    { label: '최고 직급', points: rank ? rankIndex(rank) * 80 : 0 },
    {
      label: '순자산',
      points: Math.max(0, Math.min(NET_WORTH_CAP, Math.floor(netWorth / NET_WORTH_UNIT))),
    },
    {
      label: ending.category === 'NORMAL' ? '정상 엔딩' : '실패 엔딩',
      points: ending.category === 'NORMAL' ? 200 : 0,
    },
    { label: '별을 달다', points: ending.type === 'EXECUTIVE_PROMOTION' ? 200 : 0 },
    { label: '인생 목표 달성', points: ending.goal?.achieved ? 100 : 0 },
  ].filter((p) => p.points > 0);
  return { total: parts.reduce((s, p) => s + p.points, 0), parts };
}
