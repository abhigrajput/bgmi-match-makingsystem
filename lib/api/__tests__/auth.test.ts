import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * authenticate() when the build has no Supabase settings: an API caller gets a
 * 503 it can act on, not the 500 the throwing server client would produce, and
 * not a 401 telling a signed-in player they are signed out.
 */

const state = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: state.createClient }));

import { authenticate } from '../auth';

const FAKE_URL = 'https://example.supabase.co';

beforeEach(() => {
  state.createClient.mockReset();
  state.createClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', FAKE_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authenticate', () => {
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])(
    'answers 503 without %s, before building a client',
    async (name) => {
      vi.stubEnv(name, '');

      const result = await authenticate();

      expect(result).toBeInstanceOf(NextResponse);
      const response = result as NextResponse;
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Service unavailable.' });
      expect(state.createClient).not.toHaveBeenCalled();
    },
  );

  it('does not put configuration in the 503 body', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    const body = await ((await authenticate()) as NextResponse).text();

    expect(body).not.toContain(FAKE_URL);
    expect(body).not.toContain('NEXT_PUBLIC');
  });

  it('still answers 401 for a signed-out caller when configured', async () => {
    const result = await authenticate();

    expect((result as NextResponse).status).toBe(401);
    expect(state.createClient).toHaveBeenCalledOnce();
  });
});
