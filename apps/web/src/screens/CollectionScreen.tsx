import { useEffect, useState } from 'react';
import type { PublicCollection } from '@company-life/shared';
import { api, ApiRequestError } from '../api';

interface Props {
  onBack: () => void;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};

/** S10 도감·업적: 지난 인생들에서 모은 것 */
export function CollectionScreen({ onBack }: Props) {
  const [data, setData] = useState<PublicCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('titles');

  useEffect(() => {
    api
      .getPlayer()
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiRequestError ? (e.body?.message ?? '불러오지 못했어요') : '네트워크 오류'),
      );
  }, []);

  if (error) {
    return (
      <section className="screen">
        <p className="banner banner-error">{error}</p>
        <button type="button" className="btn" onClick={onBack}>
          뒤로
        </button>
      </section>
    );
  }
  if (!data) return <p className="muted small">도감을 펼치는 중…</p>;

  const done = data.achievements.filter((a) => a.done).length;
  const percent = data.total ? Math.round((data.found / data.total) * 100) : 0;
  const category = data.categories.find((c) => c.key === tab);
  const tabs = [
    ...data.categories.map((c) => ({ key: c.key, label: c.label, count: `${c.found}/${c.total}` })),
    { key: 'achievements', label: '업적', count: `${done}/${data.achievements.length}` },
  ];

  return (
    <section className="screen">
      <h2>📔 도감</h2>
      <div className="card">
        <div className="career-head">
          <strong>
            수집률 {data.found}/{data.total}
          </strong>
          <span className="small muted">
            {percent}% · 완주한 인생 {data.runsFinished}번
          </span>
        </div>
        <div className="col-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        {data.runsFinished === 0 && (
          <p className="small muted">아직 끝까지 산 인생이 없어요. 한 번 끝까지 가면 여기에 쌓입니다.</p>
        )}
        <p className="tiny muted">
          이 브라우저에 저장된 기록이에요. 사이트 데이터를 지우면 처음부터 다시 모읍니다.
        </p>
      </div>

      <div className="col-tabs" role="tablist" aria-label="도감 분류">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`col-tab ${tab === t.key ? 'col-tab-on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tiny">{t.count}</span>
          </button>
        ))}
      </div>

      {category && (
        <ul className="col-grid" role="tabpanel">
          {category.items.map((it) => (
            <li key={it.id} className={`col-item ${it.found ? 'col-found' : 'col-hidden'}`}>
              <div className="col-item-head">
                {it.emoji && (
                  <span className="col-emoji" aria-hidden="true">
                    {it.found ? it.emoji : '❔'}
                  </span>
                )}
                <strong>{it.name}</strong>
                {it.tag && <span className="chip chip-pill">{it.tag}</span>}
              </div>
              <span className="small" style={{ color: it.found ? 'var(--ink-2)' : 'var(--muted)' }}>
                {it.text}
              </span>
              {it.found && it.firstAt && (
                <span className="tiny muted">
                  {it.count}번 · 처음 {fmtDate(it.firstAt)}
                  {it.difficulties.length > 0 && ` · ${it.difficulties.join('/')}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'achievements' && (
        <ul className="col-grid" role="tabpanel">
          {data.achievements.map((a) => (
            <li key={a.id} className={`col-item ${a.done ? 'col-found' : 'col-hidden'}`}>
              <div className="col-item-head">
                <span className="col-emoji" aria-hidden="true">
                  {a.done ? a.emoji : '🔒'}
                </span>
                <strong>{a.name}</strong>
              </div>
              <span className="small">{a.description}</span>
              {a.at && <span className="tiny muted">달성 {fmtDate(a.at)}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="action-bar">
        <button type="button" className="btn" onClick={onBack}>
          처음 화면
        </button>
      </div>
    </section>
  );
}
