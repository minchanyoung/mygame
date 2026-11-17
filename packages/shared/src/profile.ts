import { z } from 'zod';
import { GenderSchema } from './enums';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 16;
/** 한글·영문·숫자·공백·마침표·밑줄·하이픈 허용 (초기 정책, 서버 검증). */
const DISPLAY_NAME_PATTERN = /^[\p{Script=Hangul}A-Za-z0-9 ._-]+$/u;

export const PlayerProfileSchema = z
  .object({
    displayName: z.string().min(DISPLAY_NAME_MIN).max(64),
    gender: GenderSchema,
  })
  .strict();
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export interface ProfileIssue {
  field: 'displayName' | 'gender';
  code: 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_CHARACTERS' | 'BANNED_WORD' | 'INVALID_GENDER';
  message: string;
}

export type ProfileValidationResult =
  { ok: true; profile: PlayerProfile } | { ok: false; issues: ProfileIssue[] };

/**
 * 이름·성별 입력 검증 (§3.1). 앞뒤 공백만 제거하고 나머지 입력은 그대로 보존한다.
 * 길이는 코드 포인트 기준. 금칙어 목록은 콘텐츠 정책 데이터에서 주입한다.
 */
export function validateProfileInput(raw: unknown, bannedWords: readonly string[]): ProfileValidationResult {
  const issues: ProfileIssue[] = [];
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const rawName = obj['displayName'];
  let displayName = '';
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    issues.push({ field: 'displayName', code: 'REQUIRED', message: '이름을 입력해 주세요.' });
  } else {
    displayName = rawName.trim();
    const length = Array.from(displayName).length;
    if (length < DISPLAY_NAME_MIN) {
      issues.push({
        field: 'displayName',
        code: 'TOO_SHORT',
        message: `이름은 ${DISPLAY_NAME_MIN}자 이상이어야 합니다.`,
      });
    } else if (length > DISPLAY_NAME_MAX) {
      issues.push({
        field: 'displayName',
        code: 'TOO_LONG',
        message: `이름은 ${DISPLAY_NAME_MAX}자 이하여야 합니다.`,
      });
    } else if (!DISPLAY_NAME_PATTERN.test(displayName)) {
      issues.push({
        field: 'displayName',
        code: 'INVALID_CHARACTERS',
        message: '한글, 영문, 숫자, 공백, 「. _ -」만 사용할 수 있습니다.',
      });
    } else {
      const normalized = displayName.replace(/\s+/g, '').toLowerCase();
      if (bannedWords.some((w) => w.length > 0 && normalized.includes(w.replace(/\s+/g, '').toLowerCase()))) {
        issues.push({ field: 'displayName', code: 'BANNED_WORD', message: '사용할 수 없는 이름입니다.' });
      }
    }
  }

  const gender = GenderSchema.safeParse(obj['gender']);
  if (!gender.success) {
    issues.push({
      field: 'gender',
      code: obj['gender'] === undefined ? 'REQUIRED' : 'INVALID_GENDER',
      message: '성별을 선택해 주세요.',
    });
  }

  if (issues.length > 0 || !gender.success) return { ok: false, issues };
  return { ok: true, profile: { displayName, gender: gender.data } };
}
