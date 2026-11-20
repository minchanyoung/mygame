import type { PublicRunView } from '@company-life/shared';

const KIND_LABEL = { JOIN: '입사', TRANSFER: '이직', PROMOTION: '승진' } as const;

/** S23 경력 증명서 ('나' 탭): 사내 문서 양식으로 지금 자리와 지나온 기록 */
export function CareerCertificate({ view }: { view: PublicRunView }) {
  const c = view.career;
  if (!c) return null;
  const years = Math.floor(c.totalMonths / 12);
  const months = c.totalMonths % 12;
  return (
    <div className="sheet certificate-doc" aria-label="경력 증명서">
      <div className="notice-head">
        <span className="tiny muted">{c.companyName} 인사팀</span>
        <strong className="notice-title">경 력 증 명 서</strong>
      </div>
      <dl className="kv cert-kv">
        <dt>성명</dt>
        <dd>{view.profile.displayName}</dd>
        <dt>소속</dt>
        <dd>
          {c.companyName} · {c.jobLabel}
        </dd>
        <dt>직급</dt>
        <dd>{c.rankLabel}</dd>
        <dt>재직</dt>
        <dd>
          {c.sinceAge}세 {c.sinceMonth}월부터
        </dd>
        <dt>경력</dt>
        <dd>
          {years > 0 ? `${years}년 ` : ''}
          {months}개월
        </dd>
      </dl>
      {c.entries.length > 0 && (
        <ol className="cert-entries">
          {c.entries.map((e, i) => (
            <li key={i}>
              <span className="tiny muted num">
                {e.age}세 {e.month}월
              </span>
              <span className={`chip cert-chip cert-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
              <span className="small">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="tiny muted text-center">위 사실을 증명합니다.</p>
      <span className="stamp stamp-mid stamp-navy sheet-stamp" aria-hidden="true">
        증명
      </span>
    </div>
  );
}
