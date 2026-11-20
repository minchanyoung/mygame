import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ChronicleItemKind, PublicChronicle, PublicTitle } from '@company-life/shared';

/** 금액 짧게: 1.4억 · 4,200만 · −500만 */
export function krwShort(n: number): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs < 10_000) return '0';
  if (abs >= 100_000_000) {
    const eok = abs / 100_000_000;
    return `${sign}${eok >= 10 ? Math.round(eok) : eok.toFixed(1).replace(/\.0$/, '')}억`;
  }
  return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`;
}

const RARITY_LABEL: Record<PublicTitle['rarity'], string> = {
  LEGENDARY: '전설',
  RARE: '드묾',
  COMMON: '흔함',
};

/** 별명: 대표 1 + 보조 최대 2 */
export function TitleCard({ titles }: { titles: { main: PublicTitle; subs: PublicTitle[] } }) {
  const { main, subs } = titles;
  return (
    <div className={`card title-card title-${main.rarity}`}>
      <span className="tiny muted">당신의 별명은…</span>
      <div className="title-main">
        <span className="title-emoji" aria-hidden="true">
          {main.emoji}
        </span>
        <div>
          <strong className="title-name">{main.name}</strong>
          <span className={`chip chip-pill rarity rarity-${main.rarity}`}>{RARITY_LABEL[main.rarity]}</span>
        </div>
      </div>
      <p className="small lh-loose">{main.reason}</p>
      {subs.length > 0 && (
        <ul className="title-subs">
          {subs.map((t) => (
            <li key={t.id}>
              <span className="chip chip-pill">
                <span aria-hidden="true">{t.emoji}</span> {t.name}
              </span>
              <span className="tiny muted">{t.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const W = 320;
const H = 170;
const PAD = { l: 44, r: 10, t: 12, b: 24 };

/** 나이별 연봉·순자산 그래프 (SVG). 누르거나 손가락으로 끌면(가로) 가장 가까운 해의 기록을 보여준다. */
export function LifeChart({ yearly }: { yearly: PublicChronicle['yearly'] }) {
  const [sel, setSel] = useState(yearly.length - 1);
  if (yearly.length < 2) {
    return (
      <p className="small muted">그래프를 그릴 만큼 기록이 쌓이지 않았습니다 (1년 이상 근무 후 기록됨).</p>
    );
  }
  const ages = yearly.map((y) => y.age);
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const values = yearly.flatMap((y) => [y.salary ?? 0, y.netWorth]);
  const top = Math.max(1, ...values);
  const bottom = Math.min(0, ...values);
  const x = (age: number) => PAD.l + ((age - minAge) / Math.max(1, maxAge - minAge)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((top - v) / (top - bottom)) * (H - PAD.t - PAD.b);
  const line = (pick: (r: PublicChronicle['yearly'][number]) => number | null) =>
    yearly
      .filter((r) => pick(r) !== null)
      .map((r) => `${x(r.age).toFixed(1)},${y(pick(r)!).toFixed(1)}`)
      .join(' ');
  const idx = Math.min(sel, yearly.length - 1);
  const cur = yearly[idx]!;
  // 화면 좌표 → 그래프 좌표 → 가장 가까운 해 (막대가 7px 남짓이라 직접 누르기 어렵다)
  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    yearly.forEach((r, i) => {
      if (Math.abs(x(r.age) - px) < Math.abs(x(yearly[best]!.age) - px)) best = i;
    });
    setSel(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setSel(Math.max(0, idx - 1));
    else if (e.key === 'ArrowRight') setSel(Math.min(yearly.length - 1, idx + 1));
    else return;
    e.preventDefault();
  };
  const decades = [20, 30, 40, 50, 60].filter((a) => a >= minAge && a <= maxAge);

  return (
    <div className="life-chart">
      <div className="chart-legend tiny">
        <span>
          <i className="swatch swatch-salary" /> 연봉
        </span>
        <span>
          <i className="swatch swatch-net" /> 순자산
        </span>
        <span className="muted">● 입사·이직·승진</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${minAge}세부터 ${maxAge}세까지 연봉과 순자산 그래프. 좌우 화살표로 해를 고를 수 있어요`}
        tabIndex={0}
        // 누를 때는 포커스 테두리를 띄우지 않는다 (키보드 Tab 포커스만)
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pickAt(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') pickAt(e);
        }}
        onKeyDown={onKey}
      >
        {[top, (top + bottom) / 2, bottom].map((v, i) => (
          <g key={i}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className="chart-axis" x={PAD.l - 4} y={y(v) + 4} textAnchor="end">
              {krwShort(v)}
            </text>
          </g>
        ))}
        {bottom < 0 && <line className="chart-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />}
        {decades.map((a) => (
          <text key={a} className="chart-axis" x={x(a)} y={H - 6} textAnchor="middle">
            {a}세
          </text>
        ))}
        <line className="chart-cursor" x1={x(cur.age)} x2={x(cur.age)} y1={PAD.t} y2={H - PAD.b} />
        <polyline className="chart-net" points={line((r) => r.netWorth)} />
        <polyline className="chart-salary" points={line((r) => r.salary)} />
        {yearly.map((r, i) =>
          r.mark && r.salary !== null ? (
            <circle key={`m${i}`} className="chart-mark" cx={x(r.age)} cy={y(r.salary)} r={3.5} />
          ) : null,
        )}
        <circle className="chart-sel chart-sel-net" cx={x(cur.age)} cy={y(cur.netWorth)} r={4.5} />
        {cur.salary !== null && (
          <circle className="chart-sel chart-sel-salary" cx={x(cur.age)} cy={y(cur.salary)} r={4.5} />
        )}
      </svg>
      <p className="chart-readout small" aria-live="polite">
        <strong>{cur.age}세</strong> ·{' '}
        {cur.companyName ? `${cur.companyName} ${cur.rankLabel ?? ''}` : '회사 밖'}
        {cur.salary !== null && <> · 연봉 {krwShort(cur.salary)}</>} · 순자산 {krwShort(cur.netWorth)}
        {cur.reviewGrade && (
          <span className={`grade grade-sm review-${cur.reviewGrade}`} title="그해 인사평가">
            {cur.reviewGrade}
          </span>
        )}
      </p>
    </div>
  );
}

/** 회사별 재직 구간 띠 */
export function CareerBand({ career }: { career: PublicChronicle['career'] }) {
  if (career.length === 0) return null;
  const from = career[0]!.fromAge;
  const to = Math.max(from + 1, career[career.length - 1]!.toAge + 1);
  return (
    <div className="career-band-wrap">
      <div className="career-band" aria-hidden="true">
        {career.map((c, i) => (
          <span
            key={i}
            className={`band-seg grade-${c.grade}`}
            style={{ flexGrow: c.toAge + 1 - c.fromAge }}
            title={`${c.companyName} ${c.fromAge}~${c.toAge}세`}
          />
        ))}
      </div>
      <ol className="career-legend tiny">
        {career.map((c, i) => (
          <li key={i}>
            <span className={`grade grade-sm grade-${c.grade}`}>{c.grade}</span> {c.companyName}{' '}
            <span className="muted">
              {c.fromAge}~{c.toAge}세
            </span>
          </li>
        ))}
      </ol>
      <span className="sr-only">
        {from}세부터 {to}세까지 {career.length}곳에서 일했다
      </span>
    </div>
  );
}

const KIND_ICON: Record<ChronicleItemKind, string> = {
  JOIN: '🪪',
  TRANSFER: '🧳',
  PROMOTION: '📈',
  SERIES: '📖',
  SKILL: '✨',
  SCAR: '🩹',
  RECOVER: '🌤',
  REVIEW: '📋',
  RISK: '⚡',
  ECHO: '↩',
  SEASON: '📅',
  ENDING: '🏁',
};

/** 시대별 주요 사건 (탭 전환) */
export function EraTimeline({ eras }: { eras: PublicChronicle['eras'] }) {
  const [on, setOn] = useState(0);
  const era = eras[Math.min(on, eras.length - 1)];
  if (!era) return null;
  return (
    <div className="era">
      <div className="era-tabs" role="tablist" aria-label="시대 선택">
        {eras.map((e, i) => (
          <button
            key={e.label}
            type="button"
            role="tab"
            aria-selected={i === on}
            className={`era-tab ${i === on ? 'era-tab-on' : ''}`}
            onClick={() => setOn(i)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <ol className="timeline" role="tabpanel">
        {era.items.map((it, i) => (
          <li key={`${it.age}-${it.month}-${i}`} className={it.kind === 'ENDING' ? 'tl-ending' : ''}>
            <span className="tiny muted">
              {it.age}세 {it.month}월
            </span>
            <div>
              <span aria-hidden="true">{KIND_ICON[it.kind]}</span> {it.text}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 인연 깊은 동료 */
export function Bonds({ bonds }: { bonds: PublicChronicle['bonds'] }) {
  if (bonds.length === 0) return null;
  return (
    <ul className="bonds">
      {bonds.map((b) => (
        <li key={b.name} className="bond">
          <div className="career-head">
            <strong>{b.name}</strong>
            <span className="chip chip-pill chip-accent">{b.relation}</span>
          </div>
          <span className="tiny muted">
            {b.note} · 함께한 일 {b.together}번
          </span>
        </li>
      ))}
    </ul>
  );
}
