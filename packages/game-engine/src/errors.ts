export type EngineErrorCode =
  | 'INVALID_PHASE'
  | 'INVALID_TRANSITION'
  | 'CARD_NOT_FOUND'
  | 'OFFER_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'CHOICE_NOT_AVAILABLE'
  | 'LEVEL_MISMATCH'
  | 'UNKNOWN_REFERENCE'
  | 'CONTENT_VERSION_MISMATCH'
  | 'INVARIANT_VIOLATION';

/** 게임 규칙 위반. API 계층에서 400/409 등으로 매핑된다. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: unknown;

  constructor(code: EngineErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details ?? null;
  }
}
