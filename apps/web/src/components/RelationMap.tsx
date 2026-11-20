import type { PublicRunView } from '@company-life/shared';
import { avatarTone } from './Avatar';

/**
 * D2 인맥 지도: 가운데 '나', 관계가 좋을수록 가까운 고리. 지금 팀은 진하게, 떠난 사람은 흐리게.
 * 정확한 수치는 계속 비공개 — 고리 세 개(우호적·무난함·껄끄러움)만 쓴다.
 */
const RINGS: Record<string, number> = { 우호적: 62, 무난함: 98, 껄끄러움: 132 };
const W = 320;
const H = 276;
const CX = W / 2;
const CY = H / 2;

interface Node {
  name: string;
  relation: string;
  current: boolean;
  boss: boolean;
}

export function RelationMap({ view }: { view: PublicRunView }) {
  const nodes: Node[] = [
    ...view.npcs.map((n) => ({
      name: n.name,
      relation: n.relationLabel,
      current: true,
      boss: n.role === 'BOSS',
    })),
    ...view.formerColleagues.slice(-4).map((p) => ({
      name: p.name,
      relation: p.relationLabel,
      current: false,
      boss: false,
    })),
  ].filter((n) => RINGS[n.relation] !== undefined);
  if (nodes.length === 0) return null;

  // 고리마다 고르게 나눠 앉힌다 (고리끼리 시작 각도를 어긋나게)
  const placed = Object.keys(RINGS).flatMap((relation, ringIndex) => {
    const onRing = nodes.filter((n) => n.relation === relation);
    return onRing.map((n, i) => {
      const angle = -Math.PI / 2 + ringIndex * 0.9 + (i / onRing.length) * Math.PI * 2;
      const r = RINGS[relation]!;
      return { ...n, x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r * 0.92 };
    });
  });

  return (
    <div className="card relation-map">
      <strong>인맥 지도</strong>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="나를 가운데 두고 관계가 좋을수록 가깝게 그린 인맥 지도"
      >
        {Object.entries(RINGS).map(([label, r]) => (
          <g key={label}>
            <ellipse className="rm-ring" cx={CX} cy={CY} rx={r} ry={r * 0.92} />
          </g>
        ))}
        {placed.map((n, i) => (
          <line key={`l-${i}`} className="rm-link" x1={CX} y1={CY} x2={n.x} y2={n.y} />
        ))}
        <circle className="rm-me" cx={CX} cy={CY} r={20} />
        <text className="rm-me-text" x={CX} y={CY + 5} textAnchor="middle">
          나
        </text>
        {placed.map((n, i) => (
          <g key={`n-${i}`} className={n.current ? '' : 'rm-former'}>
            <circle
              className={`rm-node av-fill-${avatarTone(n.name)}`}
              cx={n.x}
              cy={n.y}
              r={n.boss ? 17 : 15}
            />
            <text className="rm-initial" x={n.x} y={n.y + 4.5} textAnchor="middle">
              {n.name.slice(0, 1)}
            </text>
            <text className="rm-name" x={n.x} y={n.y + (n.boss ? 31 : 29)} textAnchor="middle">
              {n.boss ? `${n.name} (상사)` : n.name}
            </text>
          </g>
        ))}
      </svg>
      <span className="tiny muted">
        안쪽부터 우호적 · 무난함 · 껄끄러움. 흐린 사람은 예전에 함께 일했던 사람(최근 4명).
      </span>
    </div>
  );
}
