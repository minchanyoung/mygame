/** §20.1 턴 계약: turnIndex=0은 시작 나이의 1월. */
export interface TurnInfo {
  turnIndex: number;
  yearIndex: number;
  monthOfYear: number;
  age: number;
}

export function turnInfo(turnIndex: number, startAge: number): TurnInfo {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) throw new RangeError(`invalid turnIndex: ${turnIndex}`);
  const yearIndex = Math.floor(turnIndex / 12);
  return { turnIndex, yearIndex, monthOfYear: (turnIndex % 12) + 1, age: startAge + yearIndex };
}
