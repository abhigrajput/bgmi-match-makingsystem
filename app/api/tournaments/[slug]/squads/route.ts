import { NextResponse } from 'next/server';

import { authenticate, isResponse, jsonError } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTournamentBySlug, loadSquads } from '@/lib/tournaments/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tournaments/[slug]/squads -- formed squads with members, roles,
 * ratings and reasons.
 *
 * Why a service-role route and not a page query: matches and
 * match_participants are visible only to the players seated in them (0003),
 * which is right for private match history but means a tournament page could
 * not show anyone the squad list. Squad lineups of a tournament are public to
 * signed-in players by design, so this route reads them with the service role
 * after authenticating the caller -- and returns only lineup fields: no
 * feedback, no preferences, no availability.
 */
export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const caller = await authenticate();
  if (isResponse(caller)) return caller;

  const db = createAdminClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tournament = await getTournamentBySlug(db, params.slug);
  if (!tournament) return jsonError('No tournament with that link.', 404);

  const squads = await loadSquads(db, tournament.id);
  return NextResponse.json({ squads, summary: tournament.formation_summary });
}
