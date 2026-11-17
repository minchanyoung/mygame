import type { RunCommand, RunPhase } from '@company-life/shared';
import { EngineError } from './errors';

/**
 * §23.3 API 상태 전이 표. 클라이언트가 임의 단계를 건너뛰지 못하도록
 * 모든 명령은 assertCommand → assertTransition을 통과해야 한다.
 */
export const TRANSITIONS: Readonly<Record<RunPhase, Partial<Record<RunCommand, readonly RunPhase[]>>>> = {
  PROFILE_INPUT: { createCards: ['CHARACTER_SELECTION'] },
  CHARACTER_SELECTION: { chooseCharacter: ['JOB_OFFERS'] },
  JOB_OFFERS: { apply: ['MONTH_START', 'JOB_OFFERS'] },
  MONTH_START: { startMonth: ['EVENT_PENDING', 'MONTH_SUMMARY'] },
  EVENT_PENDING: { choose: ['MONTH_SUMMARY'] },
  MONTH_SUMMARY: { nextMonth: ['MONTH_START', 'GAME_OVER'] },
  GAME_OVER: { getResult: ['GAME_OVER'] },
};

export function allowedCommands(phase: RunPhase): RunCommand[] {
  return Object.keys(TRANSITIONS[phase]) as RunCommand[];
}

export function assertCommand(phase: RunPhase, command: RunCommand): void {
  if (!TRANSITIONS[phase][command]) {
    throw new EngineError('INVALID_PHASE', `'${command}' is not allowed in phase ${phase}`, {
      phase,
      command,
      allowed: allowedCommands(phase),
    });
  }
}

export function assertTransition(from: RunPhase, command: RunCommand, to: RunPhase): void {
  assertCommand(from, command);
  const targets = TRANSITIONS[from][command] ?? [];
  if (!targets.includes(to)) {
    throw new EngineError('INVALID_TRANSITION', `${from} --${command}--> ${to} is not allowed`, {
      from,
      command,
      to,
    });
  }
}
