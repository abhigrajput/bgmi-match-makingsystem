/**
 * scripts/e2e-local.ts -- signed-in end-to-end check against a running local
 * dev server (default http://localhost:3000) and the local Supabase stack.
 *
 *   npx tsx scripts/e2e-local.ts            (after scripts/demo-user.ts)
 *
 * Signs the demo account in with @supabase/ssr exactly as the browser would,
 * captures the session cookies it sets, and then drives the real pages and
 * API routes with them. Registration is done straight through PostgREST with
 * the user's JWT, so the RLS policies -- not the UI -- are what is exercised.
 * Also attempts the attacks those policies exist to stop, and expects each to
 * fail.
 *
 * LOCAL ONLY: it signs in with the local demo account's fixed password.
 */

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { credentialsFor } from './lib/env';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const EMAIL = 'demo.player@squadsync.local';
const PASSWORD = 'demo-password-123';
const SLUG = 'hubballi-weekend-cup';

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function readAnonKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY='));
  if (!line) throw new Error('.env.local has no NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return line.slice(line.indexOf('=') + 1).trim();
}

async function main() {
  const { url, serviceKey } = credentialsFor('local');
  const anonKey = readAnonKey();
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  // --- sign in, capturing the cookies @supabase/ssr would set -------------
  const jar = new Map<string, string>();
  const ssr = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data: signIn, error: signInError } = await ssr.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !signIn.session) throw new Error(`Sign-in failed: ${signInError?.message}. Run scripts/demo-user.ts first.`);
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  const token = signIn.session.access_token;

  const asUser = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });

  const page = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
    return { status: res.status, text: await res.text() };
  };
  const api = async (path: string, method = 'GET') => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { cookie } });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: body as Record<string, unknown> };
  };

  const { data: me } = await asUser.from('profiles').select('id').eq('auth_user_id', signIn.user.id).single();
  const { data: tournament } = await admin.from('tournaments').select('id, status').eq('slug', SLUG).single();
  if (!me || !tournament) throw new Error('Demo profile or seed tournament missing; run seed.ts and demo-user.ts.');

  // Start from a clean, open tournament.
  await api(`/api/tournaments/${SLUG}/reset`, 'POST');
  await admin.from('tournament_registrations').delete().eq('tournament_id', tournament.id).eq('profile_id', me.id);

  // --- pages ------------------------------------------------------------------
  for (const [path, needle] of [
    ['/dashboard', 'Welcome back'],
    ['/tournaments', 'Hubballi Weekend Cup'],
    [`/tournaments/${SLUG}`, 'Form squads'],
    ['/players', 'Players'],
    ['/profile', 'Skill profile'],
    ['/profile/availability', 'Availability'],
  ] as const) {
    const r = await page(path);
    check(`GET ${path}`, r.status === 200 && r.text.includes(needle), `status ${r.status}`);
  }
  const loggedOut = await fetch(`${BASE}/tournaments`, { redirect: 'manual' });
  check('Signed-out /tournaments redirects to /login', loggedOut.status === 307 && (loggedOut.headers.get('location') ?? '').includes('/login'));

  // --- RLS: attacks that must fail ------------------------------------------
  const someoneElse = (await admin.from('profiles').select('id').eq('is_seed', true).limit(1).single()).data!.id;
  {
    const { error } = await asUser.from('tournament_registrations').insert({ tournament_id: tournament.id, profile_id: someoneElse });
    check('Cannot register another player', error?.code === '42501', error?.code ?? 'no error');
  }
  {
    const { data, error } = await anon.from('leaderboard_v').select('profile_id').limit(1);
    check('Anon cannot read leaderboard_v', !!error || (data ?? []).length === 0, error?.code ?? `${data?.length} rows`);
  }
  {
    const { data, error } = await anon.from('tournaments').select('id').limit(1);
    check('Anon cannot read tournaments', !!error || (data ?? []).length === 0, error?.code ?? `${data?.length} rows`);
  }
  {
    const { error } = await asUser.from('tournaments').update({ status: 'completed' }).eq('id', tournament.id);
    const { data: after } = await admin.from('tournaments').select('status').eq('id', tournament.id).single();
    check('Cannot change tournament status', after?.status === 'open', error?.code ?? 'no error, status unchanged');
  }
  {
    const { error } = await asUser.from('model_versions').update({ is_active: false }).eq('is_active', true);
    const { count } = await admin.from('model_versions').select('id', { count: 'exact', head: true }).eq('is_active', true);
    check('Cannot deactivate the model', count === 1, error?.code ?? 'no error, still active');
  }
  {
    const { data } = await anon.rpc('public_stats');
    check('Anon CAN call public_stats()', Array.isArray(data) && data.length === 1);
    const { error } = await anon.rpc('analytics_overview');
    check('Anon cannot call analytics_overview()', !!error, error?.code ?? 'no error');
  }

  // --- registration -----------------------------------------------------------
  {
    const { error } = await asUser
      .from('tournament_registrations')
      .insert({ tournament_id: tournament.id, profile_id: me.id, desired_role: 'igl', is_seed: true });
    const { data: row } = await admin
      .from('tournament_registrations')
      .select('is_seed')
      .eq('tournament_id', tournament.id)
      .eq('profile_id', me.id)
      .single();
    check('Register self while open', !error, error?.message ?? '');
    check('Client-set is_seed is forced to false', row?.is_seed === false);
    const dup = await asUser.from('tournament_registrations').insert({ tournament_id: tournament.id, profile_id: me.id });
    check('Duplicate registration is 23505', dup.error?.code === '23505', dup.error?.code ?? 'no error');
  }

  // --- formation --------------------------------------------------------------
  const formed = await api(`/api/tournaments/${SLUG}/match`, 'POST');
  const squads = (formed.body?.squads ?? []) as { members: { profile_id: string }[]; scoring_source: string; reasons: string[] }[];
  check('POST match forms squads', formed.status === 200 && squads.length > 0, `status ${formed.status}, ${squads.length} squads`);
  check('Squads are ML scored', squads.every((s) => s.scoring_source === 'ml'));
  check('Every squad has 4 members', squads.every((s) => s.members.length === 4));
  check('Every squad explains its weakest link', squads.every((s) => s.reasons.some((r) => r.startsWith('Weakest link'))));
  const again = await api(`/api/tournaments/${SLUG}/match`, 'POST');
  check('Second formation is refused with 409', again.status === 409);
  const listed = await api(`/api/tournaments/${SLUG}/squads`);
  check('GET squads returns the same squads', listed.status === 200 && (listed.body.squads as unknown[]).length === squads.length);
  {
    const { error } = await asUser.from('tournament_registrations').delete().eq('tournament_id', tournament.id).eq('profile_id', me.id).select('id');
    const { count } = await admin
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournament.id)
      .eq('profile_id', me.id);
    check('Cannot withdraw after squads are formed', count === 1, error?.code ?? 'no error, row kept');
  }
  const summary = formed.body?.summary as { comparison?: { optimizer: { vetoedPairs: number; meanSquadScore: number }; baseline: { vetoedPairs: number; meanSquadScore: number } } };
  if (summary?.comparison) {
    const c = summary.comparison;
    check('Optimizer seats zero vetoed pairs', c.optimizer.vetoedPairs === 0, `baseline ${c.baseline.vetoedPairs}`);
    check('Optimizer beats rank-only on mean squad score', c.optimizer.meanSquadScore > c.baseline.meanSquadScore,
      `${(c.optimizer.meanSquadScore * 100).toFixed(1)} vs ${(c.baseline.meanSquadScore * 100).toFixed(1)}`);
  }
  const mySquad = squads.find((s) => s.members.some((m) => m.profile_id === me.id));
  check('Demo player was placed in a squad', !!mySquad);
  const detail = await page(`/tournaments/${SLUG}`);
  check('Tournament page shows Squads formed', detail.status === 200 && detail.text.includes('Squads formed'));

  // --- matches + feedback (Phase H) --------------------------------------------
  const { data: myMatch } = await asUser
    .from('match_participants')
    .select('match_id')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (myMatch) {
    const matchPage = await page(`/matches/${myMatch.match_id}`);
    check('GET /matches/[id]', matchPage.status === 200, `status ${matchPage.status}`);
    const done = await api(`/api/matches/${myMatch.match_id}/complete`, 'POST');
    check('Participant can mark the match completed', done.status === 200, `status ${done.status}`);
    const { data: seat } = await asUser
      .from('match_participants')
      .select('profile_id')
      .eq('match_id', myMatch.match_id)
      .neq('profile_id', me.id)
      .limit(1)
      .single();
    const fb = await asUser.from('match_feedback').insert({
      match_id: myMatch.match_id,
      rater_profile_id: me.id,
      ratee_profile_id: seat!.profile_id,
      rating: 5,
      teamwork_rating: 80,
      would_play_again: true,
    });
    check('Feedback saves after completion', !fb.error, fb.error?.message ?? '');
    const forged = await asUser.from('match_feedback').insert({
      match_id: myMatch.match_id,
      rater_profile_id: seat!.profile_id,
      ratee_profile_id: me.id,
      rating: 1,
    });
    check('Cannot submit feedback as someone else', forged.error?.code === '42501', forged.error?.code ?? 'no error');
  }
  for (const [path, needle] of [
    ['/matches', 'Matches'],
    ['/leaderboard', 'Leaderboard'],
    ['/analytics', 'Analytics'],
  ] as const) {
    const r = await page(path);
    check(`GET ${path}`, r.status === 200 && r.text.includes(needle), `status ${r.status}`);
  }

  // --- reset --------------------------------------------------------------------
  const reset = await api(`/api/tournaments/${SLUG}/reset`, 'POST');
  const { data: reopened } = await admin.from('tournaments').select('status').eq('id', tournament.id).single();
  check('Reset demo reopens the tournament', reset.status === 200 && reopened?.status === 'open');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
