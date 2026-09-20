/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Despite running on the server, this client still authenticates as the *user*,
 * not as the application: it reads the session out of the request cookies and
 * sends that user's JWT with every query. Row-level security therefore applies
 * to it exactly as it does to the browser client. A server component querying
 * `matches` sees the matches the signed-in user participated in, and nothing
 * more.
 *
 * That is the intended design, and it is worth being explicit about because the
 * instinct is the opposite -- "it's server code, so it's trusted". Trusted
 * server code that bypasses RLS is what the service role key is for, and the
 * service role key is not used anywhere under app/. Nothing in the web tier
 * needs it: the only writers that legitimately bypass policy are the matcher
 * and the ML service, which are separate processes.
 *
 * `cookies()` is dynamic, so importing this into a component opts that route
 * out of static rendering. For an authenticated app that is what you want.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import type { Database } from '@/types/database';

// Read as complete literal expressions -- see the note in client.ts. On the
// server these are ordinary environment reads, but keeping the two files
// symmetrical avoids someone "tidying" the browser one into a helper later.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creates a request-scoped Supabase client.
 *
 * Must be called inside the request that will use it, and its result must not
 * be cached across requests or hoisted to module scope: it closes over one
 * request's cookie store, so a shared instance would serve one user's session
 * to another. That failure is silent and catastrophic, which is why there is no
 * singleton export here.
 */
export function createClient() {
  /**
   * Read before the configuration check, and the order matters.
   *
   * `cookies()` is how a route announces that it is dynamic: calling it during
   * static generation throws a signal that Next.js catches and treats as "this
   * page cannot be prerendered". Putting the env check first means that on a
   * build machine without the variables set, our own error is thrown before
   * that signal is ever raised -- so Next never learns the route is dynamic,
   * tries to prerender it, and the build fails with a prerender error naming
   * the wrong problem.
   */
  const cookieStore = cookies();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase server client is missing configuration. Set NEXT_PUBLIC_SUPABASE_URL ' +
        'and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    );
  }

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },

      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /**
           * Server Components cannot set cookies -- by the time one runs, the
           * response headers are already committed, and Next.js throws here.
           *
           * Swallowing that is correct rather than lazy, but only because of
           * what else is true: the root middleware refreshes the session on
           * every matching request and writes the rotated cookies onto a
           * response that *can* carry them. So the only writes that reach this
           * catch are ones the middleware has already performed, and dropping
           * them loses nothing.
           *
           * Remove the middleware and this becomes a real bug: tokens would
           * rotate in memory, fail to persist, and users would be signed out
           * roughly every hour when the refresh token they still hold turns out
           * to be stale. The two files are a pair.
           *
           * The error is not rethrown and not logged, because it is expected on
           * every Server Component render of a signed-in page and would drown
           * the logs in noise that means nothing.
           */
        }
      },
    },
  });
}
