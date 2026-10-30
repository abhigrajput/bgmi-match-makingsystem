import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { missingSupabaseConfig } from '@/lib/supabase/config';
import { fetchWithTimeout } from '@/lib/supabase/fetch-timeout';
import type { Database } from '@/types/database';

/**
 * GET /api/health -- is the app up, and can it reach its database?
 *
 * Two callers. Uptime checks want a yes or no. The keep-alive workflow
 * (.github/workflows/keep-alive.yml) calls it every three days so the
 * free-tier Supabase project always sees activity: on 2026-10-30 the project
 * auto-paused after weeks without traffic and every sign-in failed (Task.md).
 *
 * The database read is public_stats() through the anon key: granted to anon
 * already, a definer function returning three counts, cheap at this size. Only
 * the outcome is returned, never the counts, the error text or any config
 * value -- this route is public and has nothing to say beyond "ok" or
 * "unavailable", plus, for a broken build, the NAMES of the missing variables.
 */

export const dynamic = 'force-dynamic';

const HEALTH_TIMEOUT_MS = 5000;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { status: 'misconfigured', missing: missingSupabaseConfig() },
      { status: 503, headers: NO_STORE },
    );
  }

  const started = Date.now();
  try {
    const supabase = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout(HEALTH_TIMEOUT_MS) },
    });
    const { error } = await supabase.rpc('public_stats');
    if (error) throw error;

    return NextResponse.json(
      { status: 'ok', database: 'ok', ms: Date.now() - started },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable', database: 'unreachable', ms: Date.now() - started },
      { status: 503, headers: NO_STORE },
    );
  }
}
