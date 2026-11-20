import { useEffect, useState } from 'react';
import type { DailyBoard, PublicEnding } from '@company-life/shared';
import { api } from '../api';

/** S21 엔딩 화면: 오늘의 출근 점수 내역 + 그날 순위 */
export function DailyBoardCard({
  date,
  score,
}: {
  date: string;
  score: NonNullable<PublicEnding['dailyScore']>;
}) {
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .getDaily(date)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [date]);
  const [, m, d] = date.split('-');
  const mine = board?.mine;
  return (
    <div className="card daily-board gap-2">
      <div className="career-head">
        <strong>
          📅 오늘의 출근 · {Number(m)}월 {Number(d)}일
        </strong>
        <strong className="num">{score.total.toLocaleString('ko-KR')}점</strong>
      </div>
      <div className="chip-row">
        {score.parts.map((p) => (
          <span key={p.label} className="chip">
            {p.label} +{p.points}
          </span>
        ))}
      </div>
      {failed && <p className="tiny muted">순위를 불러오지 못했어요.</p>}
      {board && (
        <>
          {mine ? (
            <p className="small">
              오늘 <strong>{board.total}명</strong> 중 <strong>{mine.rank}위</strong>
              {mine.score !== score.total && (
                <span className="tiny muted"> · 순위에는 오늘 첫 판({mine.score}점)이 올라가요</span>
              )}
            </p>
          ) : (
            <p className="tiny muted">순위는 하루 첫 판만 올라가요.</p>
          )}
          <ol className="daily-list">
            {board.top.map((e) => (
              <li key={`${e.rank}-${e.name}`} className={mine && mine.rank === e.rank ? 'daily-me' : ''}>
                <span className="daily-rank num">{e.rank}</span>
                <span className="grow min-w-0">
                  <strong className="small">{e.name}</strong>{' '}
                  <span className="tiny muted">
                    {e.age}세 · {e.endingTitle}
                    {e.rankLabel ? ` · ${e.rankLabel}` : ''}
                  </span>
                </span>
                <span className="num small">{e.score.toLocaleString('ko-KR')}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
