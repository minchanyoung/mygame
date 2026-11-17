import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';
import { Barcode, Icon, IconBadge, Silhouette, STAT_STYLE } from './Icons';

const DANGER = 20;

/** 사원증: 이름·직급·회사·입사·연봉·보유 특성 */
export function EmployeeBadge({ view }: { view: PublicRunView }) {
  const e = view.employment;
  const traits = [
    ...view.skills.map((t) => ({ ...t, bad: false })),
    ...view.negativeTraits.map((t) => ({ ...t, bad: true })),
  ];
  return (
    <div className="card badge">
      <div className="badge-strap" />
      <div className="badge-top">
        <span>EMPLOYEE ID</span>
        <span className="badge-hole" />
      </div>
      <div className="badge-body">
        <div className="badge-photo" style={{ color: 'var(--navy)' }}>
          <Silhouette />
        </div>
        <div className="badge-info">
          <div>
            <span className="badge-name">{view.profile.displayName}</span>{' '}
            {e.rankLabel && <span className="badge-rank">{e.rankLabel}</span>}
          </div>
          <span className="small" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
            {e.companyName ?? '무소속'}
            {e.jobLabel && ` · ${e.jobLabel}팀`}
          </span>
          {e.startedAge !== null && (
            <span className="tiny muted">
              입사 {e.startedAge}세 {e.startedMonth}월
              {e.annualSalary !== null && ` · 연봉 ${formatKrw(e.annualSalary)}`}
              {e.lastReviewGrade && ` · 최근 평가 ${e.lastReviewGrade}`}
            </span>
          )}
          <div className="badge-chips">
            {e.grade && <span className={`chip chip-pill grade-chip-${e.grade}`}>{e.grade}등급 회사</span>}
            {e.probationMonthsLeft !== null && (
              <span className="chip chip-pill chip-accent">수습 {e.probationMonthsLeft}개월 남음</span>
            )}
            {e.transfers > 0 && <span className="chip chip-pill">이직 {e.transfers}회</span>}
            {traits.map((t) => (
              <span key={t.id} className={`chip chip-pill ${t.bad ? 'chip-danger' : 'chip-trait'}`}>
                {t.name} Lv.{t.level}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="badge-foot">
        <span style={{ color: 'var(--ink)' }}>
          <Barcode seed={view.runId} />
        </span>
        <span>NO. {view.runId.slice(0, 8).toUpperCase()}</span>
      </div>
    </div>
  );
}

/** S5 커리어: 다음 승진까지(근속·포인트) + 인생 목표 진행 */
export function CareerCard({ view }: { view: PublicRunView }) {
  const p = view.employment.promotion;
  const g = view.lifeGoal;
  if (!p && !g) return null;
  const pct = (cur: number, max: number) => (max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 100);
  return (
    <div className="card career" style={{ gap: 10 }}>
      {p && (
        <div className="career-row">
          <div className="career-head">
            <strong className="small">
              {p.nextRankLabel ? `다음 승진 · ${p.nextRankLabel}` : '최고 직급 달성'}
            </strong>
            {p.nextRankLabel && (
              <span className={`chip ${p.blocked ? 'chip-danger' : p.eligible ? 'chip-trait' : ''}`}>
                {p.blocked ? '성과 개선 중 · 심사 보류' : p.eligible ? '1월 심사 대상' : '준비 중'}
              </span>
            )}
          </div>
          {p.nextRankLabel && (
            <div className="career-bars">
              <div>
                <span className="tiny muted">
                  근속 {p.yearsInRank}/{p.minYears}년
                </span>
                <div className="mini-bar" aria-hidden="true">
                  <span style={{ width: `${pct(p.yearsInRank, p.minYears)}%` }} />
                </div>
              </div>
              <div>
                <span className="tiny muted">
                  승진 포인트 {p.points}/{p.requiredPoints}
                </span>
                <div className="mini-bar" aria-hidden="true">
                  <span style={{ width: `${pct(p.points, p.requiredPoints)}%` }} />
                </div>
              </div>
            </div>
          )}
          {p.nextRankLabel && (
            <span className="tiny muted">
              연말 평가 등급과 큰 성과로 포인트가 쌓여요. 조건을 채우면 1월에 심사.
            </span>
          )}
        </div>
      )}
      {g && (
        <div className="career-row">
          <div className="career-head">
            <strong className="small">
              <span aria-hidden="true">{g.emoji}</span> 인생 목표 · {g.title}
            </strong>
            <span className="tiny muted">{g.percent}%</span>
          </div>
          <div className="mini-bar mini-bar-goal" aria-hidden="true">
            <span style={{ width: `${g.percent}%` }} />
          </div>
          <span className="tiny muted">{g.progressLabel}</span>
        </div>
      )}
    </div>
  );
}

/** 자원 4개. 20 이하는 색과 함께 '위험' 글자로도 표시 (§10.2) */
export function Gauges({ view }: { view: PublicRunView }) {
  return (
    <div className="gauges">
      {RESOURCE_KEYS.map((k) => {
        const v = view.resources[k];
        const danger = v <= DANGER;
        return (
          <div key={k} className={`gauge ${danger ? 'gauge-danger' : ''}`}>
            <div className="gauge-head">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IconBadge
                  name={STAT_STYLE[k].icon}
                  color={danger ? 'var(--stamp)' : STAT_STYLE[k].color}
                  size={30}
                />
                <span className="small" style={{ fontWeight: 700 }}>
                  {RESOURCE_LABELS[k]}
                </span>
              </span>
              <span className="gauge-value">{v}</span>
            </div>
            <div className="gauge-bar" aria-hidden="true">
              <span style={{ width: `${v}%`, background: danger ? undefined : STAT_STYLE[k].color }} />
            </div>
            <span className="gauge-note">{danger ? '위험' : ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MoneyRow({ view }: { view: PublicRunView }) {
  return (
    <div className="money-tiles">
      <div className="money-tile">
        <IconBadge name="cash" color="var(--c-cash)" size={28} />
        <span className="tiny muted">현금</span>
        <strong className="num">{formatKrw(view.cash)}</strong>
      </div>
      <div className="money-tile">
        <IconBadge name="debt" color="var(--c-debt)" size={28} />
        <span className="tiny muted">빚</span>
        <strong className="num">{formatKrw(view.debt)}</strong>
      </div>
      <div className="money-tile">
        <IconBadge name="worth" color="var(--navy)" size={28} />
        <span className="tiny muted">순자산</span>
        <strong className={`num ${view.netWorth < 0 ? 'neg' : ''}`}>
          {view.netWorth < 0 ? `−${formatKrw(-view.netWorth)}` : formatKrw(view.netWorth)}
        </strong>
      </div>
    </div>
  );
}

/** 이전 화면 호환: 게이지 + 돈 */
export function StatusPanel({ view }: { view: PublicRunView }) {
  return (
    <div className="screen">
      <Gauges view={view} />
      <MoneyRow view={view} />
    </div>
  );
}

export function Warnings({ view }: { view: PublicRunView }) {
  if (view.warnings.length === 0) return null;
  return (
    <div className="banner banner-error" role="alert">
      <Icon name="warning" />
      <ul className="warning-list">
        {view.warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** 1년 달력: 지난달·이번 달·예약 사건(?)·12월 평가 */
export function YearCalendar({ view }: { view: PublicRunView }) {
  const c = view.calendar;
  const scheduled = c.months.filter((m) => m.scheduled).map((m) => `${m.month}월`);
  return (
    <div className="card" style={{ gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span className="tiny" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>
          올해 ({c.age}세)
        </span>
        <span className="tiny muted">
          12월 연말 평가{scheduled.length > 0 && ` · ${scheduled.join(', ')} 예정된 일`}
        </span>
      </div>
      <div className="calendar" role="list" aria-label="올해 달력">
        {c.months.map((m) => {
          const cls =
            m.status === 'PAST'
              ? 'cal-past'
              : m.status === 'CURRENT'
                ? 'cal-current'
                : m.scheduled
                  ? 'cal-scheduled'
                  : '';
          const label =
            m.status === 'FUTURE' && m.scheduled ? '?' : m.review && m.status === 'FUTURE' ? '평가' : m.month;
          return (
            <div
              key={m.month}
              role="listitem"
              className={`cal-cell ${cls}`}
              aria-label={`${m.month}월${m.status === 'CURRENT' ? ' (이번 달)' : ''}${m.scheduled ? ' (예정된 일)' : ''}`}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
