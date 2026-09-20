/**
 * Supabase client for the browser.
 *
 * This is the only one of the three clients that runs in code shipped to the
 * user's device. Everything it touches is public by construction: the project
 * URL and the anon key are both inlined into the JavaScript bundle by Next.js
 * and are readable by anyone who opens devtools.
 *
 * That is not a leak. The anon key is a public identifier, not a credential --
 * it says "requests are coming from this project", and nothing about who is
 * making them. Authorization comes from the user's JWT, and what that JWT is
 * allowed to do is decided by the RLS policies in 0003_rls.sql. If those
 * policies were removed, this key would be a full read/write handle on the
 * database; with them in place it is a handle on the caller's own rows.
 *
 * The service role key never appears in this file, in anything this file
 * imports, or in anything under app/. It bypasses RLS entirely, so a single
 * import of it into a client component would put an unrestricted database key
 * into the bundle -- and no amount of policy work would matter after that.
 */

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/types/database';

/**
 * Both reads below are written as complete `process.env.NEXT_PUBLIC_*`
 * expressions on purpose, and must stay that way.
 *
 * Next.js does not give the browser a `process.env` object -- it performs a
 * literal text substitution at build time on exactly this syntax. Pulling the
 * name into a variable (`const k = 'NEXT_PUBLIC_SUPABASE_URL'`) or reading it
 * through a helper defeats the substitution, and the value arrives as
 * `undefined` at runtime with no build error to warn you. That is why this one
 * small piece of duplication exists across the three client files rather than
 * being factored into a shared env module.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creates a browser Supabase client, typed against the schema in
 * types/database.ts so that `.from('profiles')` knows its own columns.
 *
 * Called per component rather than exported as a singleton. The underlying
 * client is cheap, and a module-level instance would be constructed during the
 * server render pass of any client component -- where `document.cookie` does
 * not exist -- which is a confusing way to fail.
 */
export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Thrown rather than allowed to produce a client pointed at `undefined`,
    // which fails later as an opaque network error against the URL
    // "undefined/auth/v1/token". Missing configuration should say so.
    throw new Error(
      'Supabase browser client is missing configuration. Set NEXT_PUBLIC_SUPABASE_URL ' +
        'and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    );
  }

  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
