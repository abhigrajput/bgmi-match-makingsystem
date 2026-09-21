/**
 * scripts/verify-prod.ts -- prove migration 0005 is live, through the REST API.
 *
 *   npx tsx scripts/verify-prod.ts --target prod
 *   npx tsx scripts/verify-prod.ts --target local
 *
 * There is no SQL access to production (no CLI, no psql, no pooler), so the
 * schema is checked the way the app will use it: by selecting every new table
 * and every new column through PostgREST with the service-role key. A missing
 * column is a PGRST204/42703 error, a missing table a PGRST205/42P01 -- either
 * way the check FAILs. Nothing is written. Prints PASS/FAIL per check and row
 * counts per table; exits non-zero on any FAIL.
 */

import { parseTarget, describeTarget, serviceClient } from './lib/env';

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const target = parseTarget();
  const db = serviceClient(target);
  const checks: Check[] = [];
  const record = (name: string, error: { code?: string; message: string } | null, detail = '') =>
    checks.push({ name, ok: !error, detail: error ? `${error.code ?? ''} ${error.message}`.trim() : detail });

  console.log(`Verifying 0005 on ${describeTarget(target)}\n`);

  // New tables, every column.
  {
    const { error } = await db
      .from('tournaments')
      .select('id, name, slug, description, squad_size, region, starts_at, registration_closes_at, status, formation_summary, formed_at, is_seed, created_at, updated_at')
      .limit(1);
    record('tournaments: table + 14 columns', error);
  }
  {
    const { error } = await db
      .from('tournament_registrations')
      .select('id, tournament_id, profile_id, desired_role, registered_at, is_seed')
      .limit(1);
    record('tournament_registrations: table + 6 columns', error);
  }
  {
    const { error } = await db
      .from('model_versions')
      .select('id, version, algorithm, trained_at, n_train, n_test, metrics, baselines, feature_importance, is_active, created_at')
      .limit(1);
    record('model_versions: table + 11 columns', error);
  }

  // New columns on existing tables.
  {
    const { error } = await db.from('matches').select('tournament_id, squad_score_components, reasons, is_seed').limit(1);
    record('matches: tournament_id, squad_score_components, reasons, is_seed', error);
  }
  for (const table of ['profiles', 'player_stats', 'player_preferences', 'player_availability', 'match_participants', 'match_feedback'] as const) {
    const { error } = await db.from(table).select('is_seed').limit(1);
    record(`${table}: is_seed`, error);
  }

  // Read surfaces.
  {
    const { error } = await db
      .from('leaderboard_v')
      .select('profile_id, display_name, bgmi_ign, region, primary_role, overall_rating, kd_ratio, win_rate, matches_played')
      .limit(1);
    record('leaderboard_v: view + 9 columns', error);
  }
  {
    const { data, error } = await db.rpc('public_stats');
    const row = Array.isArray(data) ? data[0] : null;
    record('public_stats(): callable', error, row ? `players ${row.players}, tournaments ${row.tournaments}, squads ${row.squads_formed}` : '');
  }
  {
    const { data, error } = await db.rpc('analytics_overview');
    record('analytics_overview(): callable', error, data ? `keys ${Object.keys(data as object).length}` : '');
  }

  // Enum: an invalid status must be rejected by the type, not accepted.
  {
    const { error } = await db.from('tournaments').select('id').eq('status', 'not_a_status' as never).limit(1);
    checks.push({
      name: 'tournament_status enum rejects unknown values',
      ok: !!error && error.code === '22P02',
      detail: error ? error.code ?? '' : 'accepted an invalid enum value',
    });
  }

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(width)}  ${c.detail}`);

  console.log('\nRow counts:');
  for (const table of [
    'profiles', 'player_stats', 'player_preferences', 'player_availability', 'tournaments',
    'tournament_registrations', 'matches', 'match_participants', 'match_feedback', 'model_versions',
  ] as const) {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    console.log(`  ${table.padEnd(26)} ${error ? `error ${error.code}` : String(count).padStart(6)}`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
