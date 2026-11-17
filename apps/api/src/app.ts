import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  ApplyJobRequestSchema,
  PlaytestForceEventRequestSchema,
  PlaytestPatchRequestSchema,
  ChooseCharacterRequestSchema,
  ChooseRequestSchema,
  CommandRequestSchema,
  GameRunStateSchema,
  GUEST_TOKEN_HEADER,
  validateProfileInput,
  type ApiErrorBody,
  type ContentPack,
  type CreateRunResponse,
  type GameRunState,
  type PublicRunView,
} from '@company-life/shared';
import {
  applyForJob,
  chooseCharacter,
  chooseInMonth,
  createRun,
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
import { NotFoundError, type RunRecord, type RunStore } from './store';

export interface AppOptions {
  store: RunStore;
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

  const contentFor = (state: GameRunState): ContentIndex => {
    const content = contents.get(state.contentVersion);
    if (!content) {
      throw new ApiError(503, 'CONTENT_VERSION_UNAVAILABLE', `content ${state.contentVersion} is not loaded`);
    }
    return content;
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
    return toPublicView(record.state, contentFor(record.state));
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
    return store.update(req.params.id, async (record) => {
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
      const content = contentFor(record.state);
      const out = exec(record.state, content);
      const nextState = GameRunStateSchema.parse({
        ...out.state,
        stateRevision: record.state.stateRevision + 1,
      });
      const responseBody = { view: toPublicView(nextState, content), result: out.result ?? null };

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
    const guestToken = randomBytes(32).toString('base64url');
    const state = createRun(
      {
        runId: randomUUID(),
        guestOwnerId: `guest_${randomUUID()}`,
        seed: randomBytes(16).toString('hex'),
        profile: profile.profile,
        now: now().toISOString(),
      },
      latestContent,
    );
    GameRunStateSchema.parse(state);
    await store.create({ state, ownerTokenHash: hashToken(guestToken), idempotency: {} });
    req.log.info({ runId: state.runId }, 'run created');
    const body: CreateRunResponse = {
      runId: state.runId,
      guestToken,
      view: toPublicView(state, latestContent),
    };
    return reply.status(201).send(body);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req) => loadView(req));

  app.post<{ Params: { id: string } }>('/api/runs/:id/character', async (req, reply) => {
    const body = parseBody(ChooseCharacterRequestSchema, req.body);
    const out = await runCommand(req, 'chooseCharacter', body, (state, content) => ({
      state: chooseCharacter(state, body.cardId, content),
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
    const view = toPublicView(record.state, contentFor(record.state));
    return { skills: view.skills, history: record.state.skillHistory };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/negative-traits', async (req) => {
    const record = authorize(req, await store.get(req.params.id));
    const content = contentFor(record.state);
    const view = toPublicView(record.state, content);
    return {
      negativeTraits: view.negativeTraits.map((t) => ({
        ...t,
        recoveryHint: content.traits.get(t.id)?.recoveryHint ?? null,
      })),
      history: record.state.traitHistory,
    };
  });

  // ── 플레이테스트 도구: 옵션으로 켤 때만 라우트가 존재한다 (꺼져 있으면 404) ──
  app.get('/api/playtest/status', async () => ({ enabled: options.playtestTools === true }));

  if (options.playtestTools) {
    app.get('/api/playtest/catalog', async () => playtestCatalog(latestContent));

    app.get<{ Params: { id: string } }>('/api/playtest/runs/:id/debug', async (req) => {
      const record = authorize(req, await store.get(req.params.id));
      return playtestDebugView(record.state, contentFor(record.state));
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
