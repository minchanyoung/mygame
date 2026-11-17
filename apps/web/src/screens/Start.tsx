interface Props {
  canResume: boolean;
  busy: boolean;
  onNew: () => void;
  onResume: () => void;
}

export function Start({ canResume, busy, onNew, onResume }: Props) {
  return (
    <section className="screen start">
      <div className="hero">
        <p className="hero-kicker">선택지형 직장 로그라이크</p>
        <h1>
          이번 인생은
          <br />
          어떤 회사원?
        </h1>
        <p className="muted">
          랜덤한 출신, 랜덤한 상사, 그리고 한 달에 한 번의 선택. 50세 전에 회사를 떠나면 끝입니다.
        </p>
      </div>
      <div className="sheet" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="stamp stamp-mid" aria-hidden="true">
          입사
        </span>
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          사원증을 받고, 사내 메신저로 오는 사건에 답하고, 매달 급여명세서를 받으세요.
        </p>
      </div>
      <div className="action-bar">
        {canResume && (
          <button type="button" className="btn" onClick={onResume} disabled={busy}>
            이어하기
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onNew} disabled={busy}>
          새 인생 출근
        </button>
      </div>
    </section>
  );
}
