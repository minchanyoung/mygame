import type { PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

interface Props {
  view: PublicRunView;
  onNewGame: () => void;
  onHome: () => void;
}

/** GAME_OVER: 엔딩 (간이 성적표 — 정식 성적표·연대기는 Phase 2) */
export function EndingScreen({ view, onNewGame, onHome }: Props) {
  const e = view.ending;
  if (!e) return null;
  const fail = e.category === 'FAILURE';
  return (
    <section className="screen">
      <div className={`card ending ${fail ? 'ending-fail' : 'ending-normal'}`}>
        <p className="small">{fail ? '실패 엔딩' : '정상 엔딩'}</p>
        <h1>{e.title}</h1>
        <p>{e.text}</p>
        <p className="muted small">
          {view.profile.displayName} · {e.age}세 · 사회생활 {Math.floor(view.turn.turnIndex / 12)}년{' '}
          {view.turn.turnIndex % 12}개월
        </p>
      </div>

      <div className="card">
        <dl className="kv kv-wide">
          <dt>순자산</dt>
          <dd>{formatKrw(view.netWorth)}</dd>
          <dt>현금 / 빚</dt>
          <dd>
            {formatKrw(view.cash)} / {formatKrw(view.debt)}
          </dd>
          <dt>얻은 능력</dt>
          <dd>{view.skills.map((t) => `${t.name} Lv.${t.level}`).join(', ') || '없음'}</dd>
          <dt>남은 상처</dt>
          <dd>{view.negativeTraits.map((t) => `${t.name} Lv.${t.level}`).join(', ') || '없음'}</dd>
        </dl>
        {view.playtestModified && <p className="small muted">🧪 플레이테스트 도구로 조작된 기록입니다.</p>}
      </div>

      <div className="action-bar">
        <button type="button" className="btn" onClick={onHome}>
          처음 화면
        </button>
        <button type="button" className="btn btn-primary" onClick={onNewGame}>
          새 인생 시작
        </button>
      </div>
    </section>
  );
}
