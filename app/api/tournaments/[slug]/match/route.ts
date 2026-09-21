import { NextResponse } from 'next/server';

import { authenticate, isResponse, jsonError } from '@/lib/api/auth';
import { runFormation } from '@/lib/scoring/formation';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getTournamentBySlug,
  loadRegistrantVectors,
  loadSquads,
  persistFormation,
} from '@/lib/tournaments/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tournaments/[slug]/match -- form squads for a tournament.
 *
 * 1. Authenticate the caller (401).
 * 2. 404 for an unknown slug; 409 unless the tournament is open and has at
 *    least one squad's worth of registrations.
 * 3. Claim the tournament by flipping status open -> matched in ONE
 *    conditional UPDATE. Two concurrent presses of "Form squads" both pass
 *    step 2, but only one of them can win this update; the other gets 409
 *    instead of a second, duplicate set of squads.
 * 4. Run the optimizer (ML scorer when model.json is valid) and the rank-only
 *    baseline on the same pool.
 * 5. Insert matches + participants and the formation summary. On any failure,
 *    delete what was inserted and re-open the tournament.
 *
 * Any signed-in player may trigger formation. There is no organiser role in
 * this prototype; docs/security.md records that as a known limitation.
 */
export async function POST(_request: Request, { params }: { params: { slug: string } }) {
  const caller = await authenticate();
  if (isResponse(caller)) return caller;

  const db = createAdminClient(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const tournament = await getTournamentBySlug(db, params.slug);
  if (!tournament) return jsonError('No tournament with that link.', 404);
  if (tournament.status !== 'open') {
    return jsonError('Squads have already been formed for this tournament.', 409);
  }

  const players = await loadRegistrantVectors(db, tournament.id);
  if (players.length < tournament.squad_size) {
    return jsonError(
      `Need at least ${tournament.squad_size} registered players to form a squad; ${players.length} registered.`,
      409,
    );
  }

  const { data: claimed, error: claimError } = await db
    .from('tournaments')
    .update({ status: 'matched' })
    .eq('id', tournament.id)
    .eq('status', 'open')
    .select('id');
  if (claimError) return jsonError('Could not start squad formation. Try again.', 500);
  if (!claimed || claimed.length === 0) {
    return jsonError('Squads are already being formed for this tournament.', 409);
  }

  try {
    const run = runFormation(players, tournament.squad_size);
    await persistFormation(db, tournament, run);
    const squads = await loadSquads(db, tournament.id);
    return NextResponse.json({
      squads,
      unmatched: run.summary.unmatched,
      comparison: run.summary.comparison,
      summary: run.summary,
    });
  } catch (error) {
    await db.from('tournaments').update({ status: 'open' }).eq('id', tournament.id);
    console.error('Squad formation failed', error);
    return jsonError('Squad formation failed and was rolled back. Try again.', 500);
  }
}
