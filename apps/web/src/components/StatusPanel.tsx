import { useEffect, useRef } from 'react';
import { RESOURCE_KEYS, RESOURCE_LABELS, type PublicRunView, type ResourceKey } from '@company-life/shared';
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
        <div className="badge-photo navy">
          <Silhouette />
        </div>
        <div className="badge-info">
          <div>
            <span className="badge-name">{view.profile.displayName}</span>{' '}
            {e.rankLabel && <span className="badge-rank">{e.rankLabel}</span>}
          </div>
          <span className="small fw-5 ink-2">
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
            {view.difficulty !== 'NORMAL' && (
              <span className={`chip chip-pill difficulty-${view.difficulty}`}>
                난이도 {view.difficultyLabel}
              </span>
            )}
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
        <span className="ink">
          <Barcode seed={view.runId} />
        </span>
        <span>NO. {view.runId.slice(0, 8).toUpperCase()}</span>
      </div>
    </div>
  );
}

/** S5 커리어: 다음 승진까지(근속·포인트) + 인생 목표 진행 */
export function CareerCard({ view, compact = false }: { view: PublicRunView; compact?: boolean }) {
  const p = view.employment.promotion;
  const g = view.lifeGoal;
  if (!p && !g) return null;
  const pct = (cur: number, max: number) => (max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 100);
  return (
    <div className="card career gap-3">
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
          {p.nextRankLabel && !compact && (
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
          {!compact && <span className="tiny muted">{g.progressLabel}</span>}
        </div>
      )}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** S14 지난 달 대비 ▲▼ (변화 없으면 표시 안 함) */
function Trend({ delta }: { delta: number | undefined }) {
  if (!delta) return null;
  return (
    <span className={`trend ${delta > 0 ? 'trend-up' : 'trend-down'}`} aria-label={`지난달 ${signed(delta)}`}>
      {delta > 0 ? '▲' : '▼'}
      {Math.abs(delta)}
    </span>
  );
}

/** 자원 4개. 20 이하는 색과 함께 '위험' 글자로도 표시 (§10.2). S14: 누르면 증감 내역 */
export function Gauges({ view, onOpen }: { view: PublicRunView; onOpen?: (k: ResourceKey) => void }) {
  return (
    <div className="gauges">
      {RESOURCE_KEYS.map((k) => {
        const v = view.resources[k];
        const danger = v <= DANGER;
        return (
          <button
            type="button"
            key={k}
            className={`gauge ${danger ? 'gauge-danger' : ''}`}
            onClick={() => onOpen?.(k)}
            disabled={!onOpen}
            aria-label={`${RESOURCE_LABELS[k]} ${v}${onOpen ? ' — 최근 증감 내역 보기' : ''}`}
          >
            <div className="gauge-head">
              <span className="row gap-2">
                <IconBadge
                  name={STAT_STYLE[k].icon}
                  color={danger ? 'var(--stamp)' : STAT_STYLE[k].color}
                  size={30}
                />
                <span className="small fw-7">{RESOURCE_LABELS[k]}</span>
              </span>
              <span className="gauge-value">{v}</span>
            </div>
            <div className="gauge-bar" aria-hidden="true">
              <span style={{ width: `${v}%`, background: danger ? undefined : STAT_STYLE[k].color }} />
            </div>
            <span className="gauge-note">
              {danger ? '위험' : ' '} <Trend delta={view.resourceTrail.lastMonth[k]} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** S14 출근 화면용 게이지 한 줄: 아이콘 + 숫자 + 얇은 막대 + 지난달 ▲▼. 누르면 증감 내역 */
export function CompactGauges({ view, onOpen }: { view: PublicRunView; onOpen: (k: ResourceKey) => void }) {
  return (
    <div className="cgauges">
      {RESOURCE_KEYS.map((k) => {
        const v = view.resources[k];
        const danger = v <= DANGER;
        return (
          <button
            type="button"
            key={k}
            className={`cgauge ${danger ? 'gauge-danger' : ''}`}
            onClick={() => onOpen(k)}
            aria-label={`${RESOURCE_LABELS[k]} ${v}${danger ? ' 위험' : ''} — 최근 증감 내역 보기`}
          >
            <span className="cgauge-head">
              <span style={{ color: danger ? 'var(--stamp)' : STAT_STYLE[k].color, display: 'flex' }}>
                <Icon name={STAT_STYLE[k].icon} size={14} />
              </span>
              <span className="cgauge-label">{RESOURCE_LABELS[k]}</span>
            </span>
            <span className="cgauge-value">
              {v}
              <Trend delta={view.resourceTrail.lastMonth[k]} />
            </span>
            <span className="gauge-bar" aria-hidden="true">
              <span style={{ width: `${v}%`, background: danger ? undefined : STAT_STYLE[k].color }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** S14 출근 화면용 돈 한 줄 요약 */
export function MoneyLine({ view }: { view: PublicRunView }) {
  return (
    <p className="money-line small">
      <span>
        <span className="muted">현금</span> <strong className="num">{formatKrw(view.cash)}</strong>
      </span>
      <span>
        <span className="muted">빚</span> <strong className="num">{formatKrw(view.debt)}</strong>
      </span>
      <span>
        <span className="muted">순자산</span>{' '}
        <strong className={`num ${view.netWorth < 0 ? 'neg' : ''}`}>
          {view.netWorth < 0 ? `−${formatKrw(-view.netWorth)}` : formatKrw(view.netWorth)}
        </strong>
      </span>
    </p>
  );
}

/** S14 게이지 증감 내역 시트: 최근 3개월 */
export function TrailSheet({
  view,
  resource,
  onClose,
}: {
  view: PublicRunView;
  resource: ResourceKey;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = view.resourceTrail.entries.filter((e) => (e.delta[resource] ?? 0) !== 0);
  const total = rows.reduce((s, e) => s + (e.delta[resource] ?? 0), 0);
  const natural = rows.filter((e) => e.kind === 'MONTHLY').reduce((s, e) => s + (e.delta[resource] ?? 0), 0);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bottom-sheet-head">
          <span className="row gap-2">
            <IconBadge name={STAT_STYLE[resource].icon} color={STAT_STYLE[resource].color} size={28} />
            <strong id="trail-title">
              {RESOURCE_LABELS[resource]} {view.resources[resource]}
            </strong>
          </span>
          <button ref={closeRef} type="button" className="btn sheet-close" onClick={onClose}>
            닫기
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="small muted">아직 기록이 없어요. 한 달이 지나면 어디서 오르내렸는지 쌓입니다.</p>
        ) : (
          <>
            <p className="small">
              최근 3개월 <strong className="num">{signed(total)}</strong>{' '}
              <span className="muted">
                (사건·평가 {signed(total - natural)} · 자연 변화 {signed(natural)})
              </span>
            </p>
            <ul className="trail-list">
              {rows.map((e, i) => {
                const d = e.delta[resource] ?? 0;
                return (
                  <li key={i} className={e.kind === 'MONTHLY' ? 'trail-natural' : ''}>
                    <span className="tiny muted trail-when">
                      {e.age}세 {e.month}월
                    </span>
                    <span className="small trail-label">{e.label}</span>
                    <strong className={`num ${d > 0 ? 'pos' : 'neg'}`}>{signed(d)}</strong>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <span className="tiny muted">이미 일어난 일만 보여 줍니다. 앞으로의 확률은 비공개예요.</span>
      </div>
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
    <div className="card gap-2 pad-tight">
      <div className="row-between gap-2">
        <span className="tiny fw-7 ink-2">올해 ({c.age}세)</span>
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
                  : m.review
                    ? 'cal-review'
                    : '';
          // 평가 달은 좁은 칸에서도 한 줄로: 숫자 + 노란 테두리 (머리글에 '12월 연말 평가')
          const label = m.status === 'FUTURE' && m.scheduled ? '?' : m.month;
          return (
            <div
              key={m.month}
              role="listitem"
              className={`cal-cell ${cls}`}
              aria-label={`${m.month}월${m.status === 'CURRENT' ? ' (이번 달)' : ''}${m.scheduled ? ' (예정된 일)' : ''}${m.review ? ' (연말 평가)' : ''}`}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
