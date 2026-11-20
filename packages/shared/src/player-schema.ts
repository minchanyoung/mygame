import { z } from 'zod';
import { DifficultySchema } from './enums';

/** S10 도감 한 칸: 처음 본 때·횟수·본 난이도 */
export const CollectionEntrySchema = z
  .object({
    count: z.number().int().min(1),
    firstAt: z.string(),
    difficulties: z.array(DifficultySchema),
  })
  .strict();
export type CollectionEntry = z.infer<typeof CollectionEntrySchema>;

export const COLLECTION_KINDS = [
  'titles',
  'endings',
  'goals',
  'companies',
  'seriesEndings',
  'traits',
] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

const Entries = z.record(z.string(), CollectionEntrySchema);

/** 한 판이 끝날 때 새로 발견한 것 (엔딩 화면 표시용) */
export const RunDiscoverySchema = z
  .object({
    runId: z.string(),
    newly: z.object({
      titles: z.array(z.string()),
      endings: z.array(z.string()),
      goals: z.array(z.string()),
      companies: z.array(z.string()),
      seriesEndings: z.array(z.string()),
      traits: z.array(z.string()),
    }),
    achievements: z.array(z.string()),
  })
  .strict();
export type RunDiscovery = z.infer<typeof RunDiscoverySchema>;

/** S10 플레이어 도감 (서버 정본). 엔딩이 확정될 때 서버가 갱신한다 */
export const PlayerCollectionSchema = z
  .object({
    runsFinished: z.number().int().min(0),
    titles: Entries,
    endings: Entries,
    /** 달성한 인생 목표만 */
    goals: Entries,
    companies: Entries,
    /** key = `${eventId}:${choiceId}` (연재 마지막 화·정리 화의 선택) */
    seriesEndings: Entries,
    traits: Entries,
    achievements: z.record(z.string(), z.object({ at: z.string() }).strict()),
    /** 이미 반영한 판 (중복 반영 방지) */
    runIds: z.array(z.string()),
    /** 최근 판의 새 발견 (엔딩 화면이 가져간다, 최대 10개) */
    recent: z.array(RunDiscoverySchema),
    /** S22 마지막으로 끝낸 판의 대표 별명 (다음 판의 '선배의 유산') */
    lastRun: z.object({ titleId: z.string(), age: z.number().int() }).strict().nullable().optional(),
  })
  .strict();
export type PlayerCollection = z.infer<typeof PlayerCollectionSchema>;

export const emptyCollection = (): PlayerCollection => ({
  runsFinished: 0,
  titles: {},
  endings: {},
  goals: {},
  companies: {},
  seriesEndings: {},
  traits: {},
  achievements: {},
  runIds: [],
  recent: [],
});
