import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PlayerCollectionSchema, type GameRunState, type PlayerCollection } from '@company-life/shared';
import { migrateRunState } from '@company-life/game-engine';

/** 저장된 명령 결과 (같은 idempotencyKey 재요청 시 그대로 반환) */
export interface IdempotencyEntry {
  command: string;
  requestHash: string;
  statusCode: number;
  body: unknown;
  createdAt: string;
}

export interface RunRecord {
  state: GameRunState;
  /** 게스트 토큰의 SHA-256 해시. 원문 토큰은 저장하지 않는다. */
  ownerTokenHash: string;
  idempotency: Record<string, IdempotencyEntry>;
}

/**
 * run 저장소 계약. PostgreSQL 구현(game_runs + 불변 로그)으로 교체할 때 이 인터페이스를 유지한다.
 * update는 run 단위로 직렬화되며, mutator가 예외를 던지면 아무것도 저장되지 않는다(원자성).
 */
export interface RunStore {
  create(record: RunRecord): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  update<T>(
    runId: string,
    mutator: (record: RunRecord) => Promise<{ record: RunRecord | null; value: T }>,
  ): Promise<T>;
}

class KeyedMutex {
  #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.#tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

export class NotFoundError extends Error {}

/** 테스트용 메모리 저장소 */
export class MemoryRunStore implements RunStore {
  #records = new Map<string, string>();
  #mutex = new KeyedMutex();

  async create(record: RunRecord): Promise<void> {
    if (this.#records.has(record.state.runId)) throw new Error('run already exists');
    this.#records.set(record.state.runId, JSON.stringify(record));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const raw = this.#records.get(runId);
    return raw === undefined ? undefined : (JSON.parse(raw) as RunRecord);
  }

  update<T>(
    runId: string,
    mutator: (record: RunRecord) => Promise<{ record: RunRecord | null; value: T }>,
  ): Promise<T> {
    return this.#mutex.run(runId, async () => {
      const current = await this.get(runId);
      if (!current) throw new NotFoundError(runId);
      const { record, value } = await mutator(current);
      if (record) this.#records.set(runId, JSON.stringify(record));
      return value;
    });
  }
}

const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * 로컬 개발용 JSON 파일 저장소 (DB 스텁, §24.4). 임시 파일에 쓴 뒤 rename으로 교체한다.
 * 단일 프로세스 전제이며 운영 환경용이 아니다.
 */
export class FileRunStore implements RunStore {
  #dir: string;
  #mutex = new KeyedMutex();

  constructor(dir: string) {
    this.#dir = dir;
  }

  #file(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) throw new NotFoundError(runId);
    return path.join(this.#dir, `${runId}.json`);
  }

  async #write(record: RunRecord): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#file(record.state.runId);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record), 'utf8');
    await rename(tmp, file);
  }

  async create(record: RunRecord): Promise<void> {
    await this.#mutex.run(record.state.runId, () => this.#write(record));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.#file(runId), 'utf8');
    } catch (err) {
      if (err instanceof NotFoundError || (err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    const parsed = JSON.parse(raw) as RunRecord;
    // 구버전 세이브는 현재 스키마로 끌어올리고, 그래도 계약을 통과하지 못하면 예외 (손상 세이브 조기 발견)
    return { ...parsed, state: migrateRunState(parsed.state) };
  }

  update<T>(
    runId: string,
    mutator: (record: RunRecord) => Promise<{ record: RunRecord | null; value: T }>,
  ): Promise<T> {
    return this.#mutex.run(runId, async () => {
      const current = await this.get(runId);
      if (!current) throw new NotFoundError(runId);
      const { record, value } = await mutator(current);
      if (record) await this.#write(record);
      return value;
    });
  }
}

// ───────── S10 플레이어 (도감·업적) ─────────

export interface PlayerRecord {
  playerId: string;
  /** 플레이어 토큰의 SHA-256 해시. 원문 토큰은 저장하지 않는다. */
  tokenHash: string;
  collection: PlayerCollection;
  createdAt: string;
}

/** 플레이어 저장소 계약 (나중에 PostgreSQL players 테이블로 교체). update는 플레이어 단위로 직렬화. */
export interface PlayerStore {
  create(record: PlayerRecord): Promise<void>;
  get(playerId: string): Promise<PlayerRecord | undefined>;
  update(playerId: string, mutator: (record: PlayerRecord) => PlayerRecord): Promise<PlayerRecord>;
}

const parsePlayer = (raw: string): PlayerRecord => {
  const p = JSON.parse(raw) as PlayerRecord;
  return { ...p, collection: PlayerCollectionSchema.parse(p.collection) };
};

export class MemoryPlayerStore implements PlayerStore {
  #records = new Map<string, string>();
  #mutex = new KeyedMutex();

  async create(record: PlayerRecord): Promise<void> {
    if (this.#records.has(record.playerId)) throw new Error('player already exists');
    this.#records.set(record.playerId, JSON.stringify(record));
  }

  async get(playerId: string): Promise<PlayerRecord | undefined> {
    const raw = this.#records.get(playerId);
    return raw === undefined ? undefined : parsePlayer(raw);
  }

  update(playerId: string, mutator: (record: PlayerRecord) => PlayerRecord): Promise<PlayerRecord> {
    return this.#mutex.run(playerId, async () => {
      const current = await this.get(playerId);
      if (!current) throw new NotFoundError(playerId);
      const next = mutator(current);
      this.#records.set(playerId, JSON.stringify(next));
      return next;
    });
  }
}

/** 로컬 개발용 JSON 파일 플레이어 저장소 */
export class FilePlayerStore implements PlayerStore {
  #dir: string;
  #mutex = new KeyedMutex();

  constructor(dir: string) {
    this.#dir = dir;
  }

  #file(playerId: string): string {
    if (!RUN_ID_PATTERN.test(playerId)) throw new NotFoundError(playerId);
    return path.join(this.#dir, `${playerId}.json`);
  }

  async #write(record: PlayerRecord): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#file(record.playerId);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record), 'utf8');
    await rename(tmp, file);
  }

  async create(record: PlayerRecord): Promise<void> {
    await this.#mutex.run(record.playerId, () => this.#write(record));
  }

  async get(playerId: string): Promise<PlayerRecord | undefined> {
    try {
      return parsePlayer(await readFile(this.#file(playerId), 'utf8'));
    } catch (err) {
      if (err instanceof NotFoundError || (err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  update(playerId: string, mutator: (record: PlayerRecord) => PlayerRecord): Promise<PlayerRecord> {
    return this.#mutex.run(playerId, async () => {
      const current = await this.get(playerId);
      if (!current) throw new NotFoundError(playerId);
      const next = mutator(current);
      await this.#write(next);
      return next;
    });
  }
}

// ───────── S21 오늘의 출근 순위 ─────────

export interface DailyRecord {
  playerId: string;
  name: string;
  score: number;
  endingTitle: string;
  age: number;
  rankLabel: string | null;
  runId: string;
  at: string;
}

/** 날짜별 순위 기록. 플레이어당 하루 첫 판만 남긴다 (같은 플레이어의 두 번째 판은 무시) */
export interface DailyStore {
  /** 새로 남겼으면 true, 그날 이미 기록이 있으면 false */
  record(date: string, entry: DailyRecord): Promise<boolean>;
  list(date: string): Promise<DailyRecord[]>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MemoryDailyStore implements DailyStore {
  #days = new Map<string, DailyRecord[]>();
  #mutex = new KeyedMutex();

  record(date: string, entry: DailyRecord): Promise<boolean> {
    return this.#mutex.run(date, async () => {
      const day = this.#days.get(date) ?? [];
      if (day.some((d) => d.playerId === entry.playerId)) return false;
      this.#days.set(date, [...day, entry]);
      return true;
    });
  }

  async list(date: string): Promise<DailyRecord[]> {
    return [...(this.#days.get(date) ?? [])];
  }
}

/** 로컬 개발용: 날짜마다 JSON 파일 하나 */
export class FileDailyStore implements DailyStore {
  #dir: string;
  #mutex = new KeyedMutex();

  constructor(dir: string) {
    this.#dir = dir;
  }

  #file(date: string): string {
    if (!DATE_PATTERN.test(date)) throw new NotFoundError(date);
    return path.join(this.#dir, `${date}.json`);
  }

  async list(date: string): Promise<DailyRecord[]> {
    try {
      return JSON.parse(await readFile(this.#file(date), 'utf8')) as DailyRecord[];
    } catch (err) {
      if (err instanceof NotFoundError || (err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  record(date: string, entry: DailyRecord): Promise<boolean> {
    return this.#mutex.run(date, async () => {
      const day = await this.list(date);
      if (day.some((d) => d.playerId === entry.playerId)) return false;
      await mkdir(this.#dir, { recursive: true });
      const file = this.#file(date);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify([...day, entry]), 'utf8');
      await rename(tmp, file);
      return true;
    });
  }
}
