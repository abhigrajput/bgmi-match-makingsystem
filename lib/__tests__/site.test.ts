import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIVE_URL, siteUrl } from '@/lib/site';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteUrl', () => {
  it('uses NEXT_PUBLIC_SITE_URL when set, without a trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://squads.test/');
    expect(siteUrl()).toBe('https://squads.test');
  });

  it('falls back to the live URL in production', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(siteUrl()).toBe(LIVE_URL);
  });

  it('falls back to localhost in development', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(siteUrl()).toBe('http://localhost:3000');
  });
});
