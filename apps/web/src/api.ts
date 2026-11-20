import {
  GUEST_TOKEN_HEADER,
  PLAYER_TOKEN_HEADER,
  type ApiErrorBody,
  type CreateRunResponse,
  type DailyBoard,
  type Difficulty,
  type Gender,
  type PublicCollection,
  type PlaytestCatalog,
  type PlaytestDebugView,
  type PublicRunView,
} from '@company-life/shared';

/** 클라이언트는 서버가 확정한 공개 뷰만 표시하고, 서버 발급 ID만 제출한다. */

export interface Session {
  runId: string;
  guestToken: string;
}

const SESSION_KEY = 'company-life.session';
/** S10 여러 판을 잇는 플레이어 토큰 (도감·업적). 판 세션과 따로 보관하고 지우지 않는다 */
const PLAYER_KEY = 'company-life.player';

export function loadPlayerToken(): string | null {
  try {
    return localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
}

function savePlayerToken(token: string): void {
  try {
    localStorage.setItem(PLAYER_KEY, token);
  } catch {
    // 저장할 수 없으면 이번 판만 도감에 쌓이고 다음 판은 새 플레이어가 된다
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 저장소 사용 불가(사생활 보호 모드 등)여도 현재 세션은 계속 진행된다
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; player?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers[GUEST_TOKEN_HEADER] = init.token;
  const player = init.player ? loadPlayerToken() : null;
  if (player) headers[PLAYER_TOKEN_HEADER] = player;
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiRequestError(res.status, body as ApiErrorBody | null);
  return body as T;
}

export const api = {
  createRun: async (displayName: string, gender: Gender, difficulty: Difficulty, daily = false) => {
    const res = await request<CreateRunResponse>('/api/runs', {
      method: 'POST',
      player: true,
      body: JSON.stringify({ displayName, gender, difficulty, daily }),
    });
    savePlayerToken(res.playerToken);
    return res;
  },

  /** S10 도감·업적 (runId를 주면 그 판의 새 발견 포함) */
  getPlayer: (runId?: string) =>
    request<PublicCollection>(`/api/player${runId ? `?run=${encodeURIComponent(runId)}` : ''}`, {
      player: true,
    }),

  /** S21 오늘의 출근 순위 (내 기록은 플레이어 토큰으로) */
  getDaily: (date?: string) =>
    request<DailyBoard>(`/api/daily${date ? `?date=${encodeURIComponent(date)}` : ''}`, { player: true }),

  getRun: (s: Session) => request<PublicRunView>(`/api/runs/${s.runId}`, { token: s.guestToken }),

  chooseCharacter: (s: Session, cardId: string, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/character`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ cardId, expectedRevision, idempotencyKey }),
    }),

  chooseGoal: (s: Session, goalId: string, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/goal`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ goalId, expectedRevision, idempotencyKey }),
    }),

  transfer: (s: Session, decision: 'accept' | 'decline', expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/transfer`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ decision, expectedRevision, idempotencyKey }),
    }),

  applyJob: (s: Session, offerId: string, expectedRevision: number, idempotencyKey: string) =>
    request<{
      view: PublicRunView;
      result: { hired: boolean; companyName: string | null; joinedCompanyName: string | null };
    }>(`/api/runs/${s.runId}/apply-job`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ offerId, expectedRevision, idempotencyKey }),
    }),

  startMonth: (s: Session, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/start-month`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ expectedRevision, idempotencyKey }),
    }),

  choose: (
    s: Session,
    occurrenceId: string,
    choiceId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/choose`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ occurrenceId, choiceId, expectedRevision, idempotencyKey }),
    }),

  nextMonth: (s: Session, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/next-month`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ expectedRevision, idempotencyKey }),
    }),
};

/** 플레이테스트 도구 (서버가 PLAYTEST_TOOLS=1일 때만 동작) */
export const playtestApi = {
  status: () => request<{ enabled: boolean }>('/api/playtest/status'),
  catalog: () => request<PlaytestCatalog>('/api/playtest/catalog'),
  debug: (s: Session) =>
    request<PlaytestDebugView>(`/api/playtest/runs/${s.runId}/debug`, { token: s.guestToken }),
  patch: (s: Session, patch: Record<string, unknown>, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/playtest/runs/${s.runId}/patch`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ ...patch, expectedRevision, idempotencyKey }),
    }),
  forceEvent: (s: Session, eventId: string, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/playtest/runs/${s.runId}/force-event`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ eventId, expectedRevision, idempotencyKey }),
    }),
};

/**
 * 요청 고유 키 (UUID v4 형식).
 * crypto.randomUUID는 https·localhost에서만 있다 — 같은 와이파이의 휴대폰(http://192.168.x.x)으로
 * 접속하면 없어서 모든 버튼이 '네트워크 오류'가 됐다. getRandomValues는 어디서나 된다.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const formatKrw = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`;
