import type { PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { StatusPanel, Warnings } from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onStartMonth: () => void;
  onHome: () => void;
}

/** MONTH_START 대시보드: 상태 요약 → 이번 달 시작 */
export function Workplace({ view, busy, onStartMonth, onHome }: Props) {
  const e = view.employment;
  const skills = view.skills;
  const negatives = view.negativeTraits;
  return (
    <section className="screen">
      <div className="card">
        <div className="card-head">
          {e.grade && <span className={`grade grade-${e.grade}`}>{e.grade}</span>}
          <strong>{e.companyName ?? '무직'}</strong>
          {e.jobLabel && <span className="chip">{e.jobLabel}</span>}
          {e.rankLabel && <span className="chip">{e.rankLabel}</span>}
        </div>
        {e.annualSalary !== null && <p className="small">연봉 {formatKrw(e.annualSalary)}</p>}
      </div>

      <Warnings view={view} />
      <StatusPanel view={view} />

      <details className="card">
        <summary>
          <strong>우리 팀</strong> <span className="muted small">상사 1 · 동료 2</span>
        </summary>
        <ul className="npc-list">
          {view.npcs.map((n) => (
            <li key={n.npcId}>
              <strong>{n.name}</strong>{' '}
              <span className="chip">
                {n.roleLabel} · {n.rankLabel}
              </span>
              <p className="small">
                {n.personalities.map((p) => p.name).join(' · ')} — 관계: {n.relationLabel}
              </p>
            </li>
          ))}
        </ul>
      </details>

      <details className="card" open={skills.length + negatives.length > 0}>
        <summary>
          <strong>발견한 특성</strong>{' '}
          <span className="muted small">{skills.length + negatives.length}개</span>
        </summary>
        {skills.length + negatives.length === 0 ? (
          <p className="muted small">아직 없음 — 특별한 사건을 통해 얻게 됩니다.</p>
        ) : (
          <ul className="small trait-list">
            {skills.map((t) => (
              <li key={t.id}>
                👍{' '}
                <strong>
                  {t.name} Lv.{t.level}
                </strong>{' '}
                — {t.effect}
              </li>
            ))}
            {negatives.map((t) => (
              <li key={t.id}>
                👎{' '}
                <strong>
                  {t.name} Lv.{t.level}
                </strong>{' '}
                — {t.effect}
              </li>
            ))}
          </ul>
        )}
      </details>

      <div className="action-bar">
        <button type="button" className="btn" onClick={onHome} disabled={busy}>
          처음 화면
        </button>
        <button type="button" className="btn btn-primary" onClick={onStartMonth} disabled={busy}>
          {busy ? '진행 중…' : `${view.turn.monthOfYear}월 시작하기`}
        </button>
      </div>
    </section>
  );
}
