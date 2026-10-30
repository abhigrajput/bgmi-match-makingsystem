import { createHash } from 'node:crypto';

import { headers } from 'next/headers';

import { createAnonClient } from '@/lib/supabase/server';

/**
 * Per-IP limits, counted in Postgres by rate_limit_hit() (0009). Serverless
 * instances share nothing in memory, so a counter held here would reset on every
 * cold start and count separately on every instance.
 *
 * Fails open: when the counter cannot be reached, the action behind it needs
 * Supabase as well and will report the outage itself. A limiter must not be what
 * takes down sign-in.
 */

export const RATE_LIMITS = {
  contact: { max: 5, windowSeconds: 3600 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** On Vercel these are set by the platform, not the caller. */
export function clientIp(source: Headers = headers()): string {
  return (
    source.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    source.get('x-real-ip')?.trim() ||
    source.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Never the address itself: only this hash reaches the database. */
export function rateLimitKey(bucket: string, ip: string): string {
  const hash = createHash('sha256')
    .update(`${process.env.RATE_LIMIT_SALT ?? ''}:${ip}`)
    .digest('hex');
  return `${bucket}:${hash}`;
}

export async function underRateLimit(bucket: RateLimitBucket): Promise<boolean> {
  const { max, windowSeconds } = RATE_LIMITS[bucket];
  try {
    const { data, error } = await createAnonClient().rpc('rate_limit_hit', {
      p_key: rateLimitKey(bucket, clientIp()),
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
