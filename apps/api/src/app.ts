import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  ApplyJobRequestSchema,
  PlaytestForceEventRequestSchema,
  PlaytestPatchRequestSchema,
  ChooseCharacterRequestSchema,
  ChooseGoalRequestSchema,
  TransferDecisionRequestSchema,
  ChooseRequestSchema,
  CommandRequestSchema,
  DifficultySchema,
  emptyCollection,
  GameRunStateSchema,
  GUEST_TOKEN_HEADER,
  PLAYER_TOKEN_HEADER,
  validateProfileInput,
  type ApiErrorBody,
  type ContentPack,
  type CreateRunResponse,
  type GameRunState,
  type PublicCollection,
  type PublicRunView,
} from '@company-life/shared';
import {
  applyForJob,
  chooseCharacter,
  chooseGoal,
  acceptTransfer,
  declineTransfer,
  rebindContentVersion,
  chooseInMonth,
  collectRun,
  createRun,
  mergeRun,
  toPublicCollection,
  EngineError,
  indexContent,
  nextMonth,
  applyPlaytestPatch,
  playtestCatalog,
  playtestDebugView,
  playtestStartMonthWithEvent,
  startMonth,
  toPublicView,
  type ContentIndex,
} from '@company-life/game-engine';
import {
  MemoryPlayerStore,
  NotFoundError,
  type PlayerRecord,
  type PlayerStore,
  type RunRecord,
  type RunStore,
} from './store';

export interface AppOptions {
  store: RunStore;
  /** S10 플레이어(도감·업적) 저장소. 생략 시 메모리 */
  players?: PlayerStore;
  /** 버전별 콘텐츠. 진행 중 run은 생성 시 고정된 버전으로만 처리한다 (§23.1). */
  contents: ContentPack[];
  logger?: boolean;
  /** 플레이테스트 도구(상태 조정·사건 강제·디버그) 활성화. 운영 환경에서는 켜지 않는다. */
  playtestTools?: boolean;
  now?: () => Date;
}

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

const IDEMPOTENCY_HISTORY_LIMIT = 50;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const hashRequest = (body: unknown) => createHash('sha256').update(JSON.stringify(body)).digest('hex');

function tokenMatches(token: string, expectedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function engineErrorStatus(err: EngineError): number {
  switch (err.code) {
    case 'INVALID_PHASE':
    case 'INVALID_TRANSITION':
    case 'LEVEL_MISMATCH':
      return 409;
    case 'CARD_NOT_FOUND':
    case 'GOAL_NOT_OFFERED':
    case 'OFFER_NOT_FOUND':
    case 'CHOICE_NOT_AVAILABLE':
      return 400;
    case 'CONTENT_VERSION_MISMATCH':
      return 503;
    default:
      return 500;
  }
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { store } = options;
  const players = options.players ?? new MemoryPlayerStore();
  const now = options.now ?? (() => new Date());
  const contents = new Map<string, ContentIndex>(
    options.contents.map((c) => [c.contentVersion, indexContent(c)]),
  );
  const latest = options.contents[options.contents.length - 1];
  if (!latest) throw new Error('at least one content pack is required');
  const latestContent = indexContent(latest);

  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() });

  const send = (reply: FastifyReply, req: FastifyRequest, err: ApiError) => {
    const body: ApiErrorBody = {
      code: err.code,
      message: err.message,
      details: err.details,
      requestId: req.id,
    };
    return reply.status(err.statusCode).send(body);
  };

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) return send(reply, req, error);
    if (error instanceof EngineError) {
      return send(
        reply,
        req,
        new ApiError(engineErrorStatus(error), error.code, error.message, error.details),
      );
    }
    if (error instanceof NotFoundError)
      return send(reply, req, new ApiError(404, 'NOT_FOUND', 'run not found'));
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return send(reply, req, new ApiError(status, 'VALIDATION_FAILED', (error as Error).message));
    }
    req.log.error({ err: error }, 'unhandled error');
    return send(reply, req, new ApiError(500, 'INTERNAL_ERROR', 'internal error'));
  });

  app.setNotFoundHandler((req, reply) => send(reply, req, new ApiError(404, 'NOT_FOUND', 'route not found')));

  /**
   * run이 고정된 콘텐츠를 찾는다. 그 버전이 더 이상 서버에 없으면(업데이트 후) 최신 콘텐츠로 옮길 수 있는지
   * 확인해 옮긴다 — 진행 중 사건·회사·목표 등 참조가 모두 남아 있을 때만. 옮길 수 없으면 503.
   */
  const prepare = (state: GameRunState): { state: GameRunState; content: ContentIndex } => {
    const pinned = contents.get(state.contentVersion);
    if (pinned) return { state, content: pinned };
    const rebound = rebindContentVersion(state, latestContent);
    if (!rebound) {
      throw new ApiError(503, 'CONTENT_VERSION_UNAVAILABLE', `content ${state.contentVersion} is not loaded`);
    }
    return { state: rebound, content: latestContent };
  };

  /**
   * S10 플레이어 토큰 = `${playerId}.${비밀}`. 서버에는 해시만 저장한다.
   * 없거나 맞지 않으면 null (새 플레이어로 취급).
   */
  const findPlayer = async (req: FastifyRequest): Promise<PlayerRecord | null> => {
    const token = req.headers[PLAYER_TOKEN_HEADER];
    if (typeof token !== 'string') return null;
    const playerId = token.split('.')[0] ?? '';
    const record = await players.get(playerId).catch(() => undefined);
    return record && tokenMatches(token, record.tokenHash) ? record : null;
  };

  /** S10 엔딩이 확정된 판을 플레이어 도감에 반영 (서버가 직접 판정, 조작된 판 제외, 중복 반영 없음) */
  const recordFinishedRun = async (state: GameRunState, content: ContentIndex, req: FastifyRequest) => {
    if (!state.playerId || state.playtestModified || !state.ending) return;
    try {
      await players.update(state.playerId, (p) => ({
        ...p,
        collection: mergeRun(
          p.collection,
          state.runId,
          collectRun(state, content),
          state.difficulty,
          now().toISOString(),
          content,
        ).collection,
      }));
    } catch (err) {
      // 도감 반영 실패가 게임 진행을 막지는 않는다 (다음 조회 때 다시 시도하지 않음 — 로그로 추적)
      req.log.error({ err, runId: state.runId }, 'collection update failed');
    }
  };

  /** 소유권 검증: 게스트 토큰이 없으면 401, 다르면 403 (§11.4) */
  const authorize = (req: FastifyRequest, record: RunRecord | undefined): RunRecord => {
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'run not found');
    const token = req.headers[GUEST_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0)
      throw new ApiError(401, 'UNAUTHENTICATED', 'guest token required');
    if (!tokenMatches(token, record.ownerTokenHash))
      throw new ApiError(403, 'FORBIDDEN', 'not the owner of this run');
    return record;
  };

  const loadView = async (req: FastifyRequest<{ Params: { id: string } }>): Promise<PublicRunView> => {
    const record = authorize(req, await store.get(req.params.id));
    const { state, content } = prepare(record.state);
    return toPublicView(state, content);
  };

  /**
   * 쓰기 명령 공통 처리 (§23.3): 소유권 → idempotencyKey(같은 키·같은 본문은 이전 결과, 다른 본문은 409)
   * → expectedRevision(불일치 409) → 엔진 실행 → stateRevision+1 → 스키마 검증 → 저장. 실패 시 저장하지 않는다.
   */
  const runCommand = async <B extends { idempotencyKey: string; expectedRevision: number }>(
    req: FastifyRequest<{ Params: { id: string } }>,
    command: string,
    body: B,
    exec: (state: GameRunState, content: ContentIndex) => { state: GameRunState; result?: unknown },
  ): Promise<{ statusCode: number; body: unknown }> => {
    const { idempotencyKey, expectedRevision, ...payload } = body;
    const requestHash = hashRequest({ command, payload });
    let finished: { state: GameRunState; content: ContentIndex } | null = null;
    const value = await store.update(req.params.id, async (record) => {
      authorize(req, record);
      const previous = record.idempotency[idempotencyKey];
      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'idempotencyKey was used with a different request');
        }
        return { record: null, value: { statusCode: previous.statusCode, body: previous.body } };
      }
      if (record.state.stateRevision !== expectedRevision) {
        throw new ApiError(409, 'REVISION_CONFLICT', 'state has changed', {
          expectedRevision,
          currentRevision: record.state.stateRevision,
        });
      }
      const { state: current, content } = prepare(record.state);
      const out = exec(current, content);
      const nextState = GameRunStateSchema.parse({
        ...out.state,
        stateRevision: record.state.stateRevision + 1,
      });
      const responseBody = { view: toPublicView(nextState, content), result: out.result ?? null };
      if (record.state.phase !== 'GAME_OVER' && nextState.phase === 'GAME_OVER')
        finished = { state: nextState, content };

      const entries = Object.entries(record.idempotency)
        .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))
        .slice(-(IDEMPOTENCY_HISTORY_LIMIT - 1));
      const idempotency = Object.fromEntries(entries);
      idempotency[idempotencyKey] = {
        command,
        requestHash,
        statusCode: 200,
        body: responseBody,
        createdAt: now().toISOString(),
      };
      req.log.info({
        runId: nextState.runId,
        turn: nextState.turnIndex,
        command,
        revision: nextState.stateRevision,
      });
      return {
        record: { ...record, state: nextState, idempotency },
        value: { statusCode: 200, body: responseBody },
      };
    });
    // 판 저장이 끝난 뒤 도감에 반영 (응답 전에 끝내 엔딩 화면이 바로 새 발견을 볼 수 있게)
    const done = finished as { state: GameRunState; content: ContentIndex } | null;
    if (done) await recordFinishedRun(done.state, done.content, req);
    return value;
  };

  const parseBody = <T>(
    schema: {
      safeParse: (
        v: unknown,
      ) => { success: true; data: T } | { success: false; error: { issues: unknown[] } };
    },
    body: unknown,
  ): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(400, 'VALIDATION_FAILED', 'invalid request body', parsed.error.issues);
    return parsed.data;
  };

  app.get('/api/health', async () => ({ ok: true, contentVersion: latest.contentVersion }));

  // 이름·성별 입력 → 검증 + 카드 3장 생성/고정을 한 번에 (§23.3)
  app.post('/api/runs', async (req, reply) => {
    const profile = validateProfileInput(req.body, latest.policy.bannedWords);
    if (!profile.ok) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid profile', profile.issues);
    // S10 난이도 (생략 시 보통)
    const rawDifficulty = (req.body as Record<string, unknown> | null)?.['difficulty'] ?? 'NORMAL';
    const difficulty = DifficultySchema.safeParse(rawDifficulty);
    if (!difficulty.success) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid difficulty');
    // S10 플레이어: 받은 토큰이 유효하면 이어서, 아니면 새로 만든다
    let player = await findPlayer(req);
    let playerToken = req.headers[PLAYER_TOKEN_HEADER] as string;
    if (!player) {
      const playerId = randomUUID();
      playerToken = `${playerId}.${randomBytes(24).toString('base64url')}`;
      player = {
        playerId,
        tokenHash: hashToken(playerToken),
        collection: emptyCollection(),
        createdAt: now().toISOString(),
      };
      await players.create(player);
    }
    const guestToken = randomBytes(32).toString('base64url');
    const state = createRun(
      {
        runId: randomUUID(),
        guestOwnerId: `guest_${randomUUID()}`,
        seed: randomBytes(16).toString('hex'),
        profile: profile.profile,
        now: now().toISOString(),
        difficulty: difficulty.data,
        playerId: player.playerId,
      },
      latestContent,
    );
    GameRunStateSchema.parse(state);
    await store.create({ state, ownerTokenHash: hashToken(guestToken), idempotency: {} });
    req.log.info({ runId: state.runId }, 'run created');
    const body: CreateRunResponse = {
      runId: state.runId,
      guestToken,
      playerToken,
      view: toPublicView(state, latestContent),
    };
    return reply.status(201).send(body);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req) => loadView(req));

  // S10 도감·업적. 토큰이 없거나 맞지 않으면 빈 도감 (?run= 이 판의 새 발견 포함)
  app.get<{ Querystring: { run?: string } }>('/api/player', async (req): Promise<PublicCollection> => {
    const player = await findPlayer(req);
    return toPublicCollection(player?.collection ?? emptyCollection(), latestContent, req.query.run);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/character', async (req, reply) => {
    const body = parseBody(ChooseCharacterRequestSchema, req.body);
    const out = await runCommand(req, 'chooseCharacter', body, (state, content) => ({
      state: chooseCharacter(state, body.cardId, content),
    }));
    return reply.status(out.statusCode).send(out.body);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/goal', async (req, reply) => {
    const body = parseBody(ChooseGoalRequestSchema, req.body);
    const out = await runCommand(req, 'chooseGoal', body, (state, content) => ({
      state: chooseGoal(state, body.goalId, content),
    }));
    return reply.status(out.statusCode).send(out.body);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/transfer', async (req, reply) => {
    const body = parseBody(TransferDecisionRequestSchema, req.body);
    const command = body.decision === 'accept' ? 'acceptTransfer' : 'declineTransfer';
    const out = await runCommand(req, command, body, (state, content) => ({
      state: body.decision === 'accept' ? acceptTransfer(state, content) : declineTransfer(state),
    }));
    return reply.status(out.statusCode).send(out.body);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/job-offers', async (req) => ({
    jobOffers: (await loadView(req)).jobOffers,
  }));

  app.post<{ Params: { id: string } }>('/api/runs/:id/apply-job', async (req, reply) => {
    const body = parseBody(ApplyJobRequestSchema, req.body);
    const out = await runCommand(req, 'apply', body, (state, content) => {
      const applied = applyForJob(state, body.offerId, content);
      const name = (id: string) => content.companies.get(id)?.name ?? null;
      // 판정 roll/정확한 내부 값은 노출하지 않는다
      return {
        state: applied.state,
        result: {
          hired: applied.result.hired,
          companyName: name(applied.result.appliedOffer.companyId),
          joinedCompanyName: name(applied.result.joinedOffer.companyId),
          autoAssigned: applied.result.autoAssigned,
        },
      };
    });
    return reply.status(out.statusCode).send(out.body);
  });

  // ── 월간 루프 (§20.1, §23.3) ──
  app.post<{ Params: { id: string } }>('/api/runs/:id/start-month', async (req, reply) => {
    const body = parseBody(CommandRequestSchema, req.body);
    const out = await runCommand(req, 'startMonth', body, (state, content) => ({
      state: startMonth(state, content),
    }));
    return reply.status(out.statusCode).send(out.body);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/current-event', async (req) => ({
    activeEvent: (await loadView(req)).activeEvent,
  }));

  app.post<{ Params: { id: string } }>('/api/runs/:id/choose', async (req, reply) => {
    const body = parseBody(ChooseRequestSchema, req.body);
    const out = await runCommand(req, 'choose', body, (state, content) => {
      if (state.activeEvent && state.activeEvent.occurrenceId !== body.occurrenceId) {
        throw new ApiError(409, 'STALE_EVENT', 'occurrenceId does not match the current event');
      }
      const chosen = chooseInMonth(state, body.choiceId, content);
      return { state: chosen.state, result: { success: chosen.result.success } };
    });
    return reply.status(out.statusCode).send(out.body);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/next-month', async (req, reply) => {
    const body = parseBody(CommandRequestSchema, req.body);
    const out = await runCommand(req, 'nextMonth', body, (state, content) => ({
      state: nextMonth(state, content, now().toISOString()),
    }));
    return reply.status(out.statusCode).send(out.body);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/result', async (req) => {
    const view = await loadView(req);
    if (!view.ending) throw new ApiError(409, 'INVALID_PHASE', 'the run has not ended');
    return { ending: view.ending, turn: view.turn, netWorth: view.netWorth };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/npcs', async (req) => ({
    npcs: (await loadView(req)).npcs,
  }));

  app.get<{ Params: { id: string } }>('/api/runs/:id/skills', async (req) => {
    const record = authorize(req, await store.get(req.params.id));
    const { state, content } = prepare(record.state);
    const view = toPublicView(state, content);
    return { skills: view.skills, history: state.skillHistory };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/negative-traits', async (req) => {
    const record = authorize(req, await store.get(req.params.id));
    const { state, content } = prepare(record.state);
    const view = toPublicView(state, content);
    return {
      negativeTraits: view.negativeTraits.map((t) => ({
        ...t,
        recoveryHint: content.traits.get(t.id)?.recoveryHint ?? null,
      })),
      history: state.traitHistory,
    };
  });

  // ── 플레이테스트 도구: 옵션으로 켤 때만 라우트가 존재한다 (꺼져 있으면 404) ──
  app.get('/api/playtest/status', async () => ({ enabled: options.playtestTools === true }));

  if (options.playtestTools) {
    app.get('/api/playtest/catalog', async () => playtestCatalog(latestContent));

    app.get<{ Params: { id: string } }>('/api/playtest/runs/:id/debug', async (req) => {
      const record = authorize(req, await store.get(req.params.id));
      const { state, content } = prepare(record.state);
      return playtestDebugView(state, content);
    });

    app.post<{ Params: { id: string } }>('/api/playtest/runs/:id/patch', async (req, reply) => {
      const body = parseBody(PlaytestPatchRequestSchema, req.body);
      const { idempotencyKey: _k, expectedRevision: _r, ...patch } = body;
      const out = await runCommand(req, 'playtestPatch', body, (state, content) => ({
        state: applyPlaytestPatch(state, patch, content),
      }));
      return reply.status(out.statusCode).send(out.body);
    });

    app.post<{ Params: { id: string } }>('/api/playtest/runs/:id/force-event', async (req, reply) => {
      const body = parseBody(PlaytestForceEventRequestSchema, req.body);
      const out = await runCommand(req, 'playtestForceEvent', body, (state, content) => ({
        state: playtestStartMonthWithEvent(state, body.eventId, content),
      }));
      return reply.status(out.statusCode).send(out.body);
    });
  }

  return app;
}
