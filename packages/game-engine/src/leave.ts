import type { GameRunState, LeaveState } from '@company-life/shared';
import type { ContentIndex } from './content-index';

/**
 * C4 휴직: 스스로 고르는 쉼. 실직이 아니므로 게임오버 규칙과 무관하다.
 * 휴직 중에는 월급이 줄고(무급이면 0), 회복이 커지고, 업무 칸은 '휴직 중' 사건이 된다.
 * 연말 평가는 건너뛰고, 직급 근속은 휴직한 만큼 멈춘다(시작할 때 rankSinceTurn을 미룬다).
 */
export function onLeave(state: GameRunState): boolean {
  return !!state.leave && state.turnIndex < state.leave.untilTurn;
}

export function startLeave(state: GameRunState, months: number, payPermille: number): GameRunState {
  const job = state.employment.current;
  if (!job || state.employment.status !== 'EMPLOYED' || onLeave(state)) return state;
  // 휴직은 사건을 고른 다음 달부터
  const startTurn = state.turnIndex + 1;
  const leave: LeaveState = { startTurn, untilTurn: startTurn + months, payPermille };
  return {
    ...state,
    leave,
    employment: { ...state.employment, current: { ...job, rankSinceTurn: job.rankSinceTurn + months } },
  };
}

/** 이번 달 월급 배율(‰)과 추가 회복 */
export function leaveSettlement(state: GameRunState, content: ContentIndex) {
  if (!onLeave(state)) return { payPermille: 1000, recovery: {} as Record<string, number> };
  return { payPermille: state.leave!.payPermille, recovery: content.pack.rules.leave.recovery };
}

export function leaveMonthsLeft(state: GameRunState): number {
  return onLeave(state) ? state.leave!.untilTurn - state.turnIndex : 0;
}
