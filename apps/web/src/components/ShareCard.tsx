import { useEffect, useState } from 'react';
import type { PublicRunView } from '@company-life/shared';
import { formatKrw } from '../api';

/**
 * S19 엔딩 공유 이미지 (9:16, 1080×1920). 화면 테마와 상관없이 항상 '종이' 색으로 그린다.
 * 서버 없이 브라우저 캔버스로만 만들고, 휴대폰은 공유 시트, 그 밖은 PNG 저장.
 */
const W = 1080;
const H = 1920;
const C = {
  paper: '#f4f1ea',
  sheet: '#fffdf8',
  ink: '#1b2233',
  muted: '#5d6578',
  line: '#e3ded2',
  navy: '#1f2a44',
  navySoft: '#e9edf6',
  stamp: '#c8372d',
  gold: '#b8922a',
};
const BODY = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', system-ui, sans-serif";
const DISPLAY = `'Black Han Sans', ${BODY}`;
/** 인생 목표 줄은 늘 같은 자리 (위 내용이 길면 연대기 줄을 덜 그린다) */
const GOAL_Y = H - 215;

const KIND_ORDER = [
  'PROMOTION',
  'SERIES',
  'ECHO',
  'SEASON',
  'TRANSFER',
  'SKILL',
  'RECOVER',
  'RISK',
  'REVIEW',
  'SCAR',
];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of [...text]) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch.trimStart();
      if (lines.length === maxLines) break;
    } else cur += ch;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && lines.join('').length < [...text].join('').length) {
    let last = lines[maxLines - 1]!;
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = [...last].slice(0, -1).join('');
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** 띄어쓰기에서 두 줄로 (한 단어가 너무 길면 글자 단위로) */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  let best: string[] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) {
      const diff = Math.abs(ctx.measureText(a).width - ctx.measureText(b).width);
      if (!best || diff < Math.abs(ctx.measureText(best[0]!).width - ctx.measureText(best[1]!).width))
        best = [a, b];
    }
  }
  return best ?? wrap(ctx, text, maxWidth, 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const money = (n: number) => (n < 0 ? `−${formatKrw(-n)}` : formatKrw(n));

export async function drawShareImage(view: PublicRunView): Promise<Blob> {
  const e = view.ending!;
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const fail = e.category === 'FAILURE';
  const star = e.type === 'EXECUTIVE_PROMOTION';
  const chronicle = e.chronicle;

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  // 종이 한 장
  ctx.shadowColor = 'rgba(15,24,48,0.10)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = C.sheet;
  roundRect(ctx, 60, 120, W - 120, H - 240, 36);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const L = 120;
  const R = W - 120;
  const CW = R - L;
  ctx.textBaseline = 'alphabetic';

  // 머리: 로고 + 문서 종류
  ctx.fillStyle = C.navy;
  ctx.font = `48px ${DISPLAY}`;
  ctx.textAlign = 'left';
  ctx.fillText('오늘도 출근', L, 230);
  ctx.fillStyle = C.muted;
  ctx.font = `600 30px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText(fail ? '실패 엔딩' : '정상 엔딩', R, 226);
  ctx.fillStyle = C.ink;
  ctx.fillRect(L, 262, CW, 5);

  ctx.textAlign = 'center';
  ctx.font = `800 40px ${BODY}`;
  ctx.fillStyle = C.muted;
  ctx.fillText((fail ? '퇴직 통지서' : star ? '임원 발령장' : '퇴직 증명서').split('').join(' '), W / 2, 350);

  // 엔딩 제목
  ctx.fillStyle = C.ink;
  // 도장(오른쪽 위)과 겹치지 않게 가운데 폭만 쓴다. 길면 글자를 줄이고, 그래도 넘치면 띄어쓰기에서 두 줄
  const titleWidth = CW - 320;
  const size = [88, 76, 64].find((px) => {
    ctx.font = `${px}px ${DISPLAY}`;
    return ctx.measureText(e.title).width <= titleWidth;
  });
  ctx.font = `${size ?? 64}px ${DISPLAY}`;
  const titleLines = size ? [e.title] : wrapWords(ctx, e.title, titleWidth);
  const lineH = Math.round((size ?? 64) * 1.18);
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, 470 + i * lineH));
  let y = 470 + (titleLines.length - 1) * lineH;

  // 이름 · 나이
  const years = Math.floor(view.turn.turnIndex / 12);
  ctx.font = `500 34px ${BODY}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`${view.profile.displayName} · ${e.age}세 · 사회생활 ${years}년`, W / 2, y + 80);
  y += 80;
  // S21 오늘의 출근이면 날짜와 점수
  if (view.daily && e.dailyScore) {
    const [, m, d] = view.daily.split('-');
    ctx.fillStyle = C.navy;
    ctx.font = `800 34px ${BODY}`;
    ctx.fillText(
      `📅 ${Number(m)}월 ${Number(d)}일 오늘의 출근 · ${e.dailyScore.total.toLocaleString('ko-KR')}점`,
      W / 2,
      y + 56,
    );
    y += 56;
  }

  // 도장
  ctx.save();
  ctx.translate(R - 70, 400);
  ctx.rotate(-0.22);
  ctx.strokeStyle = fail ? C.stamp : C.navy;
  ctx.fillStyle = fail ? C.stamp : C.navy;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `46px ${DISPLAY}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(fail ? '퇴직' : star ? '★' : '수고', 0, 2);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';

  // 별명
  if (e.titles) {
    y += 70;
    roundRect(ctx, L, y, CW, 170, 28);
    ctx.fillStyle = C.navySoft;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `96px ${BODY}`;
    ctx.fillText(e.titles.main.emoji, L + 40, y + 122);
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${BODY}`;
    ctx.fillText(
      e.titles.main.rarity === 'LEGENDARY'
        ? '전설 별명'
        : e.titles.main.rarity === 'RARE'
          ? '희귀 별명'
          : '별명',
      L + 180,
      y + 58,
    );
    ctx.fillStyle = C.ink;
    ctx.font = `64px ${DISPLAY}`;
    ctx.fillText(e.titles.main.name, L + 180, y + 134);
    y += 170;
  }

  // 숫자 4칸
  y += 36;
  const maxSalary = Math.max(0, ...(chronicle?.yearly ?? []).map((r) => r.salary ?? 0));
  const companies = chronicle?.career.length ?? 0;
  const stats: Array<[string, string]> = [
    ['최종 직급', e.highestRankLabel ?? '-'],
    ['최고 연봉', maxSalary > 0 ? formatKrw(maxSalary) : '-'],
    ['순자산', money(view.netWorth)],
    ['거쳐 간 회사', companies > 0 ? `${companies}곳` : '-'],
  ];
  const cellW = CW / 2;
  stats.forEach(([label, value], i) => {
    const cx = L + (i % 2) * cellW;
    const cy = y + Math.floor(i / 2) * 124;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${BODY}`;
    ctx.fillText(label, cx + 8, cy + 34);
    ctx.fillStyle = C.ink;
    ctx.font = `800 52px ${BODY}`;
    ctx.fillText(wrap(ctx, value, cellW - 24, 1)[0] ?? '', cx + 8, cy + 100);
  });
  y += 270;

  // 연봉 그래프
  const salaries = (chronicle?.yearly ?? []).filter((r) => r.salary !== null);
  if (salaries.length >= 2) {
    y += 20;
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${BODY}`;
    ctx.textAlign = 'left';
    ctx.fillText('연봉의 길', L + 8, y);
    const gx = L + 8;
    const gw = CW - 16;
    const gy = y + 24;
    const gh = 130;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy + gh);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.stroke();
    const ages = salaries.map((r) => r.age);
    const minA = Math.min(...ages);
    const spanA = Math.max(1, Math.max(...ages) - minA);
    const pts = salaries.map((r) => [
      gx + ((r.age - minA) / spanA) * gw,
      gy + gh - ((r.salary ?? 0) / maxSalary) * gh,
    ]);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px!, py!) : ctx.lineTo(px!, py!)));
    ctx.lineTo(gx + gw, gy + gh);
    ctx.lineTo(pts[0]![0]!, gy + gh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(31,42,68,0.08)';
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px!, py!) : ctx.lineTo(px!, py!)));
    ctx.strokeStyle = C.navy;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    salaries.forEach((r, i) => {
      const mark = chronicle?.yearly.find((x) => x.age === r.age)?.mark;
      if (mark !== 'PROMOTION' && mark !== 'TRANSFER') return;
      const [px, py] = pts[i]!;
      ctx.beginPath();
      ctx.arc(px!, py!, 10, 0, Math.PI * 2);
      ctx.fillStyle = mark === 'PROMOTION' ? C.gold : C.navy;
      ctx.fill();
    });
    ctx.fillStyle = C.muted;
    ctx.font = `500 26px ${BODY}`;
    ctx.fillText(`${minA}세`, gx, gy + gh + 40);
    ctx.textAlign = 'right';
    ctx.fillText(`${minA + spanA}세`, gx + gw, gy + gh + 40);
    y = gy + gh + 60;
  }

  // 연대기 하이라이트 (시대마다 가장 굵직한 한 줄, 최대 4줄)
  const highlights = (chronicle?.eras ?? [])
    .map(
      (era) =>
        [...era.items]
          .filter((it) => it.kind !== 'JOIN' && it.kind !== 'ENDING')
          .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))[0],
    )
    .filter((it) => it !== undefined)
    .slice(0, 4);
  if (highlights.length > 0) {
    y += 40;
    ctx.fillStyle = C.line;
    ctx.fillRect(L, y - 30, CW, 2);
    ctx.textAlign = 'left';
    y -= 10;
    for (const it of highlights) {
      if (y + 62 > GOAL_Y - 86) break;
      y += 62;
      ctx.fillStyle = C.navy;
      ctx.font = `800 32px ${BODY}`;
      ctx.fillText(`${it.age}세`, L + 8, y);
      ctx.fillStyle = C.ink;
      ctx.font = `500 32px ${BODY}`;
      ctx.fillText(wrap(ctx, it.text, CW - 130, 1)[0] ?? '', L + 120, y);
    }
  }

  // 인생 목표
  if (e.goal) {
    y = GOAL_Y;
    roundRect(ctx, L, y - 56, CW, 88, 20);
    ctx.fillStyle = e.goal.achieved ? C.navySoft : '#f6efe6';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = `600 32px ${BODY}`;
    ctx.fillText(wrap(ctx, `${e.goal.emoji} 인생 목표 · ${e.goal.title}`, CW - 200, 1)[0] ?? '', L + 28, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = e.goal.achieved ? C.navy : C.stamp;
    ctx.font = `800 32px ${BODY}`;
    ctx.fillText(e.goal.achieved ? '달성' : '미달', R - 28, y);
  }

  // 바닥
  ctx.textAlign = 'center';
  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${BODY}`;
  ctx.fillText('오늘도 출근 · 한 사람의 직장 인생 시뮬레이션', W / 2, H - 150);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요'))), 'image/png'),
  );
}

/** 엔딩 화면의 '공유 이미지' 카드: 미리보기 + 공유(가능하면) / 저장 */
export function ShareCard({ view }: { view: PublicRunView }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    drawShareImage(view)
      .then((b) => {
        if (!alive) return;
        setBlob(b);
        setUrl(URL.createObjectURL(b));
      })
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [view]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const fileName = `오늘도출근-${view.profile.displayName}-${view.ending?.age ?? ''}세.png`;
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  const canShare =
    !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  const save = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: '오늘도 출근' });
    } catch {
      // 공유 시트를 닫은 경우는 조용히 넘어간다
    }
  };

  return (
    <div className="card share-card">
      <strong>엔딩 카드</strong>
      {error && <p className="small neg">{error}</p>}
      {url ? (
        <img className="share-preview" src={url} alt="엔딩 공유 이미지 미리보기" width={W} height={H} />
      ) : (
        !error && <div className="share-preview share-loading" aria-hidden="true" />
      )}
      <div className="row gap-2">
        {canShare && (
          <button type="button" className="btn btn-primary grow" onClick={share} disabled={!file}>
            공유하기
          </button>
        )}
        <button
          type="button"
          className={`btn grow ${canShare ? '' : 'btn-primary'}`}
          onClick={save}
          disabled={!url}
        >
          이미지 저장
        </button>
      </div>
    </div>
  );
}
