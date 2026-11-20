/**
 * S20 동료 아바타: 이름으로 정해지는 고정 색 + 이니셜, 관계에 따라 작은 표정 배지.
 * 같은 사람은 메신저·사람 탭·결산 어디서나 같은 색이다.
 */
const PALETTE = 6;

export function avatarTone(name: string): number {
  // 메신저 화자 이름에 붙는 직급('한민준 사원')은 빼고 이름만으로 정한다
  const key = name.trim().split(/\s+/)[0] ?? name;
  let h = 0;
  for (const ch of key) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % PALETTE;
}

const MOOD: Record<string, { face: string; label: string }> = {
  우호적: { face: '🙂', label: '관계 우호적' },
  무난함: { face: '😐', label: '관계 무난함' },
  껄끄러움: { face: '😒', label: '관계 껄끄러움' },
};

export function Avatar({
  name,
  small = false,
  relation,
  initial,
}: {
  name: string;
  small?: boolean;
  /** 관계 표현(우호적/무난함/껄끄러움)이 있으면 표정 배지 */
  relation?: string;
  /** 이니셜을 따로 줄 때 (메신저 화자) */
  initial?: string;
}) {
  const mood = relation ? MOOD[relation] : undefined;
  return (
    <span
      className={`avatar ${small ? 'avatar-small' : ''} av-tone av-${avatarTone(name)}`}
      aria-hidden="true"
    >
      {initial ?? name.slice(0, 1)}
      {mood && (
        <span className="av-mood" title={mood.label}>
          {mood.face}
        </span>
      )}
    </span>
  );
}
