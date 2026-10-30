/**
 * Turns a Supabase auth error into something a person can act on.
 *
 * The login form used to answer every failure with "Incorrect email or
 * password", including the auth server being unreachable. On 2026-10-30 the
 * production project was paused, and users with correct passwords were told
 * their password was wrong (Task.md, Phase 1, H). This module exists so that
 * cannot happen again: each failure is classified once, here, and both server
 * actions render the message for its kind.
 *
 * Classification uses GoTrue's error `code` where it has one, then its HTTP
 * status, then -- only where GoTrue gives nothing better -- its message text.
 * The raw message is never shown to the user: it can contain the submitted
 * email address, and it is written for developers.
 */

export type AuthFailure =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  | 'ign_taken'
  | 'weak_password'
  | 'rate_limited'
  | 'service_unavailable'
  | 'unknown';

/** The fields of an AuthError this module reads. Kept structural for tests. */
export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

const EMAIL_TAKEN_CODES = new Set(['user_already_exists', 'email_exists']);

export function classifyAuthError(error: AuthErrorLike): AuthFailure {
  const code = error.code ?? '';
  const status = error.status ?? 0;
  const message = error.message ?? '';

  if (RATE_LIMIT_CODES.has(code) || status === 429) return 'rate_limited';
  if (code === 'weak_password') return 'weak_password';
  if (EMAIL_TAKEN_CODES.has(code) || /already registered/i.test(message)) {
    return 'email_taken';
  }

  /**
   * The IGN collision. handle_new_user() raises 23505 naming the IGN, and
   * GoTrue replaces that with "Database error saving new user", status 500,
   * reported by supabase-js as an AuthRetryableFetchError -- the same class as a
   * network failure (reproduced locally, Task.md). So it is matched on message
   * and checked BEFORE the network case below. The trigger raises for nothing
   * else by design, which is why this wording is attributed to the IGN.
   */
  if (/database error saving new user|already taken/i.test(message)) {
    return 'ign_taken';
  }

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'invalid_credentials';
  }
  if (code === 'email_not_confirmed') return 'email_not_confirmed';

  // Timeouts, refused connections, DNS failures (a paused project) and 5xx.
  if (
    error.name === 'AuthRetryableFetchError' ||
    error.name === 'DeadlineExceededError' ||
    status === 0 ||
    status >= 500
  ) {
    return 'service_unavailable';
  }

  return 'unknown';
}

export const SERVICE_UNAVAILABLE_MESSAGE =
  "We can't reach the sign-in service right now. Your account is fine. Please try again in a minute.";

/** Shown above the form. Field-level messages live in the actions. */
export const AUTH_FORM_MESSAGES: Record<AuthFailure, string> = {
  // One message whether the email or the password was wrong, so the form does
  // not reveal which addresses have accounts.
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed:
    'Confirm your email first. Open the link we sent you, then sign in.',
  email_taken: 'An account with this email already exists. Sign in instead.',
  ign_taken: 'That in-game name is already taken. Choose another one.',
  weak_password:
    'That password is too easy to guess. Use a longer one that is not a common password.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  service_unavailable: SERVICE_UNAVAILABLE_MESSAGE,
  unknown: 'Something went wrong. Please try again.',
};

/**
 * Server-side log line for a failed auth call. Kind, status and code only:
 * never the message (it can contain the email) and never the input.
 */
export function logAuthFailure(action: 'login' | 'signup', kind: AuthFailure, error: AuthErrorLike) {
  if (kind === 'invalid_credentials') return; // Expected, not an incident.
  console.error(
    JSON.stringify({
      event: 'auth_failure',
      action,
      kind,
      status: error.status ?? null,
      code: error.code ?? null,
    }),
  );
}
