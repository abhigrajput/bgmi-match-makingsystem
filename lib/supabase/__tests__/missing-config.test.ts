import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A build without NEXT_PUBLIC_SUPABASE_ANON_KEY once answered 500 on /login.
 * The values are read at import in some of these modules, hence resetModules
 * and a dynamic import per test.
 */

const FAKE_URL = 'https://example.supabase.co';
const FAKE_KEY = 'fake-anon-key-must-never-appear';
const ORIGIN = 'https://app.example';

vi.mock('next/headers', () => ({
  headers: () => new Headers(),
  cookies: () => ({ getAll: () => [], set: () => undefined }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', FAKE_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const request = (path: string, cookie?: string) =>
  new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);

describe('missingSupabaseConfig', () => {
  it('names only what is missing', async () => {
    const { missingSupabaseConfig } = await import('../config');
    expect(missingSupabaseConfig()).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(missingSupabaseConfig()).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', FAKE_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', FAKE_KEY);
    expect(missingSupabaseConfig()).toEqual([]);
  });
});

describe('/api/health without the anon key', () => {
  it('answers 503 and names the variable', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'misconfigured',
      missing: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    });
  });

  it('never includes the value of the variable that is set', async () => {
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).text();

    expect(body).not.toContain(FAKE_URL);
  });
});

describe('middleware without the anon key', () => {
  it('sends a protected page to /login?error=service', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(request('/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=service`);
  });

  it('does the same when the request carries a session cookie', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(request('/profile/edit', 'sb-x-auth-token=stale'));

    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=service`);
  });

  it.each(['/', '/login', '/signup', '/forgot-password', '/api/health'])('lets %s through', async (path) => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(request(path, 'sb-x-auth-token=stale'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('isSupabaseUnreachable', () => {
  it('is true without the anon key, so public pages skip the throwing client', async () => {
    const { isSupabaseUnreachable } = await import('../server');
    expect(isSupabaseUnreachable()).toBe(true);
  });

  it('is false when configured and middleware reported nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', FAKE_KEY);
    const { isSupabaseUnreachable } = await import('../server');
    expect(isSupabaseUnreachable()).toBe(false);
  });
});
