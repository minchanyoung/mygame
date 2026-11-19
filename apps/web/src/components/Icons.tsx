/** 선(stroke) 아이콘. 장식용이면 aria-hidden, 텍스트 옆에서만 쓴다. */
const PATHS = {
  company: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  people: 'M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  me: 'M12 15l-3.5 2 1-4-3-2.7 4-.3L12 6l1.5 4 4 .3-3 2.7 1 4z',
  record: 'M4 4h12l4 4v12H4zM8 12h8M8 16h5',
  warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  star: 'M12 2l2.6 6.6L21 9.3l-5 4.5 1.5 6.7L12 17l-5.5 3.5L8 13.8 3 9.3l6.4-.7z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  // 능력치
  health: 'M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z',
  mental:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01',
  focus: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  reputation: 'M12 3l2.4 5 5.6.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.6-.8z',
  // 돈
  cash: 'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7l12-3v3M17 13h.01',
  debt: 'M3 6h18v12H3zM3 10h18M7 15h4',
  worth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  // 배경
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  check: 'M5 12l5 5 9-10',
  thumbUp: 'M7 11v9H3v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7',
  thumbDown: 'M17 13V4h4v9zM17 13l-4 8a2 2 0 0 1-2-2v-4H5a2 2 0 0 1-2-2l2-7a2 2 0 0 1 2-2h10',
  story: 'M4 4h16v13H8l-4 4zM8 9h8M8 13h5',
} as const;

/** 능력치별 아이콘·색 (게임 전체에서 동일하게 사용) */
export const STAT_STYLE = {
  health: { icon: 'health', color: 'var(--c-health)' },
  mental: { icon: 'mental', color: 'var(--c-mental)' },
  focus: { icon: 'focus', color: 'var(--c-focus)' },
  reputation: { icon: 'reputation', color: 'var(--c-reputation)' },
} as const satisfies Record<string, { icon: keyof typeof PATHS; color: string }>;

/** 아이콘을 색 원형 배경에 담은 배지 */
export function IconBadge({
  name,
  color,
  size = 34,
}: {
  name: keyof typeof PATHS;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="icon-badge"
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
      aria-hidden="true"
    >
      <Icon name={name} size={Math.round(size * 0.56)} />
    </span>
  );
}

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 사원증 사진 자리 — 일러스트 없이 실루엣만 */
export function Silhouette() {
  return (
    <svg width="64" height="78" viewBox="0 0 64 78" aria-hidden="true">
      <circle cx="32" cy="28" r="15" fill="currentColor" opacity="0.22" />
      <path d="M6 78c2-16 13-26 26-26s24 10 26 26z" fill="currentColor" />
      <path d="M26 52l6 8 6-8" fill="var(--surface)" />
    </svg>
  );
}

/** 사원증 바코드 장식 (runId로 결정적 패턴) */
export function Barcode({ seed }: { seed: string }) {
  const bars: Array<{ x: number; w: number }> = [];
  let x = 0;
  for (let i = 0; x < 128; i++) {
    const code = seed.charCodeAt(i % seed.length) || 7;
    const w = (code % 3) + 1;
    bars.push({ x, w });
    x += w + ((code >> 2) % 3) + 1;
  }
  return (
    <svg width="132" height="22" viewBox="0 0 132 22" aria-hidden="true">
      <g fill="currentColor">
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={22} />
        ))}
      </g>
    </svg>
  );
}
