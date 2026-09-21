import { NextResponse } from 'next/server';

import { loadPublicStats } from '@/lib/public-stats';

/**
 * GET /api/public-stats -- the landing page's stat strip as JSON.
 *
 * Public by design: it returns three counts through public_stats(), which is
 * granted to anon. The landing page itself calls loadPublicStats() directly
 * rather than fetching this route, since a server component fetching its own
 * origin is a wasted round trip; the route exists for anything outside the
 * page that wants the same numbers.
 *
 * Cached for a minute at the edge. The counts only move when someone signs up
 * or squads are formed, and a landing page is the most-hit route in the app.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = await loadPublicStats();

  if (!stats) {
    return NextResponse.json(
      { error: 'Stats are unavailable right now.' },
      { status: 503 },
    );
  }

  return NextResponse.json(stats, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
