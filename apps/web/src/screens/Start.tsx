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
        <h1>회사원 키우기</h1>
        <p className="muted">
          랜덤한 출신, 랜덤한 상사, 그리고 한 달에 한 번의 선택. 당신의 은퇴는 어떤 모습일까요?
        </p>
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-primary" onClick={onNew} disabled={busy}>
          새 게임
        </button>
        {canResume && (
          <button type="button" className="btn" onClick={onResume} disabled={busy}>
            이어하기
          </button>
        )}
      </div>
    </section>
  );
}
