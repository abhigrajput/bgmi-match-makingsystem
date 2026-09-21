import { NextResponse } from 'next/server';

import { authenticate, isResponse, jsonError } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTournamentBySlug } from '@/lib/tournaments/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tournaments/[slug]/reset -- undo squad formation on a DEMO
 * tournament so it can be formed live again.
 *
 * Refused (403) for any tournament that is not is_seed. Deleting a real
 * tournament's matches would destroy other players' match history and
 * feedback; the flag is what limits this route to demo data.
 */
export async function POST(_request: Request, { params }: { params: { slug: string } }) {
  const caller = await authenticate();
  if (isResponse(caller)) return caller;

  const db = createAdminClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tournament = await getTournamentBySlug(db, params.slug);
  if (!tournament) return jsonError('No tournament with that link.', 404);
  if (!tournament.is_seed) {
    return jsonError('Only demo tournaments can be reset.', 403);
  }

  const { error: deleteError } = await db.from('matches').delete().eq('tournament_id', tournament.id);
  if (deleteError) return jsonError('Could not remove the formed squads. Try again.', 500);

  const { error: updateError } = await db
    .from('tournaments')
    .update({ status: 'open', formation_summary: null, formed_at: null })
    .eq('id', tournament.id);
  if (updateError) return jsonError('Squads were removed but the tournament could not be reopened.', 500);

  return NextResponse.json({ ok: true });
}
