/**
 * scripts/walkthrough-prod.ts -- the final signed-in walkthrough against the
 * LIVE site, with a throwaway account.
 *
 *   PROD_SUPABASE_ANON_KEY=... npx tsx scripts/walkthrough-prod.ts
 *
 * Creates a temporary auth user with a random password that is generated here
 * and never printed or stored, completes its profile, signs in through
 * @supabase/ssr exactly as the browser does, and drives the deployed pages and
 * API routes: landing stats -> dashboard -> Hubballi Weekend Cup -> register ->
 * form squads -> reasons + comparison -> match -> mark completed -> feedback ->
 * leaderboard -> analytics. It then resets the demo tournament and deletes the
 * temporary user (its profile, registration and feedback cascade), so no
 * credential outlives the run.
 */

import crypto from 'node:crypto';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { credentialsFor } from './lib/env';

const BASE = process.env.WALKTHROUGH_BASE_URL ?? 'https://bgmi-match-makingsystem.vercel.app';
const SLUG = 'hubballi-weekend-cup';

const results: { step: string; ok: boolean; detail: string }[] = [];
function step(name: string, ok: boolean, detail = '') {
  results.push({ step: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  const anonKey = process.env.PROD_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Set PROD_SUPABASE_ANON_KEY for this run.');
  const { url, serviceKey } = credentialsFor('prod');
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  const suffix = crypto.randomBytes(3).toString('hex');
  const email = `walkthrough-${suffix}@squadsync.invalid`;
  const password = crypto.randomBytes(24).toString('base64url');

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Walkthrough Tester', bgmi_ign: `Walkthrough_${suffix}` },
  });
  if (createError || !created.user) throw new Error(`Could not create the temporary user: ${createError?.message}`);
  const userId = created.user.id;

  try {
    const { data: profile } = await admin.from('profiles').select('id').eq('auth_user_id', userId).single();
    const profileId = profile!.id;
    await admin.from('profiles').update({ region: 'India-South' }).eq('id', profileId);
    await admin.from('player_preferences').insert({
      profile_id: profileId,
      primary_role: 'igl',
      secondary_role: 'support',
      comm_preference: 'voice_optional',
      languages: ['en', 'hi', 'kn'],
      min_teammate_skill: 25,
      max_teammate_skill: 90,
    });
    await admin.from('player_availability').insert(
      [1, 3, 5, 6].map((day) => ({
        profile_id: profileId,
        day_of_week: day as 1 | 3 | 5 | 6,
        start_minute: 1200,
        end_minute: 1440,
        timezone_offset_minutes: 330,
      })),
    );

    // --- sign in exactly as the browser would --------------------------------
    const jar = new Map<string, string>();
    const ssr = createServerClient<Database>(url, anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (c) => c.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const { data: session, error: signInError } = await ssr.auth.signInWithPassword({ email, password });
    step('Account signs in', !signInError && !!session.session, signInError?.message ?? '');
    const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
    const asUser = createClient<Database>(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
    });
    const page = async (path: string) => {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
      return { status: res.status, text: await res.text() };
    };
    const api = async (path: string, method = 'GET') => {
      const res = await fetch(`${BASE}${path}`, { method, headers: { cookie } });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    };

    const landing = await fetch(`${BASE}/`).then((r) => r.text());
    step('Landing loads with live stats', landing.includes('Squads formed'));

    const dash = await page('/dashboard');
    step('Dashboard', dash.status === 200 && dash.text.includes('Welcome back'), `status ${dash.status}`);

    const detail = await page(`/tournaments/${SLUG}`);
    step('Hubballi Weekend Cup page', detail.status === 200 && detail.text.includes('Hubballi Weekend Cup'), `status ${detail.status}`);

    // Start from an open tournament, whatever state a previous run left.
    await api(`/api/tournaments/${SLUG}/reset`, 'POST');
    const { data: t } = await admin.from('tournaments').select('id').eq('slug', SLUG).single();
    const reg = await asUser.from('tournament_registrations').insert({ tournament_id: t!.id, profile_id: profileId, desired_role: 'igl' });
    step('Register (RLS insert as the user)', !reg.error, reg.error?.message ?? '');

    const formed = await api(`/api/tournaments/${SLUG}/match`, 'POST');
    const squads = (formed.body.squads ?? []) as { match_id: string; scoring_source: string; reasons: string[]; members: { profile_id: string }[] }[];
    step('Form squads', formed.status === 200 && squads.length > 0, `status ${formed.status}, ${squads.length} squads`);
    step('Squads are ML scored', squads.length > 0 && squads.every((s) => s.scoring_source === 'ml'));
    step('Reasons render', squads.every((s) => s.reasons.length >= 5 && s.reasons.some((r) => r.startsWith('Weakest link'))));
    const summary = formed.body.summary as { players: number; squads: number; baseline_squads: number; unmatched: unknown[]; model_version: string; comparison: { optimizer: Record<string, number>; baseline: Record<string, number> } };
    step('Comparison computed', !!summary?.comparison);

    const afterForm = await page(`/tournaments/${SLUG}`);
    step('Tournament page shows Squads formed', afterForm.text.includes('Squads formed'));

    const mine = squads.find((s) => s.members.some((m) => m.profile_id === profileId));
    step('Tester placed in a squad', !!mine);
    if (mine) {
      const matchPage = await page(`/matches/${mine.match_id}`);
      step('Open the match', matchPage.status === 200, `status ${matchPage.status}`);
      const done = await api(`/api/matches/${mine.match_id}/complete`, 'POST');
      step('Mark completed', done.status === 200, `status ${done.status}`);
      const teammate = mine.members.find((m) => m.profile_id !== profileId)!;
      const fb = await asUser.from('match_feedback').insert({
        match_id: mine.match_id,
        rater_profile_id: profileId,
        ratee_profile_id: teammate.profile_id,
        rating: 5,
        teamwork_rating: 80,
        would_play_again: true,
      });
      step('Feedback saves', !fb.error, fb.error?.message ?? '');
      const after = await page(`/matches/${mine.match_id}`);
      step('Match page shows the saved rating', after.text.includes('You rated'));
    }

    const board = await page('/leaderboard');
    step('Leaderboard renders', board.status === 200 && board.text.includes('Leaderboard'), `status ${board.status}`);
    const analytics = await page('/analytics');
    step('Analytics renders with model metrics', analytics.status === 200 && analytics.text.includes('Active model') && analytics.text.includes('lr-'), `status ${analytics.status}`);

    if (summary?.comparison) {
      const o = summary.comparison.optimizer;
      const b = summary.comparison.baseline;
      console.log('\nOptimizer vs rank-only on production (Hubballi Weekend Cup):');
      console.log(`  players ${summary.players}, model ${summary.model_version}, unmatched ${summary.unmatched.length}`);
      console.log(`  squads            ${o.squads}  vs ${b.squads}`);
      console.log(`  mean squad score  ${(o.meanSquadScore! * 100).toFixed(1)}  vs ${(b.meanSquadScore! * 100).toFixed(1)}`);
      console.log(`  vetoed pairs      ${o.vetoedPairs}  vs ${b.vetoedPairs}`);
      console.log(`  role coverage     ${(o.roleCoverage! * 100).toFixed(0)}%  vs ${(b.roleCoverage! * 100).toFixed(0)}%`);
      console.log(`  rating spread     ${o.meanRatingSpread!.toFixed(1)}  vs ${b.meanRatingSpread!.toFixed(1)}`);
    }

    const reset = await api(`/api/tournaments/${SLUG}/reset`, 'POST');
    step('Reset demo', reset.status === 200, `status ${reset.status}`);
  } finally {
    // Remove the throwaway account; its profile and everything hanging off it
    // cascade. Nothing with a password survives the run.
    const { error } = await admin.auth.admin.deleteUser(userId);
    step('Temporary account deleted', !error, error?.message ?? '');
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} walkthrough steps passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
