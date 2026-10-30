/**
 * Time limits for every call this app makes to Supabase.
 *
 * A Supabase project that is paused, restoring or overloaded does not always
 * refuse connections -- it can accept them and never answer. Without a limit,
 * the request that is waiting on it waits too, and on Vercel that ends with the
 * function being killed at 25 seconds and the user seeing nothing. This was the
 * production failure on 2026-10-30 (Task.md, Phase 1).
 *
 * Two layers, because one is not enough:
 *
 *   - `fetchWithTimeout` bounds each HTTP request. It is passed to the Supabase
 *     clients as their `global.fetch`.
 *   - `withDeadline` bounds a whole operation. auth-js retries a failed token
 *     refresh with backoff for up to 30 seconds, so a per-request limit on its
 *     own still lets `getUser()` run past Vercel's cut-off.
 *
 * Plain AbortController and setTimeout rather than AbortSignal.timeout/any:
 * this module runs in the Edge runtime (middleware), where those are not
 * guaranteed to exist.
 */

/** Protected routes: how long middleware waits to learn who the user is. */
export const MIDDLEWARE_PROTECTED_TIMEOUT_MS = 4000;

/**
 * Public routes: how long middleware waits to refresh a signed-in user's
 * session before rendering the page anyway. Short, because the page renders
 * fine without it.
 */
export const MIDDLEWARE_PUBLIC_TIMEOUT_MS = 1500;

/** Server components, server actions and route handlers. */
export const SERVER_FETCH_TIMEOUT_MS = 8000;

/** The landing page's public counts. The strip is optional, so give up fast. */
export const PUBLIC_STATS_TIMEOUT_MS = 1500;

/**
 * Request header middleware sets when Supabase did not answer, so the page
 * rendering behind it does not spend its own timeout asking again. A client
 * can send it too; the only effect is that it sees a public page signed out.
 */
export const SUPABASE_UNREACHABLE_HEADER = 'x-supabase-unreachable';

/** A `fetch` that aborts after `ms`, while still honouring the caller's signal. */
export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    return fetch(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
}

export class DeadlineExceededError extends Error {
  constructor(ms: number) {
    super(`Supabase did not respond within ${ms} ms`);
    this.name = 'DeadlineExceededError';
  }
}

/** Rejects with DeadlineExceededError if `promise` has not settled after `ms`. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
