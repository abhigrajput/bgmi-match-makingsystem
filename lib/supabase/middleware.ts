/**
 * Supabase session handling for Next.js middleware.
 *
 * Middleware runs on the Edge runtime before a route is rendered, and it is the
 * only place in a Next.js app that can both read the incoming cookies and set
 * cookies on the outgoing response. That makes it the only place a Supabase
 * session can actually be refreshed: access tokens are short-lived, and when
 * one expires the client exchanges the refresh token for a new pair and must
 * persist them. Server Components cannot write cookies (see the catch block in
 * server.ts), so without this file the rotated tokens are computed and thrown
 * away, and users are silently signed out about once an hour.
 *
 * Two invariants govern everything below. Both are easy to break by accident
 * and neither fails loudly:
 *
 *   1. The response object returned to Next.js must be the same one the
 *      Supabase client wrote its cookies onto. Constructing a fresh
 *      NextResponse afterwards, or returning a redirect built from scratch,
 *      discards the refreshed session -- which presents as users being logged
 *      out at random rather than as an error.
 *
 *   2. `getUser()` must be called, not `getSession()`. getSession() reads the
 *      JWT out of the cookie and trusts it; the cookie is attacker-controlled.
 *      getUser() revalidates it against the Supabase auth server. In middleware
 *      that decides access, trusting an unverified cookie is the whole
 *      vulnerability.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

// See the note in client.ts on why these are literal expressions.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export interface SessionResult {
  /**
   * The response carrying any refreshed auth cookies. Return this, or a
   * redirect derived from it via `redirectWithSession()` -- never a bare
   * NextResponse.
   */
  response: NextResponse;

  /**
   * The authenticated user, verified against the auth server, or null when the
   * request carries no valid session.
   */
  user: User | null;
}

/**
 * Refreshes the Supabase session for a request and reports who is making it.
 *
 * Deliberately does not decide anything about access. Which paths require a
 * user is route policy, and it lives in the root middleware.ts where it can be
 * read next to the matcher config that determines where this runs at all.
 * Keeping the two apart means changing the protected-route list never risks
 * disturbing the cookie plumbing above.
 */
export async function updateSession(
  request: NextRequest,
): Promise<SessionResult> {
  // Seeded from the request so that request headers propagate to the route.
  // Reassigned inside setAll below -- that reassignment is invariant 1.
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase middleware is missing configuration. Set NEXT_PUBLIC_SUPABASE_URL ' +
        'and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    );
  }

  const supabase = createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          // Written twice, to two different places, and both are necessary.
          //
          // Onto the request: so that a Server Component rendering later in
          // this same request sees the new token rather than the expired one
          // it arrived with. Without this, the first render after a refresh
          // still reads a stale session.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          // Rebuilt from the mutated request, then the cookies are set on the
          // response with their options (Max-Age, SameSite, Secure) so the
          // browser actually stores them. Skipping this half rotates the token
          // for exactly one request and loses it.
          response = NextResponse.next({
            request: { headers: request.headers },
          });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Invariant 2. This is also what triggers the refresh: if the access token
  // has expired, the library exchanges the refresh token here, which calls
  // setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/**
 * Builds a redirect that preserves the refreshed session cookies.
 *
 * `NextResponse.redirect(url)` on its own is a brand-new response with no
 * cookies on it. Returning one from middleware after a token refresh throws the
 * refreshed session away, so the user is bounced to /login, signs in, gets
 * redirected, and is bounced again -- an infinite loop that looks like a broken
 * login form rather than a dropped cookie. Copying the cookies across is what
 * prevents that.
 */
export function redirectWithSession(
  request: NextRequest,
  pathname: string,
  session: SessionResult,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';

  const redirect = NextResponse.redirect(url);

  for (const cookie of session.response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  return redirect;
}
