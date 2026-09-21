/**
 * Service-role Supabase client, for API route handlers only.
 *
 * This file deliberately does NOT read the service-role key itself. Each
 * app/api/**\/route.ts reads process.env.SUPABASE_SERVICE_ROLE_KEY and passes
 * it in, so the one environment variable that bypasses every RLS policy is
 * named only in route handlers and scripts/ -- never in anything a page, a
 * component or a client bundle can import. A grep for the variable name is a
 * complete audit of where it is used.
 *
 * Routes must authenticate the caller with the cookie client BEFORE creating
 * this one: it answers every query as if the caller were the database owner.
 */

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export function createAdminClient(serviceRoleKey: string | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Admin client is missing configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
