import { NextResponse } from 'next/server';

import { loadPublicStats } from '@/lib/public-stats';

/**
 * GET /api/public-stats -- three public counts as JSON.
 *
 * Public by design: it returns three counts through public_stats(), which is
 * granted to anon. The counts include seeded demo rows, so the landing page does
 * not show them (Design.md); this route exists for anything else that wants them.
 *
 * Cached for a minute at the edge. The counts only move when someone signs up
 * or squads are formed.
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
