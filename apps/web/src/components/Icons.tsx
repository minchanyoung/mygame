/** 선(stroke) 아이콘. 장식용이면 aria-hidden, 텍스트 옆에서만 쓴다. */
const PATHS = {
  company: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  people: 'M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  me: 'M12 15l-3.5 2 1-4-3-2.7 4-.3L12 6l1.5 4 4 .3-3 2.7 1 4z',
  record: 'M4 4h12l4 4v12H4zM8 12h8M8 16h5',
  warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  star: 'M12 2l2.6 6.6L21 9.3l-5 4.5 1.5 6.7L12 17l-5.5 3.5L8 13.8 3 9.3l6.4-.7z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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
