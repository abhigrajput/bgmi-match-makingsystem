/**
 * Target selection for scripts: `--target local` or `--target prod`.
 *
 * Reads the service-role credentials straight out of the env file for that
 * target and hands back a client. Two rules, both about secrets:
 *
 *   - Nothing here ever prints a value. Errors name the missing VARIABLE, never
 *     its contents, and the returned object is not logged by any caller.
 *   - local and prod come from different files with different variable names
 *     (.env.local vs .env.production.local), so a script cannot reach
 *     production because someone forgot to change one env var: it has to be
 *     asked for by name on the command line.
 */

import fs from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type Target = 'local' | 'prod';

function parseEnvFile(file: string): Record<string, string> {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) {
    throw new Error(`${file} not found at the project root.`);
  }
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    let value = match[2]!.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]!] = value;
  }
  return out;
}

export function parseTarget(argv: string[] = process.argv.slice(2)): Target {
  const index = argv.indexOf('--target');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value !== 'local' && value !== 'prod') {
    throw new Error('Pass --target local or --target prod.');
  }
  return value;
}

export function credentialsFor(target: Target): { url: string; serviceKey: string } {
  if (target === 'local') {
    const env = parseEnvFile('.env.local');
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('.env.local must set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    return { url, serviceKey };
  }
  const env = parseEnvFile('.env.production.local');
  const url = env.PROD_SUPABASE_URL;
  const serviceKey = env.PROD_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('.env.production.local must set PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY.');
  }
  return { url, serviceKey };
}

/** Service-role client. Bypasses RLS: scripts only, never app code. */
/**
 * The public anon key, for checks that must run as an anonymous caller.
 * Production reads PROD_SUPABASE_ANON_KEY from .env.production.local and
 * returns undefined when it is not set, so callers can say so instead of
 * silently skipping.
 */
export function anonCredentialsFor(target: Target): { url: string; anonKey: string | undefined } {
  const { url } = credentialsFor(target);
  const env = parseEnvFile(target === 'local' ? '.env.local' : '.env.production.local');
  const anonKey = target === 'local' ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : env.PROD_SUPABASE_ANON_KEY;
  return { url, anonKey: anonKey || undefined };
}

/**
 * The Vercel protection bypass for preview deployments: from the environment,
 * or from .env.production.local. Undefined when neither has it. The scheduled
 * workflow has no env file, so a missing file is not an error here.
 */
export function vercelBypass(): string | undefined {
  if (process.env.VERCEL_BYPASS) return process.env.VERCEL_BYPASS;
  if (!fs.existsSync(path.resolve(process.cwd(), '.env.production.local'))) return undefined;
  return parseEnvFile('.env.production.local').VERCEL_BYPASS || undefined;
}

export function serviceClient(target: Target): SupabaseClient<Database> {
  const { url, serviceKey } = credentialsFor(target);
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The host only, for log lines -- enough to tell targets apart, nothing more. */
export function describeTarget(target: Target): string {
  return `${target} (${new URL(credentialsFor(target).url).host})`;
}
