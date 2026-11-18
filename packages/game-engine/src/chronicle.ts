import {
  RANK_LABELS,
  turnInfo,
  type ChronicleItemKind,
  type GameRunState,
  type PublicChronicle,
  type ReviewGrade,
  type YearlyRecord,
} from '@company-life/shared';
import type { ContentIndex } from './content-index';

/**
 * S9 연간 기록: 12월 인사평가 직후와 엔딩 확정 직전에 한 줄씩 남긴다.
 * 같은 해 기록이 이미 있으면 덮어쓰되, 평가 등급은 새 값이 없을 때 이전 값을 유지한다.
 */
export function withYearlyRecord(
  state: GameRunState,
  content: ContentIndex,
  reviewGrade: ReviewGrade | null,
): GameRunState {
  const info = turnInfo(state.turnIndex, content.pack.rules.startAge);
  const job = state.employment.current;
  const prev = state.yearlyRecords.find((r) => r.yearIndex === info.yearIndex);
  const record: YearlyRecord = {
    yearIndex: info.yearIndex,
    age: info.age,
    companyId: job?.companyId ?? null,
    rank: job?.rank ?? null,
    annualSalary: job?.annualSalary ?? null,
    netWorth: state.cash - state.debt,
    reviewGrade: reviewGrade ?? prev?.reviewGrade ?? null,
    health: state.resources.health,
    mental: state.resources.mental,
  };
  return {
    ...state,
    yearlyRecords: [...state.yearlyRecords.filter((r) => r.yearIndex !== info.yearIndex), record].sort(
      (a, b) => a.yearIndex - b.yearIndex,
    ),
  };
}

/** 관계 수치 기준 (공개하지 않음, 성격 이름만 보여준다) */
const RELATION_HIGH = 60;

interface Item {
  turnIndex: number;
  kind: ChronicleItemKind;
  text: string;
  weight: number;
}

const ERAS = [
  { label: '20대', from: 0, to: 29 },
  { label: '30대', from: 30, to: 39 },
  { label: '40대', from: 40, to: 49 },
  { label: '50대', from: 50, to: 200 },
] as const;

export const ERA_ITEM_LIMIT = 4;

/** 연재 결말 화(본편 마지막 화 또는 정리 화)였던 사건 기록 */
function seriesFinales(state: GameRunState, content: ContentIndex) {
  return state.eventOccurrences.flatMap((o) => {
    const ev = content.events.get(o.eventId);
    const s = ev?.series;
    if (!ev || !s || s.episode !== s.total) return [];
    const farewell = ev.id.endsWith('_farewell');
    const choice = ev.choices.find((c) => c.id === o.choiceId);
    return [
      {
        occurrence: o,
        title: s.title,
        ending: farewell ? ev.title : `“${(choice?.label ?? ev.title).replace(/^"|"$/g, '')}”`,
      },
    ];
  });
}

function collectItems(state: GameRunState, content: ContentIndex): Item[] {
  const items: Item[] = [];
  const traitName = (id: string) => content.traits.get(id)?.name ?? id;

  for (const h of state.eventHistory) {
    switch (h.kind) {
      case 'JOB_APPLICATION':
        items.push({ turnIndex: h.turnIndex, kind: 'JOIN', text: h.summary, weight: 90 });
        break;
      case 'TRANSFER':
        items.push({ turnIndex: h.turnIndex, kind: 'TRANSFER', text: h.summary, weight: 85 });
        break;
      case 'PROMOTION':
        items.push({ turnIndex: h.turnIndex, kind: 'PROMOTION', text: h.summary, weight: 80 });
        break;
      case 'ENDING':
        items.push({ turnIndex: h.turnIndex, kind: 'ENDING', text: h.summary, weight: 100 });
        break;
      default:
        break;
    }
  }
  for (const f of seriesFinales(state, content)) {
    items.push({
      turnIndex: f.occurrence.turnIndex,
      kind: 'SERIES',
      text: `연재 「${f.title}」 완결 — ${f.ending}`,
      weight: 70,
    });
  }
  for (const t of state.skillHistory) {
    items.push({
      turnIndex: t.turnIndex,
      kind: 'SKILL',
      text:
        t.from === 0 ? `능력 '${traitName(t.traitId)}' 획득` : `'${traitName(t.traitId)}' Lv.${t.to}로 성장`,
      weight: t.from === 0 ? 55 : 50,
    });
  }
  for (const t of state.traitHistory) {
    if (t.to === 0) {
      items.push({
        turnIndex: t.turnIndex,
        kind: 'RECOVER',
        text: `'${traitName(t.traitId)}' 극복`,
        weight: 60,
      });
    } else if (t.to > t.from) {
      items.push({
        turnIndex: t.turnIndex,
        kind: 'SCAR',
        text: t.from === 0 ? `상처 '${traitName(t.traitId)}'가 생김` : `'${traitName(t.traitId)}'가 깊어짐`,
        weight: 45,
      });
    }
  }
  for (const r of state.annualReviews) {
    if (r.grade === 'S' || r.grade === 'D') {
      items.push({
        turnIndex: r.turnIndex,
        kind: 'REVIEW',
        text: r.grade === 'S' ? '인사평가 S — 올해의 에이스' : '인사평가 D — 경고장을 받았다',
        weight: 50,
      });
    }
  }
  for (const o of state.eventOccurrences) {
    if (!o.highRisk || o.success === null) continue;
    const ev = content.events.get(o.eventId);
    if (!ev || ev.series) continue;
    items.push({
      turnIndex: o.turnIndex,
      kind: 'RISK',
      text: `${ev.title} — ${o.success ? '위기를 넘겼다' : '크게 흔들렸다'}`,
      weight: o.success ? 40 : 35,
    });
  }
  // 같은 문구(예: '번아웃' 극복)가 되풀이되면 처음 것만 제 무게, 다시 나온 것은 맨 뒤로 밀린다
  const seen = new Set<string>();
  return items
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .map((it) => {
      if (!seen.has(it.text)) {
        seen.add(it.text);
        return it;
      }
      return it.kind === 'ENDING' ? it : { ...it, weight: it.weight - 40 };
    });
}

/** 관계 점수 = 관계 변화량 합 + 함께한 사건 × 3 + 함께 끝낸 연재 × 10 */
function bonds(state: GameRunState, content: ContentIndex): PublicChronicle['bonds'] {
  const finales = seriesFinales(state, content);
  return state.npcs
    .map((npc) => {
      const together = state.eventOccurrences.filter((o) => o.participantNpcId === npc.npcId).length;
      const arcs = finales.filter((f) => f.occurrence.participantNpcId === npc.npcId).length;
      const swing = npc.relationshipHistory.reduce((s, h) => s + Math.abs(h.to - h.from), 0);
      return { npc, together, score: swing + together * 3 + arcs * 10 };
    })
    .filter((b) => b.score > 0 && b.together > 0)
    .sort((a, b) => b.score - a.score || a.npc.createdAtTurn - b.npc.createdAtTurn)
    .slice(0, 2)
    .map(({ npc, together }) => {
      const warm = npc.favor >= RELATION_HIGH || npc.trust >= RELATION_HIGH;
      const rival = npc.rivalry >= RELATION_HIGH;
      const relation =
        warm && rival ? '애증의 동료' : rival ? '평생의 라이벌' : warm ? '든든한 아군' : '오래 본 사이';
      const company = content.companies.get(npc.companyId)?.name ?? '';
      const role = npc.role === 'BOSS' ? '상사' : '동료';
      const note = npc.active
        ? `${role} · 지금은 ${company} ${RANK_LABELS[npc.rank]}`
        : `${role} · ${company}을 먼저 떠났다`;
      return { name: npc.name, relation, note, together };
    });
}

/** S9 공개용 인생 연대기 (확정된 엔딩에서만 만든다) */
export function buildChronicle(state: GameRunState, content: ContentIndex): PublicChronicle {
  const startAge = content.pack.rules.startAge;
  const ageOf = (turn: number) => turnInfo(turn, startAge);

  const yearly: PublicChronicle['yearly'] = state.yearlyRecords.map((r, i) => {
    const prev = i > 0 ? state.yearlyRecords[i - 1] : undefined;
    const mark =
      r.companyId && (!prev || !prev.companyId)
        ? 'JOIN'
        : r.companyId && prev?.companyId && prev.companyId !== r.companyId
          ? 'TRANSFER'
          : r.rank && prev?.rank && prev.rank !== r.rank
            ? 'PROMOTION'
            : null;
    return {
      age: r.age,
      salary: r.annualSalary,
      netWorth: r.netWorth,
      companyName: r.companyId ? (content.companies.get(r.companyId)?.name ?? null) : null,
      rankLabel: r.rank ? RANK_LABELS[r.rank] : null,
      reviewGrade: r.reviewGrade,
      mark,
    };
  });

  const career: PublicChronicle['career'] = [];
  for (const r of state.yearlyRecords) {
    if (!r.companyId) continue;
    const last = career[career.length - 1];
    const company = content.companies.get(r.companyId);
    const name = company?.name ?? r.companyId;
    if (last && last.companyName === name) last.toAge = r.age;
    else career.push({ companyName: name, grade: company?.grade ?? 'C', fromAge: r.age, toAge: r.age });
  }

  const items = collectItems(state, content);
  const eras = ERAS.map((era) => {
    const inEra = items.filter((it) => {
      const age = ageOf(it.turnIndex).age;
      return age >= era.from && age <= era.to;
    });
    const picked = [...inEra]
      .sort((a, b) => b.weight - a.weight || a.turnIndex - b.turnIndex)
      .slice(0, ERA_ITEM_LIMIT)
      .sort((a, b) => a.turnIndex - b.turnIndex || b.weight - a.weight);
    return {
      label: era.label,
      items: picked.map((it) => {
        const info = ageOf(it.turnIndex);
        return { age: info.age, month: info.monthOfYear, kind: it.kind, text: it.text };
      }),
    };
  }).filter((e) => e.items.length > 0);

  return {
    yearly,
    career,
    eras,
    bonds: bonds(state, content),
    seriesDone: seriesFinales(state, content).map((f) => ({
      title: f.title,
      ending: f.ending,
      age: ageOf(f.occurrence.turnIndex).age,
    })),
  };
}
