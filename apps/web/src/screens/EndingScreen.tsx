import type { PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

interface Props {
  view: PublicRunView;
  onNewGame: () => void;
  onHome: () => void;
}

const MILESTONE_KINDS = new Set(['JOB_APPLICATION', 'ENDING']);

/** GAME_OVER — 퇴직 통지서(실패) / 퇴직 증명서(정상) + 인생 연대기 (정식 성적표는 Phase 2) */
export function EndingScreen({ view, onNewGame, onHome }: Props) {
  const e = view.ending;
  if (!e) return null;
  const fail = e.category === 'FAILURE';
  const years = Math.floor(view.turn.turnIndex / 12);
  const months = view.turn.turnIndex % 12;
  // 연대기: 입사·엔딩 + 특성 변화/연봉 같은 굵직한 기록만 골라 오래된 순으로
  const milestones = view.history
    .filter((h) => MILESTONE_KINDS.has(h.kind) || /획득|극복|Lv\.|연봉/.test(h.summary))
    .slice(0, 8)
    .reverse();

  return (
    <section className="screen">
      <div className={`sheet certificate flip-in ${fail ? 'cert-fail' : 'cert-normal'}`}>
        <span className="cert-kind">{fail ? '퇴 직 통 지 서' : '퇴 직 증 명 서'}</span>
        <span className="tiny muted">{fail ? '실패 엔딩' : '정상 엔딩'}</span>
        <h1>{e.title}</h1>
        <p style={{ lineHeight: 1.7 }}>{e.text}</p>
        <p className="small muted">
          {view.profile.displayName} · {e.age}세 · 사회생활 {years}년 {months}개월
        </p>
        <span className={`stamp stamp-big stamp-slam ${fail ? '' : 'stamp-navy'}`} aria-hidden="true">
          {fail ? '퇴직' : '수고'}
        </span>
      </div>

      <div className="card">
        <dl className="kv kv-wide">
          <dt>순자산</dt>
          <dd className={view.netWorth < 0 ? 'neg' : ''}>
            {view.netWorth < 0 ? `−${formatKrw(-view.netWorth)}` : formatKrw(view.netWorth)}
          </dd>
          <dt>현금 / 빚</dt>
          <dd>
            {formatKrw(view.cash)} / {formatKrw(view.debt)}
          </dd>
          <dt>얻은 능력</dt>
          <dd>{view.skills.map((t) => `${t.name} Lv.${t.level}`).join(', ') || '없음'}</dd>
          <dt>남은 상처</dt>
          <dd>{view.negativeTraits.map((t) => `${t.name} Lv.${t.level}`).join(', ') || '없음'}</dd>
        </dl>
        {view.playtestModified && <p className="tiny muted">플레이테스트 도구로 조작된 기록입니다.</p>}
      </div>

      {milestones.length > 0 && (
        <div className="card">
          <strong>인생 연대기</strong>
          <ol className="timeline">
            {milestones.map((h, i) => (
              <li key={`${h.age}-${h.month}-${i}`} className={h.kind === 'ENDING' ? 'tl-ending' : ''}>
                <span className="tiny muted">
                  {h.age}세 {h.month}월
                </span>
                <div>{h.summary}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="action-bar">
        <button type="button" className="btn" onClick={onHome}>
          처음 화면
        </button>
        <button type="button" className="btn btn-primary" onClick={onNewGame}>
          새 인생 출근
        </button>
      </div>
    </section>
  );
}
