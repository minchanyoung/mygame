/**
 * 자동 플레이 분포 리포트 (§13.3). 사용: npm run simulate -w @company-life/game-engine -- [runs]
 * 밸런스 판단용 개발 도구이며 서버에서 쓰지 않는다.
 */
import { loadContentPack } from '@company-life/content';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  JOB_IDS,
  JOB_LABELS,
  RANK_LABELS,
  type Difficulty,
} from '@company-life/shared';
import { indexContent } from './content-index';
import { autoPlay, type AutoPlayPolicy } from './simulation';

// 엔진 패키지는 Node/DOM 타입에 의존하지 않으므로 process·console을 좁게 참조한다
const host = globalThis as unknown as {
  process?: { argv: string[] };
  console: { log: (...args: unknown[]) => void };
};
const argv = host.process?.argv ?? [];
const console = host.console;
const runs = Number(argv[2] ?? 1000);
/** 상세 리포트를 낼 난이도 (기본 보통). 마지막에 세 난이도 요약을 함께 낸다 */
const difficulty = (argv[3] ?? 'NORMAL') as Difficulty;
const content = indexContent(loadContentPack());

/**
 * 밸런스 목표 (봇별). 무작위 봇은 아무렇게나 해도 이 정도로 실패, 신중 봇은 정확한 확률을 아는 상한선.
 * 난이도 요약의 목표는 신중 봇 기준이다.
 */
const TARGET = {
  failureRate: { random: { min: 0.3, max: 0.4 }, cautious: { min: 0.1, max: 0.25 } },
  /** 실패 원인 한 가지가 전체 판에서 차지하는 최대 비율 (엔딩 다양성) */
  maxSingleFailureCause: 0.15,
};
const mark = (ok: boolean) => (ok ? '✅' : '❌');

for (const policy of ['random', 'cautious'] as AutoPlayPolicy[]) {
  const results = Array.from({ length: runs }, (_, i) =>
    autoPlay(`sim-${i}`, policy, content, undefined, difficulty),
  );
  const stuck = results.filter((r) => r.stuck);
  const failures = results.filter((r) => r.category === 'FAILURE');
  const byType = new Map<string, number>();
  for (const r of results)
    byType.set(r.endingType ?? 'STUCK', (byType.get(r.endingType ?? 'STUCK') ?? 0) + 1);
  const ages = results
    .filter((r) => r.age !== null)
    .map((r) => r.age as number)
    .sort((a, b) => a - b);
  const q = (p: number) => ages[Math.min(ages.length - 1, Math.floor(p * ages.length))] ?? '-';
  const pct = (n: number) => `${((n / runs) * 100).toFixed(1)}%`;

  const failRate = failures.length / runs;
  const target = TARGET.failureRate[policy];
  const failByCause = new Map<string, number>();
  for (const r of failures)
    failByCause.set(r.endingType ?? '?', (failByCause.get(r.endingType ?? '?') ?? 0) + 1);
  const topCause = [...failByCause.entries()].sort((a, b) => b[1] - a[1])[0];
  const topShare = topCause ? topCause[1] / runs : 0;

  console.log(`\n=== policy: ${policy} · ${DIFFICULTY_LABELS[difficulty]} (${runs} runs) ===`);
  console.log(
    `${mark(stuck.length === 0)} 진행 불능: ${stuck.length}건${stuck[0] ? ` (예: ${stuck[0].seed} ${stuck[0].stuck})` : ''}`,
  );
  console.log(
    `${mark(failRate >= target.min && failRate <= target.max)} 50세 전 실패 엔딩: ${pct(failures.length)} (목표 ${target.min * 100}~${target.max * 100}%)`,
  );
  console.log(
    `${mark(topShare <= TARGET.maxSingleFailureCause)} 최다 실패 원인: ${topCause?.[0] ?? '-'} ${pct(topCause?.[1] ?? 0)} (목표 ≤${TARGET.maxSingleFailureCause * 100}%)`,
  );
  console.log(`엔딩 나이 분위수: p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)}`);
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(20)} ${String(n).padStart(5)}  ${pct(n)}`);
  }

  // S5 승진: 정상 엔딩(50세 이상까지 근무)한 판의 최종 직급 분포, 첫 승진 나이
  const normal = results.filter((r) => r.category === 'NORMAL');
  const share = (n: number) => `${normal.length ? ((n / normal.length) * 100).toFixed(1) : '0'}%`;
  const rankCount = new Map<string, number>();
  for (const r of normal) rankCount.set(r.highestRank ?? '-', (rankCount.get(r.highestRank ?? '-') ?? 0) + 1);
  const head = rankCount.get('DEPARTMENT_HEAD') ?? 0;
  console.log(
    `${mark(head / Math.max(1, normal.length) >= 0.25 && head / Math.max(1, normal.length) <= 0.4)} 정상 엔딩 중 부장 도달: ${share(head)} (목표 25~40%, 신중 봇 기준)`,
  );
  console.log(
    `  최종 직급: ${['STAFF', 'ASSISTANT_MANAGER', 'MANAGER', 'DEPUTY_HEAD', 'DEPARTMENT_HEAD']
      .map((k) => `${RANK_LABELS[k as keyof typeof RANK_LABELS]} ${share(rankCount.get(k) ?? 0)}`)
      .join(' · ')}`,
  );
  const promoAges = results
    .filter((r) => r.firstPromotionAge !== null)
    .map((r) => r.firstPromotionAge as number)
    .sort((a, b) => a - b);
  const median = promoAges[Math.floor(promoAges.length / 2)] ?? '-';
  console.log(`  첫 승진 나이 중앙값: ${median}세 (목표 27~28세), 승진 경험 ${pct(promoAges.length)}`);

  // S5 인생 목표 달성률 (목표별, 전체 판 기준. 목표 20~45%)
  const byGoal = new Map<string, { n: number; ok: number }>();
  for (const r of results) {
    if (!r.goalId) continue;
    const g = byGoal.get(r.goalId) ?? { n: 0, ok: 0 };
    g.n++;
    if (r.goalAchieved) g.ok++;
    byGoal.set(r.goalId, g);
  }
  const dist = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
    return `p25=${at(0.25)} p50=${at(0.5)} p75=${at(0.75)}`;
  };
  const eok = (n: number) => Math.round(n / 10_000_000) / 10;
  console.log(
    `  정상 엔딩 순자산(억): ${dist(normal.map((r) => eok(r.finalCash - r.finalDebt)))} · 체력·정신력 최소: ${dist(normal.map((r) => r.finalWellbeing))} · S등급 횟수: ${dist(normal.map((r) => r.sGrades))}`,
  );
  // S7 이직·50대·노후
  const moved = results.filter((r) => r.transfers > 0).length;
  const exec = results.filter((r) => r.endingType === 'EXECUTIVE_PROMOTION').length;
  const tiers = ['COMFORTABLE', 'MODEST', 'TIGHT'].map(
    (k) => `${k} ${share(normal.filter((r) => r.retirementTier === k).length)}`,
  );
  console.log(`  이직 경험 ${pct(moved)} · 별을 달다(임원) ${pct(exec)} · 노후 등급: ${tiers.join(' / ')}`);
  // S8 동료의 인생·연재
  const years = results.reduce((s, r) => s + r.months / 12, 0);
  const newsPerYear = results.reduce((s, r) => s + r.news, 0) / Math.max(1, years);
  const started = results.reduce((s, r) => s + r.seriesStarted, 0);
  const finished = results.reduce((s, r) => s + r.seriesFinished, 0);
  console.log(
    `  ${mark(newsPerYear >= 1 && newsPerYear <= 2)} 사내 소식 연 ${newsPerYear.toFixed(2)}건 (목표 1~2) · 연재 시작 판당 ${(started / runs).toFixed(2)}편, 완결률 ${started ? ((finished / started) * 100).toFixed(0) : 0}%`,
  );
  // S12 직무 연재: 직무별 시작률(1화)·완결률·시작 시점. S13 직무별 실패율·부장 도달은 평균 ±10%p 목표
  const jobRows = JOB_IDS.map((job) => {
    const rs = results.filter((r) => r.jobId === job);
    const started = rs.filter((r) => r.jobSeriesStartTurn !== null);
    const turns = started.map((r) => r.jobSeriesStartTurn as number).sort((a, b) => a - b);
    const alive = rs.filter((r) => r.months >= 48);
    const startedBy4 = alive.filter((r) => r.jobSeriesStartTurn !== null && r.jobSeriesStartTurn < 48);
    const normalJ = rs.filter((r) => r.category === 'NORMAL');
    return {
      job,
      n: rs.length,
      startRate: started.length / Math.max(1, rs.length),
      by4: startedBy4.length / Math.max(1, alive.length),
      finished: rs.filter((r) => r.jobSeriesFinished).length / Math.max(1, started.length),
      medianYear: turns.length ? Math.floor((turns[Math.floor(turns.length / 2)] ?? 0) / 12) + 1 : null,
      fail: rs.filter((r) => r.category === 'FAILURE').length / Math.max(1, rs.length),
      head: normalJ.filter((r) => r.highestRank === 'DEPARTMENT_HEAD').length / Math.max(1, normalJ.length),
    };
  });
  const spread = (k: 'fail' | 'head') =>
    Math.max(...jobRows.map((j) => j[k])) - Math.min(...jobRows.map((j) => j[k]));
  /** S13 직무 평균에서 가장 먼 직무까지의 거리 */
  const offMean = (k: 'fail' | 'head') => {
    const mean = jobRows.reduce((s, j) => s + j[k], 0) / jobRows.length;
    return Math.max(...jobRows.map((j) => Math.abs(j[k] - mean)));
  };
  console.log(
    `  직무 연재 (4년 차까지 시작 / 완결 / 시작 중앙 연차): ${jobRows
      .map(
        (j) =>
          `${JOB_LABELS[j.job]} ${(j.by4 * 100).toFixed(0)}%/${(j.finished * 100).toFixed(0)}%/${j.medianYear ?? '-'}년`,
      )
      .join(' · ')}`,
  );
  console.log(
    `  ${mark(offMean('fail') <= 0.1)} 직무별 실패율 ${jobRows.map((j) => `${JOB_LABELS[j.job]} ${(j.fail * 100).toFixed(0)}%`).join(' · ')} (평균에서 최대 ${(offMean('fail') * 100).toFixed(0)}%p, 목표 ±10 · 차이 ${(spread('fail') * 100).toFixed(0)}%p, 표본 직무당 ~${Math.round(runs / 5)}판)`,
  );
  console.log(
    `  ${mark(offMean('head') <= 0.1)} 직무별 부장 도달 ${jobRows.map((j) => `${JOB_LABELS[j.job]} ${(j.head * 100).toFixed(0)}%`).join(' · ')} (평균에서 최대 ${(offMean('head') * 100).toFixed(0)}%p, 목표 ±10)`,
  );
  // S9 별명: 기본 별명 비율(목표 10% 이하), 별명별 대표·획득 비율
  const defaults = results.filter((r) => r.titles[0] === 'title_default').length;
  console.log(`  ${mark(defaults / runs <= 0.1)} 기본 별명만 받은 판 ${pct(defaults)} (목표 10% 이하)`);
  const titleIds = new Set(results.flatMap((r) => r.titles));
  const titleRows = [...titleIds]
    .map((id) => ({
      id,
      main: results.filter((r) => r.titles[0] === id).length,
      any: results.filter((r) => r.titles.includes(id)).length,
    }))
    .sort((a, b) => b.any - a.any);
  console.log(
    `  별명 (대표 / 획득): ${titleRows.map((t) => `${t.id.replace('title_', '')} ${share(t.main)}/${share(t.any)}`).join(' · ')}`,
  );
  console.log('  인생 목표 달성률 (목표 20~45%):');
  for (const [id, g] of [...byGoal.entries()].sort()) {
    const rate = g.ok / g.n;
    console.log(
      `    ${mark(rate >= 0.2 && rate <= 0.45)} ${id.padEnd(24)} ${(rate * 100).toFixed(1)}% (${g.ok}/${g.n})`,
    );
  }
}

// S10 난이도 요약: 50세 전 실패율. 목표는 신중 봇 기준, 무작위는 참고
const DIFFICULTY_TARGET: Record<Difficulty, { min: number; max: number }> = {
  EASY: { min: 0.03, max: 0.08 },
  NORMAL: { min: 0.1, max: 0.25 },
  REAL: { min: 0.4, max: 0.55 },
};
console.log('\n=== 난이도 요약 (50세 전 실패율: 신중 [목표] · 무작위) ===');
for (const d of DIFFICULTIES) {
  const row = (['cautious', 'random'] as const).map((policy) => {
    const rs = Array.from({ length: runs }, (_, i) => autoPlay(`sim-${i}`, policy, content, undefined, d));
    const fail = rs.filter((r) => r.category === 'FAILURE').length / runs;
    const normal = rs.filter((r) => r.category === 'NORMAL');
    const retired = normal.filter((r) => r.endingType === 'RETIREMENT').length / Math.max(1, normal.length);
    const avgAge = rs.reduce((s, r) => s + (r.age ?? 0), 0) / runs;
    const stuck = rs.filter((r) => r.stuck).length;
    return { fail, retired, avgAge, stuck };
  });
  const t = DIFFICULTY_TARGET[d];
  const [c, r] = [row[0]!, row[1]!];
  console.log(
    `  ${mark(c.fail >= t.min && c.fail <= t.max)} ${DIFFICULTY_LABELS[d]}: 신중 ${(c.fail * 100).toFixed(1)}% (목표 ${Math.round(t.min * 100)}~${Math.round(t.max * 100)}%) · 정년 ${(c.retired * 100).toFixed(0)}% · ${c.avgAge.toFixed(1)}세 | 무작위 ${(r.fail * 100).toFixed(1)}% · ${r.avgAge.toFixed(1)}세 · 진행 불능 ${c.stuck + r.stuck}`,
  );
}
