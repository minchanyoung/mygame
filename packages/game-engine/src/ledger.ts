import {
  RESOURCE_KEYS,
  type GameRunState,
  type ResourceLedgerEntry,
  type ReviewDetail,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';

/**
 * S14 자원 증감 장부.
 * 달이 끝날 때(nextMonth) 이번 달 기록(currentMonth)을 사건·평가·승진 누락·나머지(자연 변화)로 나눠 옮긴다.
 * 나머지 = 달 전체 변화 − 앞의 항목들이라, 한 달 줄들의 합은 늘 그달 전체 변화와 같다.
 */

/** 장부 보관 기간 (평가표가 1년 치를 쓴다) */
export const LEDGER_KEEP_MONTHS = 12;

type Delta = ResourceLedgerEntry['delta'];

function compact(delta: Partial<Record<(typeof RESOURCE_KEYS)[number], number>>): Delta {
  const out: Delta = {};
  for (const k of RESOURCE_KEYS) {
    const v = delta[k] ?? 0;
    if (v !== 0) out[k] = v;
  }
  return out;
}

export function monthLedgerEntries(state: GameRunState, content: ContentIndex): ResourceLedgerEntry[] {
  const m = state.currentMonth;
  if (!m) return [];
  const turnIndex = m.turnIndex;
  const entries: ResourceLedgerEntry[] = [];
  const explained: Record<string, number> = {};
  const push = (e: Omit<ResourceLedgerEntry, 'turnIndex'>) => {
    if (Object.keys(e.delta).length === 0) return;
    entries.push({ turnIndex, ...e });
    for (const [k, v] of Object.entries(e.delta)) explained[k] = (explained[k] ?? 0) + (v ?? 0);
  };

  if (m.promotion && !m.promotion.success) {
    const pen = content.pack.rules.promotion.missPenalty;
    push({
      source: 'PROMOTION_MISS',
      eventId: null,
      choiceId: null,
      delta: compact({ mental: -pen.mental, reputation: -pen.reputation }),
    });
  }
  if (m.annualReview) {
    push({
      source: 'REVIEW',
      eventId: null,
      choiceId: null,
      delta: compact({ reputation: m.annualReview.reputationDelta }),
    });
  }
  for (const r of m.eventResults) {
    push({
      source: 'EVENT',
      eventId: r.eventId,
      choiceId: r.choiceId,
      delta: compact(r.resourceDelta as Record<string, number>),
    });
  }
  const rest: Record<string, number> = {};
  for (const k of RESOURCE_KEYS) rest[k] = state.resources[k] - m.start.resources[k] - (explained[k] ?? 0);
  push({ source: 'MONTHLY', eventId: null, choiceId: null, delta: compact(rest) });
  return entries;
}

/** 이번 달 기록을 장부에 더하고 오래된 줄을 버린다 */
export function closeMonthLedger(state: GameRunState, content: ContentIndex): GameRunState['resourceLedger'] {
  const added = monthLedgerEntries(state, content);
  const from = state.turnIndex - LEDGER_KEEP_MONTHS + 1;
  return [...state.resourceLedger, ...added].filter((e) => e.turnIndex >= from);
}

/**
 * S14 평가표 '올해 평판이 움직인 곳': 그해(12월 평가 직전까지) 사건의 평판 변화를 선택별로 묶어
 * 깎인 곳 TOP 3 → 오른 곳 TOP 1.
 */
export function reputationSources(state: GameRunState): ReviewDetail['reputationSources'] {
  const year = Math.floor(state.turnIndex / 12);
  const byChoice = new Map<string, { eventId: string; choiceId: string; delta: number; count: number }>();
  for (const e of state.resourceLedger) {
    if (e.source !== 'EVENT' || !e.eventId || !e.choiceId) continue;
    if (Math.floor(e.turnIndex / 12) !== year) continue;
    const d = e.delta.reputation ?? 0;
    if (d === 0) continue;
    const key = `${e.eventId}:${e.choiceId}`;
    const row = byChoice.get(key) ?? { eventId: e.eventId, choiceId: e.choiceId, delta: 0, count: 0 };
    row.delta += d;
    row.count += 1;
    byChoice.set(key, row);
  }
  const rows = [...byChoice.values()];
  const lost = rows
    .filter((r) => r.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);
  const gained = rows
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 1);
  return [...lost, ...gained];
}
