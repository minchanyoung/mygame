import type { MonthlyAction, PublicActionResult, PublicMonthlyActions } from '@company-life/shared';

/** S11 출근 화면: 이번 달 퇴근 후 행동 고르기 (가로 스크롤 카드 + 고른 행동 설명) */
export function ActionPicker({
  actions,
  value,
  disabled,
  onChange,
}: {
  actions: PublicMonthlyActions;
  value: MonthlyAction;
  disabled: boolean;
  onChange: (id: MonthlyAction) => void;
}) {
  const current = actions.options.find((o) => o.id === value);
  return (
    <section className="card action-picker" aria-labelledby="action-picker-title">
      <div className="action-picker-head">
        <strong id="action-picker-title">이번 달 퇴근 후엔?</strong>
        {actions.habits.length > 0 && (
          <span className="tiny muted">{actions.habits.map((h) => `✓ ${h}`).join(' · ')}</span>
        )}
      </div>
      <div className="action-scroll" role="radiogroup" aria-labelledby="action-picker-title">
        {actions.options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`action-card ${on ? 'action-on' : ''} ${o.locked ? 'action-locked' : ''}`}
              disabled={disabled || o.locked !== null}
              onClick={() => onChange(o.id)}
            >
              <span className="action-emoji" aria-hidden="true">
                {o.emoji}
              </span>
              <strong className="small">{o.name}</strong>
              <span className="action-effects tiny">
                {o.effects.map((e) => (
                  <span key={e} className={e.includes('−') ? 'neg' : 'pos'}>
                    {e}
                  </span>
                ))}
                {o.costLabel && <span className="neg">현금 {o.costLabel}</span>}
              </span>
              {o.locked ? (
                <span className="tiny action-lock">🔒 {o.locked}</span>
              ) : (
                o.warn && (
                  <span className="tiny action-warn" aria-hidden="true">
                    ⚠ 주의
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      {current && (
        <p className="small action-detail" aria-live="polite">
          <span>
            {current.emoji} <strong>{current.name}</strong> — {current.description}
          </span>
          {current.progress && (
            <span className={`tiny ${current.warn ? 'action-warn' : 'muted'}`}>{current.progress}</span>
          )}
        </p>
      )}
    </section>
  );
}

/** '나' 탭: 최근 12개월 동안 무엇에 시간을 썼나 */
export function ActionHistory({ actions }: { actions: PublicMonthlyActions }) {
  if (actions.recent.length === 0) return null;
  const counts = new Map<string, { emoji: string; name: string; n: number }>();
  for (const r of actions.recent) {
    const c = counts.get(r.actionId) ?? { emoji: r.emoji, name: r.name, n: 0 };
    c.n++;
    counts.set(r.actionId, c);
  }
  return (
    <div className="card">
      <strong>최근 퇴근 후</strong>
      <ol className="action-strip" aria-label="최근 12개월 행동">
        {actions.recent.map((r) => (
          <li key={`${r.age}-${r.month}`} title={`${r.age}세 ${r.month}월 · ${r.name}`}>
            <span aria-hidden="true">{r.emoji}</span>
            <span className="tiny muted">{r.month}월</span>
            <span className="sr-only">
              {r.age}세 {r.month}월 {r.name}
            </span>
          </li>
        ))}
      </ol>
      <p className="tiny muted">
        {[...counts.values()]
          .sort((a, b) => b.n - a.n)
          .map((c) => `${c.emoji} ${c.name} ${c.n}개월`)
          .join(' · ')}
      </p>
      {actions.habits.length > 0 && <p className="tiny">{actions.habits.map((h) => `✓ ${h}`).join(' · ')}</p>}
    </div>
  );
}

/** 결산: 이번 달 행동의 결과 */
export function ActionResultCard({ result }: { result: PublicActionResult }) {
  return (
    <div className="card action-result" aria-label="이번 달 퇴근 후">
      <span className="tiny muted" style={{ fontWeight: 700 }}>
        이번 달 퇴근 후
      </span>
      <strong>
        {result.emoji} {result.name}
      </strong>
      {result.lines.length > 0 && <p className="small">{result.lines.join(' · ')}</p>}
      {result.notes.map((n) => (
        <p key={n} className="tiny muted">
          {n}
        </p>
      ))}
      {result.traitGains.map((t) => (
        <p key={t} className={`small ${t.startsWith('상처') ? 'action-scar' : 'action-gain'}`} role="status">
          {t.startsWith('상처') ? '🩹' : '✨'} {t}
        </p>
      ))}
    </div>
  );
}
