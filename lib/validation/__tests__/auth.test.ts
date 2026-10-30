import { describe, expect, it } from 'vitest';

import { bgmiIgnSchema, loginSchema, passwordSchema, signupSchema } from '@/lib/validation/auth';

const valid = {
  email: 'player@squadsync-e2e.test',
  password: 'long-enough-1',
  display_name: 'Player One',
  bgmi_ign: 'Player_One',
  region: 'India-South',
  primary_role: 'sniper',
};

const errorsFor = (input: Record<string, unknown>) => {
  const result = signupSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
};

describe('signupSchema', () => {
  it('accepts a complete, valid signup', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['email', 'not-an-email'],
    ['password', 'nine-char'],
    ['bgmi_ign', 'ab'],
    ['bgmi_ign', 'a'.repeat(21)],
    ['bgmi_ign', 'has space'],
    ['region', ''],
    ['region', 'Mars'],
    ['primary_role', ''],
    ['primary_role', 'captain'],
  ])('rejects %s = %j', (field, value) => {
    expect(errorsFor({ ...valid, [field]: value })).toEqual([field]);
  });
});

describe('password and IGN limits', () => {
  it('password: 10 is the minimum and 72 the maximum', () => {
    expect(passwordSchema.safeParse('a'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
  });

  it('IGN: 3 to 20 characters, from the allowed set', () => {
    expect(bgmiIgnSchema.safeParse('abc').success).toBe(true);
    expect(bgmiIgnSchema.safeParse('a'.repeat(20)).success).toBe(true);
    expect(bgmiIgnSchema.safeParse('a.b_c-d').success).toBe(true);
    expect(bgmiIgnSchema.safeParse('a'.repeat(21)).success).toBe(false);
    expect(bgmiIgnSchema.safeParse('a<b>c').success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not apply the signup password rules, so older accounts can still sign in', () => {
    expect(loginSchema.safeParse({ email: valid.email, password: 'short' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false);
  });
});
