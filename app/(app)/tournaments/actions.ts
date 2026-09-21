'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { computeCompleteness } from '@/lib/player/completeness';
import { createClient } from '@/lib/supabase/server';
import { PLAYER_ROLES, type PlayerRole } from '@/types/database';

import type { ActionResult } from '../actions';

/**
 * Registration and withdrawal.
 *
 * Both run as the signed-in user, never the service role: the RLS policies in
 * 0005 are what enforce "only yourself" and "only while open, only before the
 * deadline", and routing these writes around them would throw that away. The
 * checks below exist to produce a readable sentence first; the policy is the
 * guarantee.
 */

const slugSchema = z.string().regex(/^[a-z0-9-]{3,60}$/, 'That tournament link is not valid.');
const roleSchema = z
  .union([z.literal(''), z.enum(PLAYER_ROLES as [PlayerRole, ...PlayerRole[]])])
  .transform((v) => (v === '' ? null : v));

async function currentPlayer(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session has expired. Sign in again.' } as const;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!profile) return { error: 'No profile exists for this account.' } as const;
  return { profileId: profile.id } as const;
}

export async function registerForTournament(
  slug: string,
  desiredRole: string = '',
): Promise<ActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedRole = roleSchema.safeParse(desiredRole);
  if (!parsedSlug.success) return { ok: false, error: 'That tournament link is not valid.' };
  if (!parsedRole.success) return { ok: false, error: 'Choose a valid role, or leave it on your usual role.' };

  const supabase = createClient();
  const player = await currentPlayer(supabase);
  if ('error' in player) return { ok: false, error: player.error as string };

  // A complete profile is required: without preferences there is no role or
  // band to form around, and without availability no hours to overlap. The
  // optimizer would otherwise place this player on defaults they never chose.
  const [prefs, windows, tournament] = await Promise.all([
    supabase.from('player_preferences').select('id').eq('profile_id', player.profileId).maybeSingle(),
    supabase
      .from('player_availability')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', player.profileId),
    supabase.from('tournaments').select('id, status').eq('slug', parsedSlug.data).maybeSingle(),
  ]);

  const completeness = computeCompleteness({
    preferences: prefs.data,
    availabilityCount: windows.count ?? 0,
  });
  if (!completeness.readyToMatch) {
    return {
      ok: false,
      error: 'Finish your profile first: set your preferences and add at least one availability window.',
    };
  }

  if (!tournament.data) return { ok: false, error: 'That tournament no longer exists.' };
  if (tournament.data.status !== 'open') return { ok: false, error: 'Registration is closed' };

  const { error } = await supabase.from('tournament_registrations').insert({
    tournament_id: tournament.data.id,
    profile_id: player.profileId,
    desired_role: parsedRole.data,
  });

  if (error) {
    if (error.code === '23505') return { ok: false, error: "You're already registered" };
    // 42501: the INSERT policy's WITH CHECK failed -- closed, past the
    // deadline, or not the caller's own profile. From the UI only the first
    // two are reachable, so say so.
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return { ok: false, error: 'Registration is closed' };
    }
    return { ok: false, error: 'Could not register you. Try again.' };
  }

  revalidatePath('/tournaments');
  revalidatePath(`/tournaments/${parsedSlug.data}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function unregisterFromTournament(slug: string): Promise<ActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { ok: false, error: 'That tournament link is not valid.' };

  const supabase = createClient();
  const player = await currentPlayer(supabase);
  if ('error' in player) return { ok: false, error: player.error as string };

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id')
    .eq('slug', parsedSlug.data)
    .maybeSingle();
  if (!tournament) return { ok: false, error: 'That tournament no longer exists.' };

  // RLS turns a disallowed DELETE into "0 rows deleted", not an error, so the
  // deleted rows are selected back to tell "withdrew" from "was not allowed".
  const { data, error } = await supabase
    .from('tournament_registrations')
    .delete()
    .eq('tournament_id', tournament.id)
    .eq('profile_id', player.profileId)
    .select('id');

  if (error) return { ok: false, error: 'Could not withdraw you. Try again.' };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Registration is closed, so you can no longer withdraw.' };
  }

  revalidatePath('/tournaments');
  revalidatePath(`/tournaments/${parsedSlug.data}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
