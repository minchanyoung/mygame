import { useState } from 'react';
import type { MonthlyAction, PublicRunView } from '@company-life/shared';
import { ActionHistory, ActionPicker } from '../components/MonthlyActions';
import { Icon, IconBadge, type IconName } from '../components/Icons';
import {
  CareerCard,
  EmployeeBadge,
  Gauges,
  MoneyRow,
  Warnings,
  YearCalendar,
} from '../components/StatusPanel';

interface Props {
  view: PublicRunView;
  busy: boolean;
  onStartMonth: (actionId: MonthlyAction) => void;
  onHome: () => void;
}

type Tab = 'company' | 'people' | 'me' | 'record';
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'company', label: '회사', icon: 'company' },
  { id: 'people', label: '사람', icon: 'people' },
  { id: 'me', label: '나', icon: 'me' },
  { id: 'record', label: '기록', icon: 'record' },
];

/** MONTH_START: 사원증 메인 + 하단 탭 (회사 / 사람 / 나 / 기록) */
export function Workplace({ view, busy, onStartMonth, onHome }: Props) {
  const [tab, setTab] = useState<Tab>('company');
  // S11 이번 달 행동: 서버가 정한 기본값(지난달 행동)에서 시작, 달이 바뀌면 다시 기본값
  const actions = view.monthlyActions;
  const [picked, setPicked] = useState<{ turn: number; id: MonthlyAction } | null>(null);
  const actionId = picked && picked.turn === view.turn.turnIndex ? picked.id : (actions?.selected ?? 'rest');
  const actionName = actions?.options.find((o) => o.id === actionId);

  const lastStory = view.history.find((h) => h.kind === 'EVENT_RESOLVED');

  return (
    <section className="screen">
      {tab === 'company' && (
        <>
          <EmployeeBadge view={view} />
          <Warnings view={view} />
          <Gauges view={view} />
          <MoneyRow view={view} />
          <CareerCard view={view} />
          {lastStory && (
            <button type="button" className="card last-story" onClick={() => setTab('record')}>
              <IconBadge name="story" color="var(--navy)" size={32} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="tiny muted" style={{ fontWeight: 700 }}>
                  지난 이야기 · {lastStory.age}세 {lastStory.month}월
                </span>
                <span className="small">{lastStory.summary}</span>
              </span>
            </button>
          )}
          <YearCalendar view={view} />
          {actions && (
            <ActionPicker
              actions={actions}
              value={actionId}
              disabled={busy}
              onChange={(id) => setPicked({ turn: view.turn.turnIndex, id })}
            />
          )}
          <div className="cta-wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onStartMonth(actionId)}
              disabled={busy}
            >
              {busy
                ? '출근 중…'
                : `${view.turn.monthOfYear}월 출근하기${actionName ? ` · ${actionName.emoji} ${actionName.name}` : ''}`}
            </button>
          </div>
        </>
      )}

      {tab === 'people' && (
        <>
          <h2>우리 팀</h2>
          <ul className="npc-list">
            {view.npcs.map((n) => (
              <li key={n.npcId} className="card">
                <div className="npc-row">
                  <span className="avatar avatar-small" aria-hidden="true">
                    {n.name.slice(0, 1)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{n.name}</strong>{' '}
                    <span className="chip">
                      {n.roleLabel} · {n.rankLabel}
                    </span>
                    <p className="small muted">
                      {n.personalities.map((p) => p.name).join(' · ')} — 관계 {n.relationLabel}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="tiny muted">정확한 호감·신뢰 수치는 비공개입니다.</p>
          {view.formerColleagues.length > 0 && (
            <>
              <h3 className="small" style={{ marginTop: 8 }}>
                함께 일했던 사람들
              </h3>
              <ul className="npc-list">
                {view.formerColleagues.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="card former">
                    <div className="npc-row">
                      <span className="avatar avatar-small" aria-hidden="true">
                        {p.name.slice(0, 1)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <strong>{p.name}</strong> <span className="chip">{p.rankLabel}</span>
                        <p className="small muted">
                          {p.note} · 관계 {p.relationLabel}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === 'me' && (
        <>
          <h2>나</h2>
          <Gauges view={view} />
          <MoneyRow view={view} />
          <CareerCard view={view} />
          {actions && <ActionHistory actions={actions} />}
          <div className="card">
            <strong>발견한 특성</strong>
            {view.skills.length + view.negativeTraits.length === 0 ? (
              <p className="small muted">아직 없음 — 특별한 사건을 통해 얻게 됩니다.</p>
            ) : (
              <ul className="trait-list">
                {view.skills.map((t) => (
                  <li key={t.id} className="small">
                    <span className="chip chip-trait">
                      <Icon name="star" size={12} />
                      {t.name} Lv.{t.level}
                    </span>{' '}
                    {t.effect}
                  </li>
                ))}
                {view.negativeTraits.map((t) => (
                  <li key={t.id} className="small">
                    <span className="chip chip-danger">
                      {t.name} Lv.{t.level}
                    </span>{' '}
                    {t.effect}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn" onClick={onHome}>
            처음 화면으로
          </button>
        </>
      )}

      {tab === 'record' && (
        <>
          <h2>인생 기록</h2>
          <ol className="timeline">
            {view.history.map((h, i) => (
              <li key={`${h.age}-${h.month}-${i}`} className={h.kind === 'ENDING' ? 'tl-ending' : ''}>
                <span className="tiny muted">
                  {h.age}세 {h.month}월
                </span>
                <div>{h.summary}</div>
              </li>
            ))}
          </ol>
        </>
      )}

      <nav className="tabbar" aria-label="주 메뉴">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'tab-on' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}
