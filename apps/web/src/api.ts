import {
  GUEST_TOKEN_HEADER,
  type ApiErrorBody,
  type CreateRunResponse,
  type Gender,
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

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers[GUEST_TOKEN_HEADER] = init.token;
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiRequestError(res.status, body as ApiErrorBody | null);
  return body as T;
}

export const api = {
  createRun: (displayName: string, gender: Gender) =>
    request<CreateRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ displayName, gender }),
    }),

  getRun: (s: Session) => request<PublicRunView>(`/api/runs/${s.runId}`, { token: s.guestToken }),

  chooseCharacter: (s: Session, cardId: string, expectedRevision: number, idempotencyKey: string) =>
    request<{ view: PublicRunView }>(`/api/runs/${s.runId}/character`, {
      method: 'POST',
      token: s.guestToken,
      body: JSON.stringify({ cardId, expectedRevision, idempotencyKey }),
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

export const newIdempotencyKey = (): string => crypto.randomUUID();

export const formatKrw = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`;
