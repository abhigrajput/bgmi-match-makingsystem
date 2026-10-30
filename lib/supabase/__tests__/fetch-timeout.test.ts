import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeadlineExceededError,
  fetchWithTimeout,
  withDeadline,
} from '@/lib/supabase/fetch-timeout';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch that never answers unless its signal aborts, like a frozen gateway. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
}

describe('fetchWithTimeout', () => {
  it('aborts a request that never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = fetchWithTimeout(4000)('https://supabase.test/auth/v1/user');
    const assertion = expect(pending).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
  });

  it('passes a prompt response through untouched', async () => {
    const response = new Response('ok');
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(fetchWithTimeout(4000)('https://supabase.test')).resolves.toBe(response);
  });

  it('opts out of the Next.js fetch cache', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'));
    vi.stubGlobal('fetch', spy);

    await fetchWithTimeout(4000)('https://supabase.test');
    expect(spy.mock.calls[0]![1]?.cache).toBe('no-store');
  });

  it('still honours an abort from the caller', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const caller = new AbortController();

    const pending = fetchWithTimeout(60_000)('https://supabase.test', { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});

describe('withDeadline', () => {
  it('rejects once the deadline passes, even if the work never settles', async () => {
    vi.useFakeTimers();

    const pending = withDeadline(new Promise(() => {}), 4000);
    const assertion = expect(pending).rejects.toBeInstanceOf(DeadlineExceededError);
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
  });

  it('returns the value when the work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('user'), 4000)).resolves.toBe('user');
  });
});
