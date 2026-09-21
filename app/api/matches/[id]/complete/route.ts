import { NextResponse } from 'next/server';

import { authenticate, isResponse, jsonError } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/matches/[id]/complete -- a participant marks their match played.
 *
 * Participation is checked with the USER's client: under 0003 a match is only
 * visible to its participants, so "can I see it" is exactly "was I in it".
 * Only then does the route use the service role, because clients hold no
 * UPDATE on matches -- a client that could write status could also write
 * synergy_score and scoring_source, which would let a player forge the
 * provenance the model is later evaluated on.
 *
 * Timestamps are set here, server-side: started_at keeps any existing value
 * (or is stamped now), ended_at is now, which satisfies the
 * matches_timeline_ordered CHECK. Completing unlocks feedback (0003 requires
 * status = 'completed' for a feedback INSERT).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const caller = await authenticate();
  if (isResponse(caller)) return caller;

  const supabase = createClient();
  const { data: visible } = await supabase
    .from('matches')
    .select('id, status, started_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!visible) return jsonError('Match not found, or you did not play in it.', 404);
  if (visible.status === 'completed') return NextResponse.json({ ok: true, alreadyCompleted: true });
  if (visible.status === 'abandoned') return jsonError('An abandoned match cannot be completed.', 409);

  const now = new Date().toISOString();
  const db = createAdminClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db
    .from('matches')
    .update({ status: 'completed', started_at: visible.started_at ?? now, ended_at: now })
    .eq('id', params.id);
  if (error) return jsonError('Could not complete the match. Try again.', 500);

  return NextResponse.json({ ok: true });
}
