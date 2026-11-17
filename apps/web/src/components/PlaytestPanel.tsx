import { useEffect, useState } from 'react';
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  type PlaytestCatalog,
  type PlaytestDebugView,
  type PublicRunView,
  type ResourceKey,
} from '@company-life/shared';
import { formatKrw, playtestApi, type Session } from '../api';

interface Props {
  session: Session;
  view: PublicRunView;
  busy: boolean;
  /** 서버 명령 실행 (idempotencyKey·오류 처리는 App이 담당) */
  run: (action: string, fn: (key: string) => Promise<PublicRunView>) => void;
}

/**
 * 🧪 플레이테스트 도구 — 서버가 PLAYTEST_TOOLS=1일 때만 표시된다.
 * 모든 조작은 서버가 검증·기록하며, 조작된 run은 영구적으로 '플레이테스트 기록'으로 표시된다.
 */
export function PlaytestPanel({ session, view, busy, run }: Props) {
  const [debug, setDebug] = useState<PlaytestDebugView | null>(null);
  const [catalog, setCatalog] = useState<PlaytestCatalog | null>(null);
  const [eventId, setEventId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const monthStart = view.phase === 'MONTH_START';

  useEffect(() => {
    playtestApi.catalog().then(setCatalog, () => setCatalog(null));
  }, []);
  useEffect(() => {
    playtestApi.debug(session).then(setDebug, () => setDebug(null));
  }, [session, view.revision]);

  const patch = (label: string, body: Record<string, unknown>) =>
    run(
      `playtest:${label}`,
      async (key) => (await playtestApi.patch(session, body, view.revision, key)).view,
    );

  const limit = debug?.debtLimit ?? null;
  const presets: Array<[string, Record<string, unknown>]> = [
    ['체력 1', { resources: { health: 1 } }],
    ['정신력 1', { resources: { mental: 1 } }],
    ['집중력 1', { resources: { focus: 1 } }],
    ['평판 1', { resources: { reputation: 1 } }],
    ['전부 100', { resources: { health: 100, mental: 100, focus: 100, reputation: 100 } }],
    ...(limit
      ? ([['부채 한계 직전', { debt: limit - 100_000 }]] as Array<[string, Record<string, unknown>]>)
      : []),
    ['49세로', { age: 49 }],
    ['50세로', { age: 50 }],
    ['59세로', { age: 59 }],
  ];

  const applyDraft = () => {
    const body: Record<string, unknown> = {};
    const resources: Partial<Record<ResourceKey, number>> = {};
    for (const k of RESOURCE_KEYS)
      if (draft[k] !== undefined && draft[k] !== '') resources[k] = Number(draft[k]);
    if (Object.keys(resources).length > 0) body['resources'] = resources;
    for (const k of ['cash', 'debt', 'age'] as const) {
      if (draft[k] !== undefined && draft[k] !== '') body[k] = Number(draft[k]);
    }
    if (Object.keys(body).length > 0) patch('custom', body);
  };

  const setTrait = (id: string, polarity: 'POSITIVE' | 'NEGATIVE', level: number) => {
    const current = Object.fromEntries(
      (polarity === 'POSITIVE' ? view.skills : view.negativeTraits).map((t) => [t.id, t.level]),
    );
    if (level === 0) delete current[id];
    else current[id] = level as 1 | 2;
    patch(`trait-${id}`, polarity === 'POSITIVE' ? { skills: current } : { negativeTraits: current });
  };
  const levelOf = (id: string) =>
    [...view.skills, ...view.negativeTraits].find((t) => t.id === id)?.level ?? 0;

  return (
    <details className="card playtest">
      <summary>
        <strong>🧪 플레이테스트 도구</strong>{' '}
        <span className="muted small">{view.playtestModified ? '조작된 기록' : '개발·검수 전용'}</span>
      </summary>

      {debug && debug.activeEventChoices.length > 0 && (
        <section>
          <h4>현재 사건 — 정확한 확률</h4>
          <ul className="small">
            {debug.activeEventChoices.map((c) => (
              <li key={c.id}>
                <strong>{c.label}</strong> {!c.visible && '(숨김)'} {!c.enabled && '(잠김)'}:{' '}
                {c.exactChancePercent === null ? '판정 없음' : `${c.exactChancePercent}%`}
                {c.breakdown.length > 0 && <span className="muted"> ({c.breakdown.join(', ')})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {debug && monthStart && (
        <section>
          <h4>이번 달 후보 사건 (추첨 확률)</h4>
          <ul className="small">
            {debug.eligibleEvents.map((e) => (
              <li key={e.eventId}>
                {e.title} — {e.chancePercent}% <span className="muted">(가중치 {e.weight})</span>
              </li>
            ))}
            {debug.eligibleEvents.length === 0 && <li>후보 없음 → 평온한 한 달</li>}
          </ul>
        </section>
      )}

      {debug && (
        <section>
          <h4>숨김 정보</h4>
          <ul className="small">
            {debug.npcs.map((n) => (
              <li key={n.name}>
                {n.name}({n.role === 'BOSS' ? '상사' : '동료'}, {n.personalityTags.join('+')}) 호감 {n.favor}{' '}
                · 신뢰 {n.trust} · 경쟁 {n.rivalry}
              </li>
            ))}
            <li>
              플래그:{' '}
              {debug.flags
                .map((f) => `${f.key}(${f.scope}${f.expiresTurn !== null ? `, ~${f.expiresTurn}턴` : ''})`)
                .join(', ') || '없음'}
            </li>
            {debug.debtLimit !== null && <li>부채 한계: {formatKrw(debug.debtLimit)}</li>}
            <li className="muted">seed {debug.seed}</li>
          </ul>
        </section>
      )}

      {monthStart ? (
        <>
          <section>
            <h4>빠른 조정</h4>
            <div className="chip-row">
              {presets.map(([label, body]) => (
                <button
                  key={label}
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => patch(label, body)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4>직접 입력</h4>
            <div className="grid-inputs">
              {[
                ...RESOURCE_KEYS.map((k) => [k, RESOURCE_LABELS[k]] as const),
                ['cash', '현금'] as const,
                ['debt', '빚'] as const,
                ['age', '나이'] as const,
              ].map(([k, label]) => (
                <label key={k} className="small">
                  {label}
                  <input
                    className="input input-small"
                    inputMode="numeric"
                    placeholder={String(
                      k === 'cash'
                        ? view.cash
                        : k === 'debt'
                          ? view.debt
                          : k === 'age'
                            ? view.turn.age
                            : view.resources[k],
                    )}
                    value={draft[k] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/[^0-9]/g, '') })}
                  />
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-small" disabled={busy} onClick={applyDraft}>
              적용
            </button>
          </section>

          {catalog && (
            <section>
              <h4>특성 레벨</h4>
              <div className="grid-inputs">
                {catalog.traits
                  .filter((t) => t.active)
                  .map((t) => (
                    <label key={t.id} className="small">
                      {t.polarity === 'POSITIVE' ? '👍' : '👎'} {t.name}
                      <select
                        className="input input-small"
                        value={levelOf(t.id)}
                        disabled={busy}
                        onChange={(e) => setTrait(t.id, t.polarity, Number(e.target.value))}
                      >
                        <option value={0}>없음</option>
                        <option value={1}>Lv.1</option>
                        <option value={2}>Lv.2</option>
                      </select>
                    </label>
                  ))}
              </div>
            </section>
          )}

          {catalog && (
            <section>
              <h4>사건 강제 발생</h4>
              <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">사건 선택…</option>
                {catalog.events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                    {e.special ? ' ★' : ''}
                    {e.highRisk ? ' ⚠' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || !eventId}
                onClick={() =>
                  run(
                    `playtest:force:${eventId}`,
                    async (key) => (await playtestApi.forceEvent(session, eventId, view.revision, key)).view,
                  )
                }
              >
                이 사건으로 이번 달 시작
              </button>
              <p className="muted small">
                ★ 특성 획득/변화 사건 · ⚠ 고위험 사건. 조건이 안 맞으면 서버가 거절합니다.
              </p>
            </section>
          )}
        </>
      ) : (
        view.phase !== 'GAME_OVER' && (
          <p className="muted small">상태 조정·사건 강제는 &lsquo;월 시작&rsquo; 화면에서 할 수 있어요.</p>
        )
      )}
    </details>
  );
}
