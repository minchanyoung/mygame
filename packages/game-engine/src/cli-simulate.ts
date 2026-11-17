/**
 * 자동 플레이 분포 리포트 (§13.3). 사용: npm run simulate -w @company-life/game-engine -- [runs]
 * 밸런스 판단용 개발 도구이며 서버에서 쓰지 않는다.
 */
import { loadContentPack } from '@company-life/content';
import { RANK_LABELS } from '@company-life/shared';
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
const content = indexContent(loadContentPack());

/** 밸런스 목표 (S1 임시안 — 사용자 검수로 확정) */
const TARGET = {
  failureRate: { min: 0.3, max: 0.4 },
  /** 실패 원인 한 가지가 전체 판에서 차지하는 최대 비율 (엔딩 다양성) */
  maxSingleFailureCause: 0.15,
};
const mark = (ok: boolean) => (ok ? '✅' : '❌');

for (const policy of ['random', 'cautious'] as AutoPlayPolicy[]) {
  const results = Array.from({ length: runs }, (_, i) => autoPlay(`sim-${i}`, policy, content));
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
  const failByCause = new Map<string, number>();
  for (const r of failures)
    failByCause.set(r.endingType ?? '?', (failByCause.get(r.endingType ?? '?') ?? 0) + 1);
  const topCause = [...failByCause.entries()].sort((a, b) => b[1] - a[1])[0];
  const topShare = topCause ? topCause[1] / runs : 0;

  console.log(`\n=== policy: ${policy} (${runs} runs) ===`);
  console.log(
    `${mark(stuck.length === 0)} 진행 불능: ${stuck.length}건${stuck[0] ? ` (예: ${stuck[0].seed} ${stuck[0].stuck})` : ''}`,
  );
  console.log(
    `${mark(failRate >= TARGET.failureRate.min && failRate <= TARGET.failureRate.max)} 50세 전 실패 엔딩: ${pct(failures.length)} (목표 ${TARGET.failureRate.min * 100}~${TARGET.failureRate.max * 100}%)`,
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
  console.log('  인생 목표 달성률 (목표 20~45%):');
  for (const [id, g] of [...byGoal.entries()].sort()) {
    const rate = g.ok / g.n;
    console.log(
      `    ${mark(rate >= 0.2 && rate <= 0.45)} ${id.padEnd(24)} ${(rate * 100).toFixed(1)}% (${g.ok}/${g.n})`,
    );
  }
}
