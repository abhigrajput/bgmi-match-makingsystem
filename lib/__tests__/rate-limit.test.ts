import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: () => new Headers({ 'x-vercel-forwarded-for': '203.0.113.9' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAnonClient: () => ({ rpc: state.rpc }),
}));

import { clientIp, rateLimitKey, RATE_LIMITS, underRateLimit } from '../rate-limit';

beforeEach(() => {
  state.rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientIp', () => {
  it('prefers the platform header over the one a caller can send', () => {
    const source = new Headers({
      'x-vercel-forwarded-for': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1',
    });
    expect(clientIp(source)).toBe('203.0.113.9');
  });

  it('takes the first address of a list, and survives having none', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  it('does not contain the address, and fits the column', () => {
    const key = rateLimitKey('contact', '203.0.113.9');
    expect(key).not.toContain('203.0.113.9');
    expect(key.startsWith('contact:')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it('changes with the salt, the bucket and the address', () => {
    const base = rateLimitKey('contact', '203.0.113.9');
    expect(rateLimitKey('contact', '203.0.113.10')).not.toBe(base);
    expect(rateLimitKey('login', '203.0.113.9')).not.toBe(base);
    vi.stubEnv('RATE_LIMIT_SALT', 'salted');
    expect(rateLimitKey('contact', '203.0.113.9')).not.toBe(base);
  });
});

describe('underRateLimit', () => {
  it('passes the bucket limits to the database and returns its answer', async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });

    await expect(underRateLimit('contact')).resolves.toBe(false);
    expect(state.rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('contact', '203.0.113.9'),
      p_max: RATE_LIMITS.contact.max,
      p_window_seconds: RATE_LIMITS.contact.windowSeconds,
    });
  });

  it('allows the request when the counter returns an error', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(underRateLimit('contact')).resolves.toBe(true);
  });

  it('allows the request when the counter throws', async () => {
    state.rpc.mockRejectedValue(new Error('network'));
    await expect(underRateLimit('contact')).resolves.toBe(true);
  });
});
