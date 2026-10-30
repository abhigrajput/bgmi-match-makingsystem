/**
 * scripts/auth-health.ts -- can a person sign up and sign in right now?
 *
 *   npx tsx scripts/auth-health.ts --target prod
 *   npx tsx scripts/auth-health.ts --target prod --base https://<deployment>
 *
 * Checks, in the order they would fail:
 *   1. The auth server answers (/auth/v1/health). A paused project fails here.
 *   2. The catalog is as designed: handle_new_user(), its trigger, RLS on every
 *      table, the policy count (schema_health(), migration 0008).
 *   3. A real account works: create one, confirm the trigger built its profile,
 *      sign in with its password, delete it, confirm the profile went with it.
 *   4. With --base: the deployment answers /api/health and renders /login.
 *
 * That form needs the service role key, so it is a manual, local script: this
 * repository is public, and the scheduled workflow must not hold that key.
 *
 *   npx tsx scripts/auth-health.ts --anon --base https://<deployment>
 *
 * The anon form is what .github/workflows/auth-health.yml runs. It uses nothing
 * private: /api/health (which reads the database), /login renders, a signed-out
 * /dashboard redirects. With SUPABASE_URL and SUPABASE_ANON_KEY in the
 * environment (both public values) it also checks that the auth server answers
 * and that anon is refused the catalog and player tables.
 *
 * Reads credentials from the .env files. VERCEL_BYPASS, when set, is sent as
 * x-vercel-protection-bypass for protected preview deployments. Sends no email.
 * Prints PASS/FAIL per check and no secret; exits non-zero on any failure.
 */

import { createClient } from '@supabase/supabase-js';

import { credentialsFor, parseTarget, serviceClient } from './lib/env';
import { evaluateSchemaHealth, type SchemaHealth } from './lib/schema-health';

const TIMEOUT_MS = 10_000;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const bypassHeaders = (): Record<string, string> =>
  process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {};

/** The secret-free checks. Safe to run from a public repository's schedule. */
async function anonChecks() {
  const base = argValue('--base')?.replace(/\/$/, '');
  if (!base) throw new Error('--anon needs --base <deployment url>.');

  let failures = 0;
  const report = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const get = (path: string) =>
    fetch(`${base}${path}`, {
      headers: bypassHeaders(),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  for (const [name, path, expect] of [
    ['/api/health reads the database', '/api/health', 200],
    ['/login renders', '/login', 200],
  ] as const) {
    try {
      const response = await get(path);
      report(name, response.status === expect, `HTTP ${response.status}`);
    } catch (error) {
      report(name, false, error instanceof Error ? error.name : 'failed');
    }
  }

  try {
    const response = await get('/dashboard');
    const location = response.headers.get('location') ?? '';
    report('signed-out /dashboard redirects to /login', response.status === 307 && location.includes('/login'), `HTTP ${response.status}`);
  } catch (error) {
    report('signed-out /dashboard redirects to /login', false, error instanceof Error ? error.name : 'failed');
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (url && anonKey) {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    report('auth server answers', !!response?.ok, response ? `HTTP ${response.status}` : 'unreachable');

    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: catalogError } = await anon.rpc('schema_health' as never);
    report('anon is refused schema_health()', !!catalogError, catalogError?.code ?? 'anon could read it');
    const { data: rows, error: tableError } = await anon.from('profiles').select('id').limit(1);
    report('anon cannot read profiles', !!tableError || (rows ?? []).length === 0, tableError?.code ?? `${rows?.length ?? 0} rows`);
  } else {
    console.log('SKIP  auth server and anon refusal checks (SUPABASE_URL, SUPABASE_ANON_KEY not set)');
  }

  console.log(failures === 0 ? '\nPublic checks pass.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function main() {
  if (process.argv.includes('--anon')) return anonChecks();

  const target = parseTarget();
  const base = argValue('--base')?.replace(/\/$/, '');
  const { url, serviceKey } = credentialsFor(target);
  const db = serviceClient(target);

  let failures = 0;
  const report = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  // 1. The auth server.
  try {
    const started = Date.now();
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: serviceKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    report('auth server answers', response.ok, `HTTP ${response.status}, ${Date.now() - started} ms`);
  } catch (error) {
    report('auth server answers', false, error instanceof Error ? error.name : 'failed');
    console.log('\nThe auth server is unreachable, so the remaining checks cannot run.');
    process.exitCode = 1;
    return;
  }

  // 2. The catalog.
  {
    const { data, error } = await db.rpc('schema_health' as never);
    if (error) {
      report('schema_health() callable (migration 0008 applied)', false, error.code ?? 'error');
    } else {
      for (const c of evaluateSchemaHealth(data as SchemaHealth)) report(c.name, c.ok, c.detail);
    }
  }

  // 3. A real account. email_confirm so it can sign in without any mail.
  const runId = Date.now().toString(36);
  const email = `auth-health-${runId}@squadsync-e2e.test`;
  const password = `Health-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  const ign = `hc_${runId}`.slice(0, 20);

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Auth Health', bgmi_ign: ign, region: 'India-South' },
  });
  report('create test user', !createError && !!created.user, createError?.code ?? '');

  if (created.user) {
    try {
      const { data: rows, error } = await db.from('profiles').select('auth_user_id, region').eq('bgmi_ign', ign);
      report('trigger created the profile', !error && rows?.[0]?.auth_user_id === created.user.id, error?.code ?? '');
      report('trigger saved the region (migration 0007 applied)', rows?.[0]?.region === 'India-South', String(rows?.[0]?.region));

      // A separate client: signing in on `db` would replace its service-role
      // session with this user's.
      const client = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
      report('test user can sign in', !signInError && !!signedIn.session, signInError?.code ?? '');
    } finally {
      const { error: deleteError } = await db.auth.admin.deleteUser(created.user.id);
      report('delete test user', !deleteError, deleteError?.code ?? '');
      const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('bgmi_ign', ign);
      report('profile deleted with the user', count === 0, `${count ?? '?'} rows left`);
    }
  }

  // 4. The deployment.
  if (base) {
    const headers = bypassHeaders();
    for (const path of ['/api/health', '/login']) {
      try {
        // redirect: 'manual', or a protected preview's redirect to the Vercel
        // login page, which answers 200, would count as a pass.
        const response = await fetch(`${base}${path}`, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        report(`deployment ${path}`, response.ok, `HTTP ${response.status}`);
      } catch (error) {
        report(`deployment ${path}`, false, error instanceof Error ? error.name : 'failed');
      }
    }
  }

  console.log(failures === 0 ? '\nAuth is healthy.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
