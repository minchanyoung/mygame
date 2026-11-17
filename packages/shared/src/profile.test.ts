import { describe, expect, it } from 'vitest';
import { validateProfileInput } from './profile';

const banned = ['운영자', 'admin'];

describe('validateProfileInput (§3.1)', () => {
  it('trims surrounding whitespace and keeps the rest as typed', () => {
    const r = validateProfileInput({ displayName: '  김 하늘  ', gender: 'FEMALE' }, banned);
    expect(r).toEqual({ ok: true, profile: { displayName: '김 하늘', gender: 'FEMALE' } });
  });

  it('accepts UNSPECIFIED as a valid gender', () => {
    expect(validateProfileInput({ displayName: 'Sky', gender: 'UNSPECIFIED' }, banned).ok).toBe(true);
  });

  it.each([
    [{ gender: 'MALE' }, 'REQUIRED'],
    [{ displayName: '   ', gender: 'MALE' }, 'REQUIRED'],
    [{ displayName: '김', gender: 'MALE' }, 'TOO_SHORT'],
    [{ displayName: '가'.repeat(17), gender: 'MALE' }, 'TOO_LONG'],
    [{ displayName: '<script>', gender: 'MALE' }, 'INVALID_CHARACTERS'],
    [{ displayName: '운 영 자', gender: 'MALE' }, 'BANNED_WORD'],
    [{ displayName: 'ADMIN', gender: 'MALE' }, 'BANNED_WORD'],
    [{ displayName: '김하늘' }, 'REQUIRED'],
    [{ displayName: '김하늘', gender: 'ROBOT' }, 'INVALID_GENDER'],
  ])('rejects %j with %s', (input, code) => {
    const r = validateProfileInput(input, banned);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain(code);
  });

  it('counts length by code points (16 Hangul syllables is OK)', () => {
    expect(validateProfileInput({ displayName: '가'.repeat(16), gender: 'OTHER' }, banned).ok).toBe(true);
  });
});
