/**
 * E4 사람 플레이 통계 리포트. 사용: npm run stats (로컬 .data/stats/runs.jsonl을 읽는다)
 * 시뮬레이션 봇 목표와 나란히 보기 위한 개발 도구.
 */
import path from 'node:path';
import { loadContentPack } from '@company-life/content';
import { indexContent } from '@company-life/game-engine';
import { buildPlayStats } from './stats';
import { FileStatsStore } from './store';

const dir = path.resolve(process.env['STATS_STORE_DIR'] ?? 'apps/api/.data/stats');
const records = await new FileStatsStore(dir).all();
const s = buildPlayStats(records, indexContent(loadContentPack()));
console.log(`사람 플레이 ${s.runs}판 (${dir})`);
for (const d of s.byDifficulty)
  console.log(
    `  ${d.difficulty}: ${d.runs}판 · 50세 전 실패 ${d.failBefore50Percent ?? '-'}% (봇 목표 ${d.botTarget}) · 정상 엔딩 중 부장 ${d.headAmongNormalPercent ?? '-'}%`,
  );
console.log(
  `  직무별 실패: ${s.byJob.map((j) => `${j.jobId} ${j.failBefore50Percent ?? '-'}%(${j.runs})`).join(' · ')}`,
);
console.log(`  엔딩: ${s.endings.map((e) => `${e.type} ${e.count}`).join(' · ')}`);
console.log('  한쪽으로 몰린 선택 (10번 이상 열린 사건):');
for (const c of s.skewedChoices)
  console.log(`    ${c.topSharePercent}% '${c.top}' — ${c.title} (${c.picks}번)`);
