import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadContentPack } from '@company-life/content';
import type { CreateRunResponse, PublicChoice, PublicRunView } from '@company-life/shared';
import { buildApp } from './app';
import { FileRunStore, MemoryRunStore, type RunStore } from './store';

const contents = [loadContentPack()];
const makeApp = (store: RunStore = new MemoryRunStore()) => buildApp({ store, contents });

async function createRun(app: ReturnType<typeof makeApp>, displayName = '김하늘', gender = 'FEMALE') {
  const res = await app.inject({ method: 'POST', url: '/api/runs', payload: { displayName, gender } });
  return { res, body: res.json() as CreateRunResponse };
}

const auth = (token: string) => ({ 'x-guest-token': token });

describe('POST /api/runs — profile input → 3 cards (§3.1, §23.3)', () => {
  it('rejects invalid profiles with the standard error shape', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { displayName: ' 김 ', gender: 'ROBOT' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(typeof body.requestId).toBe('string');
    expect(body.details.map((d: { code: string }) => d.code).sort()).toEqual(['INVALID_GENDER', 'TOO_SHORT']);
  });

  it('creates a run in CHARACTER_SELECTION with 3 same-profile cards and no secrets', async () => {
    const app = makeApp();
    const { res, body } = await createRun(app);
    expect(res.statusCode).toBe(201);
    expect(body.view.phase).toBe('CHARACTER_SELECTION');
    expect(body.view.revision).toBe(0);
    expect(body.view.characterCards).toHaveLength(3);
    for (const c of body.view.characterCards) {
      expect(c.displayName).toBe('김하늘');
      expect(c.gender).toBe('FEMALE');
      expect(c.permanentTraitCount).toBe(0);
    }
    expect(body.view.skills).toEqual([]);
    expect(body.view.negativeTraits).toEqual([]);
    expect(res.body).not.toMatch(/"seed"|rngState|ownerTokenHash/);
  });

  it('keeps the cards fixed on re-read (no re-roll)', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const again = await app.inject({ url: `/api/runs/${body.runId}`, headers: auth(body.guestToken) });
    expect((again.json() as PublicRunView).characterCards).toEqual(body.view.characterCards);
  });

  it('enforces ownership: 401 without token, 403 with a wrong token, 404 for unknown run', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    expect((await app.inject({ url: `/api/runs/${body.runId}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/runs/${body.runId}`, headers: auth('nope') })).statusCode).toBe(
      403,
    );
    const unknown = await app.inject({
      url: '/api/runs/00000000-0000-0000-0000-000000000000',
      headers: auth('x'),
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('POST /api/runs/:id/character — idempotency and revision (§23.3)', () => {
  it('accepts only server-issued card ids', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/character`,
      headers: auth(body.guestToken),
      payload: { cardId: 'card_forged', idempotencyKey: 'key-forged-1', expectedRevision: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CARD_NOT_FOUND');
  });

  it('rejects client-supplied character data (strict body)', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/character`,
      headers: auth(body.guestToken),
      payload: { cardId: 'card_1', idempotencyKey: 'key-extra-1', expectedRevision: 0, cash: 999999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies once; same key + same body replays; same key + other body → 409; stale revision → 409', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const url = `/api/runs/${body.runId}/character`;
    const headers = auth(body.guestToken);
    const payload = { cardId: 'card_2', idempotencyKey: 'key-choose-0001', expectedRevision: 0 };

    const first = await app.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(200);
    const view = first.json().view as PublicRunView;
    expect(view.phase).toBe('GOAL_SELECTION');
    expect(view.lifeGoalOffers).toHaveLength(3);
    expect(view.revision).toBe(1);
    expect(view.selectedCardId).toBe('card_2');
    expect(view.jobOffers).toHaveLength(3);

    const replay = await app.inject({ method: 'POST', url, headers, payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const current = await app.inject({ url: `/api/runs/${body.runId}`, headers });
    expect((current.json() as PublicRunView).revision).toBe(1);

    const conflict = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, cardId: 'card_3' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');

    const stale = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { cardId: 'card_3', idempotencyKey: 'key-choose-0002', expectedRevision: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('REVISION_CONFLICT');
  });

  it('S5 goal: only an offered goal is accepted (400), and job offers come after the goal', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const headers = auth(body.guestToken);
    const chosen = (
      await app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/character`,
        headers,
        payload: { cardId: 'card_1', idempotencyKey: 'key-goal-c1', expectedRevision: 0 },
      })
    ).json().view as PublicRunView;
    const skip = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/apply-job`,
      headers,
      payload: { offerId: chosen.jobOffers[0]!.offerId, idempotencyKey: 'key-goal-a1', expectedRevision: 1 },
    });
    expect(skip.statusCode).toBe(409);
    const offered = new Set(chosen.lifeGoalOffers.map((g) => g.id));
    const other = [
      'goal_own_home',
      'goal_department_head',
      'goal_full_tenure',
      'goal_debt_free',
      'goal_ace',
    ].find((id) => !offered.has(id))!;
    const bad = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/goal`,
      headers,
      payload: { goalId: other, idempotencyKey: 'key-goal-b1', expectedRevision: 1 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('GOAL_NOT_OFFERED');
  });

  it('a save pinned to a content version no longer on the server is moved to the latest content', async () => {
    const store = new MemoryRunStore();
    const app = makeApp(store);
    const { body } = await createRun(app);
    await store.update(body.runId, async (record) => ({
      record: { ...record, state: { ...record.state, contentVersion: '2000.01.01-old' } },
      value: null,
    }));
    const headers = auth(body.guestToken);
    const view = (await app.inject({ url: `/api/runs/${body.runId}`, headers })).json() as PublicRunView;
    expect(view.contentVersion).toBe(contents[0]!.contentVersion);
    const chosen = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/character`,
      headers,
      payload: { cardId: 'card_1', idempotencyKey: 'key-rebind-01', expectedRevision: 0 },
    });
    expect(chosen.statusCode).toBe(200);
    expect((chosen.json().view as PublicRunView).contentVersion).toBe(contents[0]!.contentVersion);
  });

  it('cannot skip phases (apply-job during CHARACTER_SELECTION → 409)', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${body.runId}/apply-job`,
      headers: auth(body.guestToken),
      payload: { offerId: 'offer_r0_1', idempotencyKey: 'key-skip-0001', expectedRevision: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_PHASE');
  });
});

describe('job application → NPC team, persisted across reconnect', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('applies until hired, then serves the same NPCs after a fresh server/store instance', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'company-life-test-'));
    dirs.push(dir);
    const app = makeApp(new FileRunStore(dir));
    const { body } = await createRun(app, 'Alex', 'UNSPECIFIED');
    const headers = auth(body.guestToken);
    let view = (
      await app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/character`,
        headers,
        payload: { cardId: 'card_1', idempotencyKey: 'key-char-0001', expectedRevision: 0 },
      })
    ).json().view as PublicRunView;
    view = (
      await app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/goal`,
        headers,
        payload: { goalId: view.lifeGoalOffers[0]!.id, idempotencyKey: 'key-goal-0001', expectedRevision: 1 },
      })
    ).json().view as PublicRunView;
    expect(view.phase).toBe('JOB_OFFERS');

    // 가장 합격률이 높은 카드에 반복 지원 — 연속 불합격 시 추천 카드가 나오므로 반드시 종료된다
    for (let attempt = 0; view.phase === 'JOB_OFFERS' && attempt < 30; attempt++) {
      const best = [...view.jobOffers].sort((a, b) => b.hireChancePercent - a.hireChancePercent)[0]!;
      expect(best.hireChancePercent).toBeGreaterThanOrEqual(5);
      const res = await app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/apply-job`,
        headers,
        payload: {
          offerId: best.offerId,
          idempotencyKey: `key-apply-${attempt}-x`,
          expectedRevision: view.revision,
        },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { view: PublicRunView; result: { hired: boolean } };
      expect(out.result).not.toHaveProperty('roll');
      view = out.view;
    }
    expect(view.phase).toBe('MONTH_START');
    expect(view.employment.status).toBe('EMPLOYED');
    expect(view.npcs).toHaveLength(3);
    expect(view.npcs.filter((n) => n.role === 'BOSS')).toHaveLength(1);
    expect(JSON.stringify(view.npcs)).not.toMatch(/"trust"|"favor"|"rivalry"/);

    // 재접속: 새 저장소/서버 인스턴스에서도 같은 상태
    const app2 = makeApp(new FileRunStore(dir));
    const reloaded = (await app2.inject({ url: `/api/runs/${body.runId}`, headers })).json() as PublicRunView;
    expect(reloaded).toEqual(view);
    const npcs = (await app2.inject({ url: `/api/runs/${body.runId}/npcs`, headers })).json();
    expect(npcs.npcs).toEqual(view.npcs);
    const skills = (await app2.inject({ url: `/api/runs/${body.runId}/skills`, headers })).json();
    expect(skills).toEqual({ skills: [], history: [] });
    const neg = (await app2.inject({ url: `/api/runs/${body.runId}/negative-traits`, headers })).json();
    expect(neg).toEqual({ negativeTraits: [], history: [] });
  });

  it('serializes concurrent duplicate submissions so the effect applies once', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    const req = () =>
      app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/character`,
        headers: auth(body.guestToken),
        payload: { cardId: 'card_1', idempotencyKey: 'key-double-click', expectedRevision: 0 },
      });
    const [a, b] = await Promise.all([req(), req()]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    const now = (await app.inject({ url: `/api/runs/${body.runId}`, headers: auth(body.guestToken) })).json();
    expect(now.revision).toBe(1);
  });
});

describe('monthly loop and game over over HTTP (§26)', () => {
  /** 카드 선택 → 첫 카드 지원(첫 구직은 항상 입사로 끝남)까지 진행 */
  async function employed(store: MemoryRunStore) {
    const app = makeApp(store);
    const { body } = await createRun(app);
    const headers = auth(body.guestToken);
    let key = 0;
    const post = async (url: string, payload: Record<string, unknown>, revision: number) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/runs/${body.runId}/${url}`,
        headers,
        payload: { ...payload, idempotencyKey: `key-flow-${key++}`, expectedRevision: revision },
      });
      return { status: res.statusCode, json: res.json() as { view: PublicRunView; code?: string } };
    };
    const chosen = await post('character', { cardId: 'card_1' }, 0);
    const goal = await post('goal', { goalId: chosen.json.view.lifeGoalOffers[0]!.id }, 1);
    expect(goal.status).toBe(200);
    const hired = await post('apply-job', { offerId: goal.json.view.jobOffers[0]!.offerId }, 2);
    expect(hired.json.view.phase).toBe('MONTH_START');
    return { app, runId: body.runId, headers, post };
  }

  it('start-month → choose → next-month advances one month; stale occurrenceId → 409', async () => {
    const { app, runId, headers, post } = await employed(new MemoryRunStore());
    const started = await post('start-month', {}, 3);
    expect(started.status).toBe(200);
    const view = started.json.view;
    expect(view.phase).toBe('EVENT_PENDING');
    const event = (await app.inject({ url: `/api/runs/${runId}/current-event`, headers })).json().activeEvent;
    expect(event.occurrenceId).toBe(view.activeEvent!.occurrenceId);
    expect(JSON.stringify(event)).not.toMatch(/"chance"|baseChance/);

    const choice = view.activeEvent!.choices.find((c) => c.enabled)!;
    const stale = await post('choose', { occurrenceId: 'occ_wrong', choiceId: choice.id }, 4);
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('STALE_EVENT');

    // 업무 사건 → 일상 사건 순으로 두 번 고른다
    let chosen = await post('choose', { occurrenceId: event.occurrenceId, choiceId: choice.id }, 4);
    let revision = 5;
    expect(chosen.json.view.lastStory?.slot).toBe('work');
    while (chosen.json.view.phase === 'EVENT_PENDING' && !chosen.json.view.pendingEnding) {
      const ev = chosen.json.view.activeEvent!;
      const c = ev.choices.find((x) => x.enabled && !x.fatalWarning) ?? ev.choices.find((x) => x.enabled)!;
      chosen = await post('choose', { occurrenceId: ev.occurrenceId, choiceId: c.id }, revision++);
    }
    expect(chosen.json.view.phase).toBe('MONTH_SUMMARY');
    expect(chosen.json.view.monthSummary?.netSalary).toBeGreaterThan(0);
    expect(chosen.json.view.monthSummary?.events.length).toBeGreaterThanOrEqual(1);

    const result = await app.inject({ url: `/api/runs/${runId}/result`, headers });
    expect(result.statusCode).toBe(409);

    const next = await post('next-month', {}, revision);
    if (!chosen.json.view.pendingEnding) {
      expect(next.json.view.phase).toBe('MONTH_START');
      expect(next.json.view.turn.turnIndex).toBe(1);
    }
  });

  it('S7 transfer: only in MONTH_SUMMARY with an offer (otherwise 409/400)', async () => {
    const { post } = await employed(new MemoryRunStore());
    const early = await post('transfer', { decision: 'accept' }, 3);
    expect(early.status).toBe(409);
    expect(early.json.code).toBe('INVALID_PHASE');
    const bad = await post('transfer', { decision: 'maybe' }, 3);
    expect(bad.status).toBe(400);
  });

  it('health 0 → 과로 실직 엔딩, 이후 모든 쓰기 409, 결과는 재조회해도 동일', async () => {
    const store = new MemoryRunStore();
    const { app, runId, headers, post } = await employed(store);
    // 테스트 픽스처: 체력을 1로 낮춘 뒤 다음 달을 진행 (저장소 직접 조작은 테스트에서만)
    await store.update(runId, async (record) => ({
      record: { ...record, state: { ...record.state, resources: { ...record.state.resources, health: 1 } } },
      value: null,
    }));
    let revision = 3;
    let view: PublicRunView | undefined;
    // 체력 1 상태에서 체력이 깎이는 선택이 나올 때까지 진행 (자연 회복 +1이 있으므로 확정 경고 선택지를 고른다)
    for (let month = 0; month < 40; month++) {
      view = (await post('start-month', {}, revision++)).json.view;
      while (view.phase === 'EVENT_PENDING' && !view.pendingEnding) {
        const choices: PublicChoice[] = view.activeEvent!.choices;
        const fatal = choices.find((c) => c.enabled && c.fatalWarning);
        const pick = fatal ?? choices.find((c) => c.enabled)!;
        view = (
          await post(
            'choose',
            { occurrenceId: view.activeEvent!.occurrenceId, choiceId: pick.id },
            revision++,
          )
        ).json.view;
      }
      if (view.pendingEnding) break;
      await store.update(runId, async (record) => ({
        record: {
          ...record,
          state: { ...record.state, resources: { ...record.state.resources, health: 1 } },
        },
        value: null,
      }));
      view = (await post('next-month', {}, revision++)).json.view;
    }
    expect(view!.pendingEnding).not.toBeNull();
    const over = (await post('next-month', {}, revision++)).json.view;
    expect(over.phase).toBe('GAME_OVER');
    // 예고된 엔딩이 그대로 확정된다. 별명·연대기는 확정 후에만 공개 (S9)
    expect(view!.pendingEnding!.titles).toBeNull();
    expect(view!.pendingEnding!.chronicle).toBeNull();
    expect({ ...over.ending, titles: null, chronicle: null }).toEqual(view!.pendingEnding);
    expect(over.ending!.titles!.main.id).toMatch(/^title_/);
    expect(over.ending!.chronicle!.eras.length).toBeGreaterThan(0);

    for (const url of ['start-month', 'next-month']) {
      const res = await post(url, {}, revision);
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('INVALID_PHASE');
    }
    const result = (await app.inject({ url: `/api/runs/${runId}/result`, headers })).json();
    expect(result.ending).toEqual(over.ending);
  });
});

describe('playtest tools over HTTP', () => {
  it('do not exist unless enabled (404), and status reports disabled', async () => {
    const app = makeApp();
    const { body } = await createRun(app);
    expect((await app.inject({ url: '/api/playtest/status' })).json()).toEqual({ enabled: false });
    expect((await app.inject({ url: '/api/playtest/catalog' })).statusCode).toBe(404);
    const patch = await app.inject({
      method: 'POST',
      url: `/api/playtest/runs/${body.runId}/patch`,
      headers: auth(body.guestToken),
      payload: { resources: { health: 1 }, idempotencyKey: 'key-pt-0001', expectedRevision: 0 },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('when enabled: owner-only, revision-checked, and mark the run as modified', async () => {
    const app = buildApp({ store: new MemoryRunStore(), contents, playtestTools: true });
    const { body } = await createRun(app);
    const headers = auth(body.guestToken);
    const post = (url: string, payload: Record<string, unknown>, h = headers) =>
      app.inject({ method: 'POST', url: `/api/${url}`, headers: h, payload });

    await post(`runs/${body.runId}/character`, {
      cardId: 'card_1',
      idempotencyKey: 'key-pt-c1',
      expectedRevision: 0,
    });
    const goalId = ((await app.inject({ url: `/api/runs/${body.runId}`, headers })).json() as PublicRunView)
      .lifeGoalOffers[0]!.id;
    await post(`runs/${body.runId}/goal`, { goalId, idempotencyKey: 'key-pt-g1', expectedRevision: 1 });
    const offers = (await app.inject({ url: `/api/runs/${body.runId}/job-offers`, headers })).json()
      .jobOffers;
    await post(`runs/${body.runId}/apply-job`, {
      offerId: offers[2].offerId,
      idempotencyKey: 'key-pt-a1',
      expectedRevision: 2,
    });

    const forbidden = await post(
      `playtest/runs/${body.runId}/patch`,
      { resources: { health: 3 }, idempotencyKey: 'key-pt-x1', expectedRevision: 3 },
      auth('wrong-token'),
    );
    expect(forbidden.statusCode).toBe(403);

    // S11 월 시작에 기본 행동(휴식)의 회복이 더해지므로 체력을 바닥 가까이로
    const patched = await post(`playtest/runs/${body.runId}/patch`, {
      resources: { health: 1 },
      idempotencyKey: 'key-pt-p1',
      expectedRevision: 3,
    });
    expect(patched.statusCode).toBe(200);
    const view = patched.json().view as PublicRunView;
    expect(view.resources.health).toBe(1);
    expect(view.playtestModified).toBe(true);
    expect(view.warnings.map((w) => w.code)).toContain('HEALTH_CRITICAL');

    const forced = await post(`playtest/runs/${body.runId}/force-event`, {
      eventId: 'evt_server_outage',
      idempotencyKey: 'key-pt-f1',
      expectedRevision: 4,
    });
    const fv = forced.json().view as PublicRunView;
    expect(fv.phase).toBe('EVENT_PENDING');
    expect(fv.activeEvent?.choices.find((c) => c.id === 'first_response')?.fatalWarning).toBe(
      '⚠ 선택 시 과로 실직',
    );

    const debug = (await app.inject({ url: `/api/playtest/runs/${body.runId}/debug`, headers })).json();
    // 기본 40% ± 배경 특성 보정(천재형 +10, 압박에 약함 −10) + 보통 난이도 보정(−3)
    expect([27, 37, 47]).toContain(
      debug.activeEventChoices.find((c: { id: string }) => c.id === 'first_response').exactChancePercent,
    );
  });
});

describe('S10 플레이어 도감·난이도 over HTTP', () => {
  /** 플레이어 토큰으로 판을 만들고, 체력을 1로 눌러 과로 실직 엔딩까지 진행 */
  async function finishRun(app: ReturnType<typeof makeApp>, store: MemoryRunStore, playerToken?: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: playerToken ? { 'x-player-token': playerToken } : {},
      payload: { displayName: '김하늘', gender: 'FEMALE', difficulty: 'REAL' },
    });
    const body = created.json() as CreateRunResponse;
    const headers = auth(body.guestToken);
    let revision = 0;
    let key = 0;
    const post = async (url: string, payload: Record<string, unknown>) =>
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs/${body.runId}/${url}`,
          headers,
          payload: { ...payload, idempotencyKey: `s10-${body.runId}-${key++}`, expectedRevision: revision++ },
        })
      ).json().view as PublicRunView;
    let view = await post('character', { cardId: 'card_1' });
    view = await post('goal', { goalId: view.lifeGoalOffers[0]!.id });
    view = await post('apply-job', { offerId: view.jobOffers[0]!.offerId });
    const lowHealth = () =>
      store.update(body.runId, async (record) => ({
        record: {
          ...record,
          state: { ...record.state, resources: { ...record.state.resources, health: 1 } },
        },
        value: null,
      }));
    for (let month = 0; month < 40 && view.phase !== 'GAME_OVER'; month++) {
      await lowHealth();
      view = await post('start-month', {});
      while (view.phase === 'EVENT_PENDING' && !view.pendingEnding) {
        const choices: PublicChoice[] = view.activeEvent!.choices;
        const pick = choices.find((c) => c.enabled && c.fatalWarning) ?? choices.find((c) => c.enabled)!;
        view = await post('choose', { occurrenceId: view.activeEvent!.occurrenceId, choiceId: pick.id });
      }
      view = await post('next-month', {});
    }
    return { body, view };
  }

  it('판 생성: 플레이어 토큰을 주고, 같은 토큰이면 같은 플레이어. 난이도는 검증·고정된다', async () => {
    const app = makeApp();
    const first = (await createRun(app)).body;
    expect(first.playerToken).toMatch(/^[0-9a-f-]{36}\./);
    expect(first.view.difficulty).toBe('NORMAL');
    const again = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { 'x-player-token': first.playerToken },
      payload: { displayName: '김하늘', gender: 'FEMALE', difficulty: 'EASY' },
    });
    const body = again.json() as CreateRunResponse;
    expect(body.playerToken).toBe(first.playerToken);
    expect(body.view.difficulty).toBe('EASY');
    expect(body.view.difficultyLabel).toBe('쉬움');
    // 쉬움은 시작 현금 보너스가 카드에 바로 보인다
    expect(body.view.characterCards[0]!.cash).toBeGreaterThan(first.view.characterCards[0]!.cash);
    // 위조 토큰은 새 플레이어
    const forged = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { 'x-player-token': `${first.playerToken.split('.')[0]}.forged` },
      payload: { displayName: '김하늘', gender: 'FEMALE' },
    });
    expect((forged.json() as CreateRunResponse).playerToken).not.toBe(first.playerToken);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { displayName: '김하늘', gender: 'FEMALE', difficulty: 'NIGHTMARE' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('엔딩이 확정되면 서버가 도감·업적을 기록하고, 같은 판은 두 번 세지 않는다', async () => {
    const store = new MemoryRunStore();
    const app = makeApp(store);
    const { body, view } = await finishRun(app, store);
    expect(view.phase).toBe('GAME_OVER');
    const get = async () =>
      (
        await app.inject({
          url: `/api/player?run=${body.runId}`,
          headers: { 'x-player-token': body.playerToken },
        })
      ).json();
    const col = await get();
    expect(col.runsFinished).toBe(1);
    const endings = col.categories.find((c: { key: string }) => c.key === 'endings');
    expect(endings.found).toBe(1);
    const seen = endings.items.find((i: { found: boolean }) => i.found);
    expect(seen.difficulties).toEqual(['현실']);
    expect(col.achievements.find((a: { id: string }) => a.id === 'ach_first_run').done).toBe(true);
    // 이번 판의 새 발견: 엔딩·업적
    expect(col.discovery.items.some((i: { category: string }) => i.category === '엔딩')).toBe(true);
    expect(col.discovery.achievements.map((a: { id: string }) => a.id)).toContain('ach_first_run');
    // 재조회는 그대로, 끝난 판에 쓰기는 409
    expect((await get()).runsFinished).toBe(1);
    // 토큰 없이 조회하면 빈 도감 (남의 도감은 볼 수 없음)
    const anon = (await app.inject({ url: '/api/player' })).json();
    expect(anon.runsFinished).toBe(0);
    expect(anon.found).toBe(0);
    expect(anon.total).toBe(85);
  }, 30_000);
});
