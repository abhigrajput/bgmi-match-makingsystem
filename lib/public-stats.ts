/**
 * The three headline counts for the landing page: players, tournaments,
 * squads formed.
 *
 * Read through the public_stats() SQL function (0005), which is SECURITY
 * DEFINER and returns three integers. That is the whole point of it: anon has
 * no SELECT on profiles or matches, and should not -- but "how many players are
 * there" is not private, and a counting function exposes exactly that and
 * nothing a row-level read would.
 *
 * Uses a cookie-less anon client rather than lib/supabase/server: the counts
 * are the same for every visitor, so there is no session to attach, and
 * reading cookies would make every caller dynamic for no reason.
 */

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type PublicStats = {
  players: number;
  tournaments: number;
  squads_formed: number;
};

/**
 * Returns null on ANY failure -- missing env, network, the function not
 * existing yet on a database that predates 0005. The landing page hides the
 * strip on null rather than printing zeros, because "0 players" is a claim and
 * a failed query is not evidence for it.
 */
export async function loadPublicStats(): Promise<PublicStats | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const supabase = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('public_stats');
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      players: Number(row.players),
      tournaments: Number(row.tournaments),
      squads_formed: Number(row.squads_formed),
    };
  } catch {
    return null;
  }
}
