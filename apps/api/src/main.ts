import path from 'node:path';
import { loadContentPack } from '@company-life/content';
import { buildApp } from './app';
import { FileDailyStore, FilePlayerStore, FileRunStore } from './store';

const port = Number(process.env['API_PORT'] ?? 3001);
const host = process.env['API_HOST'] ?? '127.0.0.1';
const storeDir = path.resolve(process.env['RUN_STORE_DIR'] ?? '.data/runs');
const playerDir = path.resolve(process.env['PLAYER_STORE_DIR'] ?? '.data/players');
const dailyDir = path.resolve(process.env['DAILY_STORE_DIR'] ?? '.data/daily');

// 플레이테스트 도구는 명시적으로 켤 때만, 그리고 production에서는 절대 켜지 않는다
const playtestTools = process.env['PLAYTEST_TOOLS'] === '1' && process.env['NODE_ENV'] !== 'production';

const app = buildApp({
  store: new FileRunStore(storeDir),
  players: new FilePlayerStore(playerDir),
  daily: new FileDailyStore(dailyDir),
  contents: [loadContentPack()],
  logger: true,
  playtestTools,
});

try {
  await app.listen({ port, host });
  app.log.info(`run store (local file stub): ${storeDir}`);
  if (playtestTools) app.log.warn('PLAYTEST TOOLS ENABLED — 개발·검수 전용');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
