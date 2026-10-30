import { describe, expect, it } from 'vitest';

import { AUTH_FORM_MESSAGES, classifyAuthError, type AuthFailure } from '@/lib/auth/errors';

/**
 * The first block uses error shapes observed against the local Supabase stack
 * on 2026-10-30 (Task.md, local reproduction). The rest are GoTrue's documented
 * codes for cases that were not reproduced.
 */
describe('classifyAuthError: observed shapes', () => {
  it('wrong email or password', () => {
    expect(
      classifyAuthError({
        name: 'AuthApiError',
        status: 400,
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
      }),
    ).toBe('invalid_credentials');
  });

  it('duplicate IGN, which arrives as a retryable 500, is not an outage', () => {
    expect(
      classifyAuthError({
        name: 'AuthRetryableFetchError',
        status: 500,
        message: 'Database error saving new user',
      }),
    ).toBe('ign_taken');
  });

  it('Supabase stopped or paused (connection refused, DNS failure, frozen gateway)', () => {
    expect(
      classifyAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }),
    ).toBe('service_unavailable');
  });
});

describe('classifyAuthError: documented codes', () => {
  const cases: Array<[string, Parameters<typeof classifyAuthError>[0], AuthFailure]> = [
    ['request rate limit', { status: 429, code: 'over_request_rate_limit' }, 'rate_limited'],
    ['email send limit', { status: 429, code: 'over_email_send_rate_limit' }, 'rate_limited'],
    ['bare 429', { status: 429 }, 'rate_limited'],
    ['weak password', { status: 422, code: 'weak_password' }, 'weak_password'],
    ['duplicate email (code)', { status: 422, code: 'user_already_exists' }, 'email_taken'],
    ['duplicate email (email_exists)', { status: 422, code: 'email_exists' }, 'email_taken'],
    ['duplicate email (old wording)', { status: 400, message: 'User already registered' }, 'email_taken'],
    ['unconfirmed email', { status: 400, code: 'email_not_confirmed' }, 'email_not_confirmed'],
    ['middleware deadline', { name: 'DeadlineExceededError' }, 'service_unavailable'],
    ['gateway 503', { status: 503, message: 'upstream unavailable' }, 'service_unavailable'],
    ['unrecognised 400', { status: 400, code: 'something_new' }, 'unknown'],
  ];

  it.each(cases)('%s', (_label, error, expected) => {
    expect(classifyAuthError(error)).toBe(expected);
  });
});

describe('messages', () => {
  it('never tells a user with an outage that their password is wrong', () => {
    expect(AUTH_FORM_MESSAGES.service_unavailable).not.toMatch(/password/i);
    expect(AUTH_FORM_MESSAGES.rate_limited).not.toMatch(/incorrect/i);
  });

  it('uses no em or en dashes in user-facing copy', () => {
    for (const message of Object.values(AUTH_FORM_MESSAGES)) {
      expect(message).not.toMatch(/[–—]/);
    }
  });
});
