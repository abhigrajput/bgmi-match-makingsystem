/**
 * scripts/seed.ts -- reproducible synthetic data.
 *
 *   npx tsx scripts/seed.ts --target local
 *   npx tsx scripts/seed.ts --target prod
 *
 * Writes 200 synthetic players, three open demo tournaments, 600 completed
 * historical matches and peer feedback for every directed teammate pair.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LABELS ARE HONEST (read this before touching the feedback section)
 * ---------------------------------------------------------------------------
 * Every player has hidden LATENT traits -- true skill, true role, true comms
 * style, true languages, toxicity -- that are never written to the database.
 * They go to scripts/.seed-latent.json (git-ignored) and nowhere else.
 *
 * What the database holds is OBSERVABLE: skill axes = true skill + noise,
 * a declared role that is the true role only 80% of the time, and so on.
 *
 * Feedback ratings -- the ML label -- are computed from the LATENTS. The model
 * (scripts/train.ts) is trained on features computed from the OBSERVABLES. So
 * the model has to recover a signal it can only see through noise, which is
 * the real problem a matchmaker faces. If labels were computed from the same
 * observable features the model trains on, it would score near-perfectly by
 * re-deriving our own formula, and every metric would be meaningless.
 * Toxicity in particular affects ratings but has no observable proxy at all,
 * so some label variance is irreducible by design.
 * ---------------------------------------------------------------------------
 *
 * SAFETY: only rows with is_seed = true on profiles with auth_user_id NULL are
 * deleted. Rows created by real accounts are never selected for deletion. The
 * one exception is by design and matches the "Reset demo" button: squads the
 * app formed inside the three SEED tournaments are removed so those
 * tournaments return to 'open'.
 */

import fs from 'node:fs';
import path from 'node:path';

import { fakerEN_IN as faker } from '@faker-js/faker';

import { ROLE_MATRIX } from '@/lib/scoring/compatibility';
import type {
  CommPreference,
  MatchFeedbackInsert,
  MatchInsert,
  MatchParticipantInsert,
  PlayerAvailabilityInsert,
  PlayerPreferencesInsert,
  PlayerRole,
  PlayerStatsInsert,
  ProfileInsert,
  TournamentRegistrationInsert,
} from '@/types/database';

import { describeTarget, parseTarget, serviceClient } from './lib/env';
import { clamp, makeRng, sigmoid } from './lib/rng';

const SEED = 'bgmi-synthetic-v1';
const N_PLAYERS = 200;
const N_MATCHES = 600;
const LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'mr'] as const;
const ROLES: PlayerRole[] = ['igl', 'assaulter', 'sniper', 'support', 'flex'];
const MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Livik'];
const IST = 330;

export const SEED_TOURNAMENTS = [
  {
    slug: 'hubballi-weekend-cup',
    name: 'Hubballi Weekend Cup',
    squad_size: 4,
    region: 'India-South',
    description: 'Weekend squad tournament for players around Hubballi-Dharwad. Classic mode, Erangel and Miramar.',
    startsInDays: 3,
  },
  {
    slug: 'kle-campus-clash',
    name: 'KLE Campus Clash',
    squad_size: 4,
    region: 'India-South',
    description: 'Inter-department squad clash. Mixed skill levels welcome; squads are balanced for you.',
    startsInDays: 5,
  },
  {
    slug: 'night-owls-duo',
    name: 'Night Owls Duo',
    squad_size: 2,
    region: null,
    description: 'Late-night duo series for players who queue after 22:00.',
    startsInDays: 2,
  },
] as const;

type Latent = {
  trueSkill: number;
  trueRole: PlayerRole;
  trueComm: CommPreference;
  trueLanguages: string[];
  toxicity: number;
};

const rng = makeRng(SEED);
faker.seed(20260921);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IGN_HEADS = [
  'Rudra', 'Kaal', 'Shadow', 'Viper', 'Ghost', 'Desi', 'Toxic', 'Mortal', 'Soul',
  'Scout', 'Jonathan', 'Beast', 'Sher', 'Tiger', 'Bheem', 'Arjun', 'Karna', 'Raavan',
  'Dragon', 'Phoenix', 'Storm', 'Blaze', 'Rogue', 'Ninja', 'Hydra', 'Venom', 'Falcon',
  'Cobra', 'Thunder', 'Raja', 'Nawab', 'Shaktiman', 'Pro', 'Silent', 'Snipe', 'Frag',
];
const IGN_TAILS = ['OP', 'YT', 'xD', 'Bhai', 'God', '07', '99', 'X', 'King', 'Gaming', 'Pro', 'Ji', 'Official', '2K'];

function makeIgn(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const head = rng.pick(IGN_HEADS);
    const style = rng.int(0, 4);
    const ign =
      style === 0 ? `${head}${rng.pick(IGN_TAILS)}`
      : style === 1 ? `${head}_${rng.int(1, 999)}`
      : style === 2 ? `i${head}${rng.pick(IGN_TAILS)}`
      : style === 3 ? `${head}${rng.pick(IGN_HEADS)}`
      : `${head.toLowerCase()}.${rng.pick(IGN_TAILS).toLowerCase()}${rng.int(1, 99)}`;
    if (!used.has(ign.toLowerCase())) {
      used.add(ign.toLowerCase());
      return ign;
    }
  }
  const fallback = `player_${used.size}_${rng.int(1000, 9999)}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

function daysAgo(days: number, base = Date.now()): Date {
  return new Date(base - days * 86_400_000);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function commMatch(a: CommPreference, b: CommPreference): number {
  if (a === b) return 1;
  if ((a === 'silent' && b === 'voice_required') || (a === 'voice_required' && b === 'silent')) return 0;
  return 0.5;
}

async function insertChunked<T extends object>(
  label: string,
  insert: (rows: T[]) => PromiseLike<{ error: { message: string } | null }>,
  rows: T[],
  size = 500,
) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await insert(rows.slice(i, i + size));
    if (error) throw new Error(`Insert into ${label} failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const target = parseTarget();
  const db = serviceClient(target);
  console.log(`Seeding ${describeTarget(target)} with seed "${SEED}"`);

  // --- 1. Clean previous seed data (children first) ------------------------
  const { data: seedTournaments, error: stErr } = await db
    .from('tournaments')
    .select('id')
    .eq('is_seed', true);
  if (stErr) throw new Error(`Reading seed tournaments failed: ${stErr.message}`);
  const seedTournamentIds = (seedTournaments ?? []).map((t) => t.id);

  if (seedTournamentIds.length > 0) {
    // Squads the app formed inside demo tournaments: same as "Reset demo".
    const { error } = await db.from('matches').delete().in('tournament_id', seedTournamentIds);
    if (error) throw new Error(`Resetting demo tournaments failed: ${error.message}`);
  }
  for (const table of ['match_feedback', 'match_participants', 'matches', 'tournament_registrations'] as const) {
    const { error } = await db.from(table).delete().eq('is_seed', true);
    if (error) throw new Error(`Deleting seed rows from ${table} failed: ${error.message}`);
  }
  // Seed profiles only: is_seed AND no auth account. Their stats, preferences
  // and availability cascade (and are all is_seed themselves).
  {
    const { error } = await db.from('profiles').delete().eq('is_seed', true).is('auth_user_id', null);
    if (error) throw new Error(`Deleting seed profiles failed: ${error.message}`);
  }

  // --- 2. Players ------------------------------------------------------------
  const { data: existingIgns, error: ignErr } = await db.from('profiles').select('bgmi_ign');
  if (ignErr) throw new Error(`Reading existing IGNs failed: ${ignErr.message}`);
  const usedIgns = new Set((existingIgns ?? []).map((r) => r.bgmi_ign.toLowerCase()));

  const now = Date.now();
  const latents: Record<string, Latent & { ign: string }> = {};
  const profiles: ProfileInsert[] = [];
  const stats: PlayerStatsInsert[] = [];
  const preferences: PlayerPreferencesInsert[] = [];
  const availability: PlayerAvailabilityInsert[] = [];
  const observedRole: Record<string, PlayerRole> = {};

  for (let i = 0; i < N_PLAYERS; i++) {
    const id = rng.uuid();
    const ign = makeIgn(usedIgns);

    // Latents -- never written to the database.
    const trueSkill = clamp(rng.normal(55, 15), 5, 95);
    const trueRole = rng.weighted<PlayerRole>([
      ['igl', 0.18], ['assaulter', 0.3], ['sniper', 0.2], ['support', 0.2], ['flex', 0.12],
    ]);
    const trueComm = rng.weighted<CommPreference>([
      ['voice_required', 0.3], ['voice_optional', 0.45], ['text_only', 0.13], ['silent', 0.12],
    ]);
    const langs = new Set<string>();
    if (rng.chance(0.75)) langs.add('en');
    if (rng.chance(0.55)) langs.add('hi');
    if (rng.chance(0.45)) langs.add('kn');
    if (rng.chance(0.12)) langs.add(rng.pick(['ta', 'te', 'mr']));
    if (langs.size === 0) langs.add(rng.pick(LANGUAGES));
    const trueLanguages = [...langs].sort();
    const toxicity = rng.beta(2, 8);
    latents[id] = { ign, trueSkill, trueRole, trueComm, trueLanguages, toxicity };

    // Observables: latent + noise.
    const axis = () => Math.round(clamp(trueSkill + rng.normal(0, 8), 0, 100));
    const axes = { aim: axis(), sense: axis(), team: axis(), clutch: axis(), cons: axis() };
    const overall = Math.round((axes.aim + axes.sense + axes.team + axes.clutch + axes.cons) / 5);
    const played = rng.int(20, 400);
    const winRate = clamp(2 + overall * 0.16 + rng.normal(0, 2.5), 0.5, 40);

    const region = rng.weighted<string>([['India-South', 0.62], ['India-West', 0.3], ['India-North', 0.08]]);

    profiles.push({
      id,
      auth_user_id: null,
      display_name: `${faker.person.firstName()} ${faker.person.lastName()}`,
      bgmi_ign: ign,
      region,
      bio: null,
      is_seed: true,
      created_at: daysAgo(rng.uniform(30, 240), now).toISOString(),
    });

    stats.push({
      profile_id: id,
      kd_ratio: Number(clamp(0.3 + (overall / 100) * 3.4 + rng.normal(0, 0.35), 0.1, 8).toFixed(3)),
      avg_damage: Number(clamp(80 + overall * 5.2 + rng.normal(0, 55), 20, 1500).toFixed(2)),
      avg_survival_time: Number(clamp(540 + overall * 11 + rng.normal(0, 110), 60, 2000).toFixed(2)),
      headshot_rate: Number(clamp(6 + overall * 0.28 + rng.normal(0, 3.5), 0, 100).toFixed(2)),
      win_rate: Number(winRate.toFixed(2)),
      aim_score: axes.aim,
      game_sense: axes.sense,
      teamwork_score: axes.team,
      clutch_score: axes.clutch,
      consistency_score: axes.cons,
      overall_rating: overall,
      matches_played: played,
      matches_won: Math.min(played, Math.round((played * winRate) / 100)),
      last_computed_at: new Date(now).toISOString(),
      is_seed: true,
    });

    // Declared preferences: the true role only 80% of the time.
    const primary = rng.chance(0.8) ? trueRole : rng.pick(ROLES.filter((r) => r !== trueRole));
    observedRole[id] = primary;
    const secondary = rng.chance(0.5) ? rng.pick(ROLES.filter((r) => r !== primary)) : null;
    preferences.push({
      profile_id: id,
      primary_role: primary,
      secondary_role: secondary,
      comm_preference: trueComm,
      languages: trueLanguages,
      min_teammate_skill: Math.max(0, Math.round(overall - rng.uniform(20, 40))),
      max_teammate_skill: Math.min(100, Math.round(overall + rng.uniform(20, 40))),
      wants_ranked: rng.chance(0.55),
      max_ping_ms: rng.chance(0.4) ? rng.int(60, 150) : null,
      is_seed: true,
    });

    // Availability: 1-3 windows, mostly 18:00-24:00 IST; ~15% daytime only.
    const days = rng.sample([0, 1, 2, 3, 4, 5, 6], rng.int(1, 3));
    const daytime = rng.chance(0.15);
    const seen = new Set<string>();
    for (const day of days) {
      let start: number;
      let end: number;
      if (daytime) {
        start = rng.pick([360, 420, 480, 540, 780, 840]);
        end = start + rng.pick([120, 150, 180, 240]);
      } else {
        start = rng.pick([1080, 1140, 1200, 1230, 1260, 1320]);
        end = Math.min(1440, start + rng.pick([120, 150, 180, 210, 240]));
      }
      const key = `${day}-${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      availability.push({
        profile_id: id,
        day_of_week: day as PlayerAvailabilityInsert['day_of_week'],
        start_minute: start,
        end_minute: end,
        timezone_offset_minutes: IST,
        is_seed: true,
      });
    }
  }

  await insertChunked('profiles', (rows) => db.from('profiles').insert(rows), profiles);
  await insertChunked('player_stats', (rows) => db.from('player_stats').insert(rows), stats);
  await insertChunked('player_preferences', (rows) => db.from('player_preferences').insert(rows), preferences);
  await insertChunked('player_availability', (rows) => db.from('player_availability').insert(rows), availability);

  // --- 3. Tournaments (upserted by slug: real users' registrations on them
  //        survive a reseed) and seed registrations ------------------------
  const playerIds = profiles.map((p) => p.id!);
  const registrations: TournamentRegistrationInsert[] = [];
  for (const t of SEED_TOURNAMENTS) {
    const startsAt = new Date(now + t.startsInDays * 86_400_000);
    startsAt.setUTCHours(13, 30, 0, 0); // 19:00 IST
    const { data: row, error } = await db
      .from('tournaments')
      .upsert(
        {
          slug: t.slug,
          name: t.name,
          description: t.description,
          squad_size: t.squad_size,
          region: t.region,
          starts_at: startsAt.toISOString(),
          registration_closes_at: new Date(startsAt.getTime() - 3_600_000).toISOString(),
          status: 'open',
          formation_summary: null,
          formed_at: null,
          is_seed: true,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();
    if (error || !row) throw new Error(`Upserting tournament ${t.slug} failed: ${error?.message}`);

    const count = t.squad_size === 2 ? rng.int(40, 56) : rng.int(56, 80);
    for (const profileId of rng.sample(playerIds, count)) {
      registrations.push({
        tournament_id: row.id,
        profile_id: profileId,
        desired_role: rng.chance(0.25) ? observedRole[profileId]! : null,
        registered_at: daysAgo(rng.uniform(0.05, 3), now).toISOString(),
        is_seed: true,
      });
    }
  }
  await insertChunked('tournament_registrations', (rows) => db.from('tournament_registrations').insert(rows), registrations);

  // --- 4. Historical matches: 4 random players each, NOT optimizer-formed --
  const matches: MatchInsert[] = [];
  const participants: MatchParticipantInsert[] = [];
  const feedback: MatchFeedbackInsert[] = [];
  let pairsLabelled = 0;

  for (let m = 0; m < N_MATCHES; m++) {
    const matchId = rng.uuid();
    const created = daysAgo(rng.uniform(1, 90), now);
    const started = new Date(created.getTime() + rng.int(2, 10) * 60_000);
    const ended = new Date(started.getTime() + rng.int(18, 34) * 60_000);
    matches.push({
      id: matchId,
      status: 'completed',
      map_name: rng.pick(MAPS),
      mode: 'classic',
      is_ranked: rng.chance(0.5),
      squad_size: 4,
      synergy_score: null,
      scoring_source: 'rule_based',
      created_at: created.toISOString(),
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      is_seed: true,
    });

    const squad = rng.sample(playerIds, 4);
    squad.forEach((profileId, seat) => {
      participants.push({
        match_id: matchId,
        profile_id: profileId,
        assigned_role: observedRole[profileId]!,
        is_leader: seat === 0,
        joined_at: started.toISOString(),
        is_seed: true,
      });
    });

    // Directed feedback, labels from LATENTS only (see header).
    for (const rater of squad) {
      for (const ratee of squad) {
        if (rater === ratee) continue;
        const a = latents[rater]!;
        const b = latents[ratee]!;
        const dSkill = Math.abs(a.trueSkill - b.trueSkill);
        const tc =
          0.35 * Math.exp(-(dSkill * dSkill) / 450) +
          0.25 * ROLE_MATRIX[a.trueRole][b.trueRole] +
          0.15 * commMatch(a.trueComm, b.trueComm) +
          0.15 * jaccard(a.trueLanguages, b.trueLanguages) +
          0.1 * (1 - (a.toxicity + b.toxicity) / 2);
        const rating = clamp(Math.round(1 + 4 * sigmoid(6 * (tc - 0.5)) + rng.normal(0, 0.7)), 1, 5);
        let again = rating >= 4;
        if (rng.chance(0.1)) again = !again;
        feedback.push({
          match_id: matchId,
          rater_profile_id: rater,
          ratee_profile_id: ratee,
          rating: rating as MatchFeedbackInsert['rating'],
          teamwork_rating: Math.round(clamp(rating * 20 - 10 + rng.normal(0, 8), 0, 100)),
          would_play_again: again,
          comment: null,
          created_at: new Date(ended.getTime() + rng.int(1, 60) * 60_000).toISOString(),
          is_seed: true,
        });
        pairsLabelled++;
      }
    }
  }

  await insertChunked('matches', (rows) => db.from('matches').insert(rows), matches);
  await insertChunked('match_participants', (rows) => db.from('match_participants').insert(rows), participants);
  await insertChunked('match_feedback', (rows) => db.from('match_feedback').insert(rows), feedback);

  // --- 5. Latents to disk (git-ignored), never to the database -------------
  const latentPath = path.resolve(process.cwd(), 'scripts/.seed-latent.json');
  fs.writeFileSync(latentPath, JSON.stringify({ seed: SEED, target, players: latents }, null, 2));

  // --- 6. Counts, read back from the target --------------------------------
  const tables = [
    'profiles', 'player_stats', 'player_preferences', 'player_availability',
    'tournaments', 'tournament_registrations', 'matches', 'match_participants', 'match_feedback',
  ] as const;
  console.log(`\nWrote ${pairsLabelled} directed feedback labels. Row counts on ${target}:`);
  for (const table of tables) {
    const [{ count: total }, { count: seeded }] = await Promise.all([
      db.from(table).select('*', { count: 'exact', head: true }),
      db.from(table).select('*', { count: 'exact', head: true }).eq('is_seed', true),
    ]);
    console.log(`  ${table.padEnd(26)} total ${String(total).padStart(6)}   is_seed ${String(seeded).padStart(6)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
