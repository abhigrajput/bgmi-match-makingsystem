/**
 * Tournament reads and writes that need to see across players: building the
 * formation pool, writing formed squads, reading squads back for everyone.
 *
 * Every function takes the client as a parameter and never constructs one, so
 * it is the caller -- an API route that has already authenticated the user --
 * that decides to hand over service-role access. Nothing here reads a key.
 */

import { toSynergyScore, type FormationRun } from '@/lib/scoring/formation';
import type { PlayerVector } from '@/lib/scoring/types';
import { toPlayerVector } from '@/lib/scoring/vectors';
import type { AdminClient } from '@/lib/supabase/admin';
import type { PlayerRole, Tournament } from '@/types/database';

export async function getTournamentBySlug(db: AdminClient, slug: string): Promise<Tournament | null> {
  const { data, error } = await db.from('tournaments').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`Could not load the tournament: ${error.message}`);
  return data;
}

/**
 * The formation pool: every registrant as a PlayerVector.
 *
 * A registration's desired_role overrides the player's stored primary role
 * for this tournament only; the stored primary then becomes the fallback
 * secondary, so a player who asked to play IGL here is still known to be able
 * to play what they usually play.
 */
export async function loadRegistrantVectors(db: AdminClient, tournamentId: string): Promise<PlayerVector[]> {
  const { data: registrations, error } = await db
    .from('tournament_registrations')
    .select('profile_id, desired_role, registered_at')
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`Could not load registrations: ${error.message}`);
  if (!registrations || registrations.length === 0) return [];

  const ids = registrations.map((r) => r.profile_id);
  const [profiles, stats, prefs, avail] = await Promise.all([
    db.from('profiles').select('id, bgmi_ign, display_name, region').in('id', ids),
    db
      .from('player_stats')
      .select('profile_id, overall_rating, aim_score, game_sense, teamwork_score, clutch_score, consistency_score')
      .in('profile_id', ids),
    db
      .from('player_preferences')
      .select('profile_id, primary_role, secondary_role, comm_preference, languages, min_teammate_skill, max_teammate_skill')
      .in('profile_id', ids),
    db
      .from('player_availability')
      .select('profile_id, day_of_week, start_minute, end_minute, timezone_offset_minutes')
      .in('profile_id', ids),
  ]);
  for (const r of [profiles, stats, prefs, avail]) {
    if (r.error) throw new Error(`Could not load player data: ${r.error.message}`);
  }

  const profileBy = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const statsBy = new Map((stats.data ?? []).map((s) => [s.profile_id, s]));
  const prefsBy = new Map((prefs.data ?? []).map((p) => [p.profile_id, p]));
  const availBy = new Map<string, NonNullable<typeof avail.data>>();
  for (const w of avail.data ?? []) availBy.set(w.profile_id, [...(availBy.get(w.profile_id) ?? []), w]);

  const vectors: PlayerVector[] = [];
  for (const registration of registrations) {
    const profile = profileBy.get(registration.profile_id);
    if (!profile) continue;
    const vector = toPlayerVector({
      profile,
      stats: statsBy.get(profile.id) ?? null,
      preferences: prefsBy.get(profile.id) ?? null,
      availability: availBy.get(profile.id) ?? [],
      registeredAt: registration.registered_at,
    });
    const desired = registration.desired_role as PlayerRole | null;
    if (desired && desired !== vector.primaryRole) {
      vector.secondaryRole = vector.primaryRole;
      vector.primaryRole = desired;
    } else if (desired && vector.secondaryRole === desired) {
      vector.secondaryRole = null;
    }
    vectors.push(vector);
  }
  return vectors;
}

/**
 * Writes a formation: one matches row per squad plus its participants, then
 * the summary onto the tournament. Returns the inserted match ids so the
 * caller can roll back if a later step fails -- PostgREST has no multi-
 * statement transaction, so the rollback is explicit.
 */
export async function persistFormation(
  db: AdminClient,
  tournament: Pick<Tournament, 'id' | 'squad_size'>,
  run: FormationRun,
): Promise<string[]> {
  const inserted: string[] = [];
  try {
    for (const squad of run.squads) {
      const { data: match, error } = await db
        .from('matches')
        .insert({
          status: 'ready',
          mode: 'classic',
          squad_size: tournament.squad_size,
          synergy_score: toSynergyScore(squad.score),
          scoring_source: squad.source,
          squad_score_components: {
            ...squad.components,
            squad_score: squad.score,
            mean_pair_score: squad.meanPairScore,
          },
          reasons: squad.reasons,
          tournament_id: tournament.id,
        })
        .select('id')
        .single();
      if (error || !match) throw new Error(error?.message ?? 'match insert returned no row');
      inserted.push(match.id);

      // The IGL leads when there is one; otherwise the earliest registrant.
      const leaderIndex = Math.max(0, squad.members.findIndex((m) => m.assignedRole === 'igl'));
      const { error: pError } = await db.from('match_participants').insert(
        squad.members.map((member, i) => ({
          match_id: match.id,
          profile_id: member.profileId,
          assigned_role: member.assignedRole,
          is_leader: i === leaderIndex,
        })),
      );
      if (pError) throw new Error(pError.message);
    }

    const { error: tError } = await db
      .from('tournaments')
      .update({ formation_summary: run.summary, formed_at: run.summary.formed_at })
      .eq('id', tournament.id);
    if (tError) throw new Error(tError.message);

    return inserted;
  } catch (error) {
    if (inserted.length > 0) {
      await db.from('matches').delete().in('id', inserted);
    }
    throw error;
  }
}

export type SquadMemberView = {
  profile_id: string;
  ign: string;
  display_name: string;
  avatar_url: string | null;
  role: PlayerRole | null;
  rating: number | null;
  is_leader: boolean;
};

export type SquadView = {
  match_id: string;
  status: string;
  synergy_score: number | null;
  scoring_source: 'ml' | 'rule_based';
  reasons: string[];
  components: Record<string, number>;
  members: SquadMemberView[];
};

/** Formed squads for a tournament, best first, with everything the cards show. */
export async function loadSquads(db: AdminClient, tournamentId: string): Promise<SquadView[]> {
  const { data: matches, error } = await db
    .from('matches')
    .select('id, status, synergy_score, scoring_source, reasons, squad_score_components')
    .eq('tournament_id', tournamentId)
    .order('synergy_score', { ascending: false });
  if (error) throw new Error(`Could not load squads: ${error.message}`);
  if (!matches || matches.length === 0) return [];

  const { data: participants, error: pError } = await db
    .from('match_participants')
    .select('match_id, profile_id, assigned_role, is_leader')
    .in('match_id', matches.map((m) => m.id));
  if (pError) throw new Error(`Could not load squad members: ${pError.message}`);

  const profileIds = [...new Set((participants ?? []).map((p) => p.profile_id))];
  const [profiles, stats] = await Promise.all([
    db.from('profiles').select('id, bgmi_ign, display_name, avatar_url').in('id', profileIds),
    db.from('player_stats').select('profile_id, overall_rating').in('profile_id', profileIds),
  ]);
  const profileBy = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const ratingBy = new Map((stats.data ?? []).map((s) => [s.profile_id, s.overall_rating]));

  return matches.map((match) => ({
    match_id: match.id,
    status: match.status,
    synergy_score: match.synergy_score,
    scoring_source: match.scoring_source,
    reasons: match.reasons ?? [],
    components: (match.squad_score_components ?? {}) as Record<string, number>,
    members: (participants ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => {
        const profile = profileBy.get(p.profile_id);
        return {
          profile_id: p.profile_id,
          ign: profile?.bgmi_ign ?? 'unknown',
          display_name: profile?.display_name ?? 'Unknown player',
          avatar_url: profile?.avatar_url ?? null,
          role: p.assigned_role,
          rating: ratingBy.get(p.profile_id) ?? null,
          is_leader: p.is_leader,
        };
      }),
  }));
}
