import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicRunView } from '@company-life/shared';
import {
  api,
  ApiRequestError,
  loadSession,
  newIdempotencyKey,
  playtestApi,
  saveSession,
  type Session,
} from './api';
import { PlaytestPanel } from './components/PlaytestPanel';
import { CharacterSelect } from './screens/CharacterSelect';
import { EndingScreen } from './screens/EndingScreen';
import { EventScreen } from './screens/EventScreen';
import { MonthSummary } from './screens/MonthSummary';
import { JobOffers } from './screens/JobOffers';
import { ProfileForm } from './screens/ProfileForm';
import { Start } from './screens/Start';
import { Workplace } from './screens/Workplace';

type Screen =
  { kind: 'start' } | { kind: 'profile' } | { kind: 'run'; session: Session; view: PublicRunView };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'start' });
  const [savedSession, setSavedSession] = useState<Session | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 같은 행동의 재시도는 같은 idempotencyKey를 써서 서버에서 한 번만 적용되게 한다
  const pendingKey = useRef<{ action: string; key: string } | null>(null);

  const keyFor = (action: string) => {
    if (pendingKey.current?.action !== action) pendingKey.current = { action, key: newIdempotencyKey() };
    return pendingKey.current.key;
  };

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 409) {
      setError('게임 상태가 바뀌었습니다. 최신 상태를 불러왔어요.');
    } else if (err instanceof ApiRequestError) {
      setError(err.body?.message ?? '요청을 처리하지 못했습니다.');
    } else {
      setError('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
    }
  }, []);

  const resume = useCallback(
    async (session: Session) => {
      setBusy(true);
      setError(null);
      try {
        const view = await api.getRun(session);
        setScreen({ kind: 'run', session, view });
      } catch (err) {
        if (err instanceof ApiRequestError && [401, 403, 404, 500, 503].includes(err.status)) {
          // 다른 서버/이전 콘텐츠 버전의 저장이면 불러올 수 없다 — 새 게임으로 안내
          saveSession(null);
          setSavedSession(null);
          setError('이어할 게임을 불러올 수 없습니다. 새 게임을 시작해 주세요.');
        } else {
          handleError(err);
        }
      } finally {
        setBusy(false);
      }
    },
    [handleError],
  );

  useEffect(() => {
    document.title =
      screen.kind === 'run' ? `${screen.view.profile.displayName}의 인생 — 회사원 키우기` : '회사원 키우기';
  }, [screen]);

  // 화면 단계가 바뀌면 맨 위로 (모바일에서 이전 화면 스크롤 위치가 남지 않게)
  const phaseKey = screen.kind === 'run' ? `${screen.view.phase}:${screen.view.turn.turnIndex}` : screen.kind;
  useEffect(() => {
    try {
      window.scrollTo({ top: 0 });
    } catch {
      // 일부 환경에서 scrollTo 옵션 미지원
    }
  }, [phaseKey]);

  const [playtestEnabled, setPlaytestEnabled] = useState(false);
  useEffect(() => {
    playtestApi.status().then(
      (s) => setPlaytestEnabled(s.enabled),
      () => setPlaytestEnabled(false),
    );
  }, []);

  const createRun = async (displayName: string, gender: Parameters<typeof api.createRun>[1]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createRun(displayName, gender);
      const session = { runId: res.runId, guestToken: res.guestToken };
      saveSession(session);
      setSavedSession(session);
      setScreen({ kind: 'run', session, view: res.view });
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const command = async (
    action: string,
    fn: (s: Session, view: PublicRunView, key: string) => Promise<PublicRunView>,
  ) => {
    if (screen.kind !== 'run' || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const view = await fn(screen.session, screen.view, keyFor(action));
      pendingKey.current = null;
      setScreen({ kind: 'run', session: screen.session, view });
    } catch (err) {
      handleError(err);
      if (err instanceof ApiRequestError && err.status === 409) {
        pendingKey.current = null;
        await resume(screen.session);
      }
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (screen.kind === 'start') {
    body = (
      <Start
        canResume={savedSession !== null}
        busy={busy}
        onNew={() => setScreen({ kind: 'profile' })}
        onResume={() => savedSession && resume(savedSession)}
      />
    );
  } else if (screen.kind === 'profile') {
    body = <ProfileForm busy={busy} onSubmit={createRun} onBack={() => setScreen({ kind: 'start' })} />;
  } else {
    const { view } = screen;
    switch (view.phase) {
      case 'CHARACTER_SELECTION':
        body = (
          <CharacterSelect
            view={view}
            busy={busy}
            onConfirm={(cardId) =>
              command(
                `character:${cardId}`,
                async (s, v, key) => (await api.chooseCharacter(s, cardId, v.revision, key)).view,
              )
            }
          />
        );
        break;
      case 'JOB_OFFERS':
        body = (
          <JobOffers
            view={view}
            busy={busy}
            onApply={(offerId) =>
              command(`apply:${offerId}`, async (s, v, key) => {
                const res = await api.applyJob(s, offerId, v.revision, key);
                setNotice(
                  res.result.hired
                    ? `${res.result.companyName ?? '회사'}에 합격했습니다!`
                    : `${res.result.companyName ?? '회사'} 불합격… ${res.result.joinedCompanyName ?? '확정 회사'}에 입사했습니다.`,
                );
                return res.view;
              })
            }
          />
        );
        break;
      case 'MONTH_START':
        body = (
          <Workplace
            view={view}
            busy={busy}
            onHome={() => setScreen({ kind: 'start' })}
            onStartMonth={() =>
              command(
                `start:${view.turn.turnIndex}`,
                async (s, v, key) => (await api.startMonth(s, v.revision, key)).view,
              )
            }
          />
        );
        break;
      case 'EVENT_PENDING':
        body = (
          <EventScreen
            view={view}
            busy={busy}
            onChoose={(occurrenceId, choiceId) =>
              command(
                `choose:${occurrenceId}:${choiceId}`,
                async (s, v, key) => (await api.choose(s, occurrenceId, choiceId, v.revision, key)).view,
              )
            }
          />
        );
        break;
      case 'MONTH_SUMMARY':
        body = (
          <MonthSummary
            view={view}
            busy={busy}
            onNext={() =>
              command(
                `next:${view.turn.turnIndex}`,
                async (s, v, key) => (await api.nextMonth(s, v.revision, key)).view,
              )
            }
          />
        );
        break;
      case 'GAME_OVER':
        body = (
          <EndingScreen
            view={view}
            onHome={() => setScreen({ kind: 'start' })}
            onNewGame={() => {
              saveSession(null);
              setSavedSession(null);
              setScreen({ kind: 'profile' });
            }}
          />
        );
        break;
      default:
        body = null;
    }
  }

  const playtest =
    playtestEnabled && screen.kind === 'run' && screen.view.phase !== 'CHARACTER_SELECTION' ? (
      <PlaytestPanel
        session={screen.session}
        view={screen.view}
        busy={busy}
        run={(action, fn) => command(action, (_s, _v, key) => fn(key))}
      />
    ) : null;

  return (
    <div className="app">
      <header className="app-header">
        <span className="logo">회사원 키우기</span>
        {screen.kind === 'run' && (
          <span className="header-meta">
            {screen.view.profile.displayName} · {screen.view.turn.age}세 {screen.view.turn.monthOfYear}월
          </span>
        )}
      </header>
      {error && (
        <div className="banner banner-error" role="alert">
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div className="banner banner-info" role="status">
          ℹ️ {notice}
        </div>
      )}
      <main className="app-main">
        {body}
        {playtest}
      </main>
    </div>
  );
}
