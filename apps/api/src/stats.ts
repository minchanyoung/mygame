import type { ContentIndex } from '@company-life/game-engine';
import type { GameRunState } from '@company-life/shared';
import type { RunSummaryRecord } from './store';

/** E4 끝난 판의 요약 (플레이테스트로 조작된 판은 부르는 쪽에서 뺀다) */
export function summarizeRun(state: GameRunState, at: string): RunSummaryRecord | null {
  const ending = state.ending;
  if (!ending) return null;
  return {
    runId: state.runId,
    at,
    contentVersion: state.contentVersion,
    difficulty: state.difficulty,
    daily: !!state.daily,
    // 실직 엔딩도 엔딩 확정 때까지 직장 정보가 남아 있다 (S1 §26)
    jobId: state.employment.current?.jobId ?? null,
    endingType: ending.type,
    category: ending.category,
    age: ending.age,
    highestRank: state.statistics.highestRank,
    choices: state.eventOccurrences.map(
      (o) => `${o.eventId}:${o.choiceId}:${o.success === null ? '-' : o.success ? 'S' : 'F'}`,
    ),
  };
}

/** 시뮬레이션 리포트와 같은 기준 (DESIGN_S13 §8, S16 이후) */
const FAIL_TARGET: Record<string, string> = { EASY: '3~8%', NORMAL: '10~25%', REAL: '40~55%' };
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export interface PlayStats {
  runs: number;
  byDifficulty: {
    difficulty: string;
    runs: number;
    failBefore50Percent: number | null;
    botTarget: string;
    headAmongNormalPercent: number | null;
  }[];
  byJob: { jobId: string; runs: number; failBefore50Percent: number | null }[];
  endings: { type: string; count: number }[];
  /** 사람이 한쪽으로 몰아 고른 사건 (10번 이상 열린 사건 중 가장 많이 고른 선택의 비율 순) */
  skewedChoices: { eventId: string; title: string; picks: number; top: string; topSharePercent: number }[];
}

export function buildPlayStats(records: RunSummaryRecord[], content: ContentIndex): PlayStats {
  const failed = (r: RunSummaryRecord) => r.category === 'FAILURE' && r.age < 50;
  const group = <K extends string>(key: (r: RunSummaryRecord) => K | null) => {
    const m = new Map<K, RunSummaryRecord[]>();
    for (const r of records) {
      const k = key(r);
      if (k !== null) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const byDifficulty = [...group((r) => r.difficulty)].map(([difficulty, rs]) => {
    const normal = rs.filter((r) => r.category === 'NORMAL');
    return {
      difficulty,
      runs: rs.length,
      failBefore50Percent: pct(rs.filter(failed).length, rs.length),
      botTarget: FAIL_TARGET[difficulty] ?? '-',
      headAmongNormalPercent: pct(
        normal.filter((r) => r.highestRank === 'DEPARTMENT_HEAD').length,
        normal.length,
      ),
    };
  });
  const byJob = [...group((r) => r.jobId)].map(([jobId, rs]) => ({
    jobId,
    runs: rs.length,
    failBefore50Percent: pct(rs.filter(failed).length, rs.length),
  }));
  const endings = [...group((r) => r.endingType)]
    .map(([type, rs]) => ({ type, count: rs.length }))
    .sort((a, b) => b.count - a.count);

  const picks = new Map<string, Map<string, number>>();
  for (const r of records) {
    for (const c of r.choices) {
      const [eventId, choiceId] = c.split(':') as [string, string];
      const m = picks.get(eventId) ?? new Map<string, number>();
      m.set(choiceId, (m.get(choiceId) ?? 0) + 1);
      picks.set(eventId, m);
    }
  }
  const skewedChoices = [...picks]
    .map(([eventId, m]) => {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0]!;
      const ev = content.events.get(eventId);
      return {
        eventId,
        title: ev?.title ?? eventId,
        picks: total,
        top: ev?.choices.find((c) => c.id === top)?.label ?? top,
        topSharePercent: pct(n, total) ?? 0,
        choiceCount: ev?.choices.length ?? 1,
      };
    })
    .filter((x) => x.picks >= 10 && x.choiceCount > 1)
    .sort((a, b) => b.topSharePercent - a.topSharePercent || b.picks - a.picks)
    .slice(0, 15)
    .map(({ choiceCount: _c, ...rest }) => rest);

  return { runs: records.length, byDifficulty, byJob, endings, skewedChoices };
}
