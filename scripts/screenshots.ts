/**
 * scripts/screenshots.ts -- capture the README / report screenshots from the
 * LOCAL app, seeded, signed in as the local demo account.
 *
 *   npx tsx scripts/screenshots.ts            (dev server on :3000)
 *
 * Drives the installed Chrome through playwright-core. Puts the demo tournament
 * into a "squads formed, one match completed" state first, so every screen
 * shows real data produced by the real code paths.
 */

import fs from 'node:fs';
import path from 'node:path';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright-core';

import type { Database } from '@/types/database';

import { credentialsFor } from './lib/env';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = path.resolve('docs/screenshots');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SLUG = 'hubballi-weekend-cup';

function anonKey(): string {
  const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY='))!;
  return line.slice(line.indexOf('=') + 1).trim();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { url, serviceKey } = credentialsFor('local');
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  const jar = new Map<string, string>();
  const ssr = createServerClient<Database>(url, anonKey(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (c) => c.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data: auth, error } = await ssr.auth.signInWithPassword({
    email: 'demo.player@squadsync.local',
    password: 'demo-password-123',
  });
  if (error || !auth.user) throw new Error('Demo sign-in failed; run scripts/demo-user.ts.');
  const cookieHeader = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  const call = (p: string, method = 'POST') => fetch(`${BASE}${p}`, { method, headers: { cookie: cookieHeader } });

  // --- state: demo player registered, squads formed, their match completed --
  const { data: me } = await admin.from('profiles').select('id').eq('auth_user_id', auth.user.id).single();
  const { data: t } = await admin.from('tournaments').select('id').eq('slug', SLUG).single();
  await call(`/api/tournaments/${SLUG}/reset`);
  await admin.from('tournament_registrations').upsert(
    { tournament_id: t!.id, profile_id: me!.id, desired_role: 'igl' },
    { onConflict: 'tournament_id,profile_id' },
  );
  const formed = await call(`/api/tournaments/${SLUG}/match`);
  if (!formed.ok) throw new Error(`Formation failed: ${formed.status}`);
  const { data: seat } = await admin
    .from('match_participants')
    .select('match_id, matches!inner(tournament_id)')
    .eq('profile_id', me!.id)
    .eq('matches.tournament_id', t!.id)
    .single();
  const matchId = (seat as unknown as { match_id: string }).match_id;
  await call(`/api/matches/${matchId}/complete`);

  // --- capture -----------------------------------------------------------------
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const shoot = async (page: Page, name: string, full = true) => {
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    console.log(`  ${name}.png`);
  };

  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/`);
  await shoot(ap, '01-landing');
  await ap.goto(`${BASE}/signup`);
  await shoot(ap, '02-signup', false);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();

  const pages: [string, string][] = [
    ['/dashboard', '03-dashboard'],
    ['/profile', '04-profile'],
    ['/profile/availability', '05-availability'],
    ['/tournaments', '06-tournaments'],
  ];
  for (const [route, name] of pages) {
    await p.goto(`${BASE}${route}`);
    await shoot(p, name);
  }

  await p.goto(`${BASE}/tournaments/${SLUG}`);
  await p.getByRole('tab', { name: /Players/ }).click();
  await shoot(p, '07-tournament-players', false);
  await p.getByRole('tab', { name: /Squads/ }).click();
  await p.waitForSelector('article');
  for (const summary of (await p.locator('summary').all()).slice(0, 3)) await summary.click();
  await shoot(p, '08-squads-with-reasons');
  await p.getByRole('tab', { name: 'Comparison' }).click();
  await p.waitForTimeout(500);
  await shoot(p, '09-comparison');

  await p.goto(`${BASE}/leaderboard`);
  await shoot(p, '10-leaderboard', false);
  await p.goto(`${BASE}/matches/${matchId}`);
  await shoot(p, '11-match-feedback');
  await p.goto(`${BASE}/analytics`);
  await p.waitForTimeout(500);
  await shoot(p, '12-analytics');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true });
  await mobile.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));
  const mp = await mobile.newPage();
  await mp.goto(`${BASE}/dashboard`);
  await shoot(mp, '13-mobile-dashboard', false);

  await browser.close();
  console.log(`Saved to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
