/**
 * Reads shared by /profile and /dashboard.
 *
 * Both pages need the same three things -- the signed-in player's profile, their
 * preferences, and their availability -- and both render the completeness
 * indicator from them. Two copies of these queries would drift, and the drift
 * would show as the dashboard and the profile page disagreeing about whether a
 * player is ready to be matched.
 *
 * This module is server-side only, and enforced as such without the
 * `server-only` package: it imports lib/supabase/server, which imports
 * `next/headers`, which Next refuses to bundle into a client component. So a
 * `'use client'` file that imports this fails the build already, and adding a
 * dependency to restate that would buy a clearer error message and nothing
 * else.
 *
 * Every read below is subject to policy. Preferences and availability are
 * scoped by 0003 to the owner, so `.eq('profile_id', ...)` states the intent
 * while the policy provides the guarantee.
 */

import { createClient } from '@/lib/supabase/server';
import type {
  PlayerAvailability,
  PlayerPreferences,
  PlayerStats,
  Profile,
} from '@/types/database';

export type PlayerOverview = {
  profile: Profile;
  /** null = never opened the preferences form. Not an error. */
  preferences: PlayerPreferences | null;
  /** Ordered for display: by day, then by start time within the day. */
  availability: PlayerAvailability[];
  /** null = no stats row. Read-only to the player; see PlayerStatsPanel. */
  stats: PlayerStats | null;
};

/**
 * Why this returns a reason instead of throwing or redirecting.
 *
 * Two of the three failures are states a page should explain rather than
 * bounce: a signed-in account with no profile row means the 0002 trigger is
 * missing, and a query error mid-render is worth showing during development.
 * Only `unauthenticated` is a redirect, and the caller owns that decision
 * because a route handler and a page redirect differently.
 */
export type PlayerOverviewResult =
  | { status: 'ok'; overview: PlayerOverview; authUserId: string }
  | { status: 'unauthenticated' }
  | { status: 'no-profile'; authUserId: string }
  | { status: 'error'; message: string };

export async function loadPlayerOverview(): Promise<PlayerOverviewResult> {
  const supabase = createClient();

  // getUser(), not getSession(): the latter trusts the cookie as presented,
  // while this revalidates the token with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: 'unauthenticated' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (profileError) {
    return { status: 'error', message: profileError.message };
  }

  if (!profile) {
    return { status: 'no-profile', authUserId: user.id };
  }

  /**
   * Issued together rather than awaited one after the other. They do not depend
   * on each other, and sequencing them would add a round trip to every render
   * of both pages for no reason.
   */
  const [preferencesResult, availabilityResult, statsResult] = await Promise.all([
    supabase
      .from('player_preferences')
      .select('*')
      .eq('profile_id', profile.id)
      .maybeSingle(),
    supabase
      .from('player_availability')
      .select('*')
      .eq('profile_id', profile.id)
      .order('day_of_week', { ascending: true })
      .order('start_minute', { ascending: true }),
    supabase
      .from('player_stats')
      .select('*')
      .eq('profile_id', profile.id)
      .maybeSingle(),
  ]);

  if (preferencesResult.error) {
    return { status: 'error', message: preferencesResult.error.message };
  }

  if (availabilityResult.error) {
    return { status: 'error', message: availabilityResult.error.message };
  }

  return {
    status: 'ok',
    authUserId: user.id,
    overview: {
      profile,
      // maybeSingle() gives null for "no row", which is the normal state for a
      // player who has not opened the form yet -- not an error to report.
      preferences: preferencesResult.data,
      availability: availabilityResult.data ?? [],
      // A stats error is not worth failing the page over: the panel shows
      // "no ratings yet", which is also what an unscored player sees.
      stats: statsResult.data ?? null,
    },
  };
}
