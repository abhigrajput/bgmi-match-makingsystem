import type { NextRequest } from 'next/server';

import { redirectWithSession, updateSession } from '@/lib/supabase/middleware';

/**
 * Root middleware. Two jobs, in this order.
 *
 * 1. Refresh the Supabase session. This is not optional bookkeeping -- it is
 *    the only place in a Next.js app where rotated auth cookies can actually be
 *    written to the response, so without it every signed-in user is silently
 *    logged out when their access token expires. See lib/supabase/middleware.ts
 *    for the mechanics.
 *
 * 2. Send unauthenticated requests for protected pages to /login.
 *
 * Note what step 2 is NOT. This is a routing convenience, not a security
 * boundary. Middleware decides which page renders; it does not decide what data
 * that page can read. If this file were deleted, /dashboard would still be
 * unable to show another user's profile, because the queries it issues run
 * under that user's JWT and the RLS policies in 0003 constrain them. The
 * boundary is in the database, and it has to be -- PostgREST is reachable
 * directly with the anon key and never passes through this file at all.
 *
 * Getting that backwards is the standard way these applications end up
 * exposed: protect the routes, skip the policies, and every guarded page
 * becomes readable by anyone willing to call the API instead of the UI.
 */

/**
 * Path prefixes that require a signed-in user.
 *
 * A prefix list rather than a regex so that /dashboard and everything beneath
 * it is covered by one entry, and so that adding a section is a one-line
 * change that reads as a statement of policy.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/tournaments',
  '/players',
  '/leaderboard',
  '/matches',
  '/analytics',
  '/profile',
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const session = await updateSession(request);

  if (!session.user && isProtected(request.nextUrl.pathname)) {
    // Through redirectWithSession, never NextResponse.redirect directly: a
    // bare redirect carries none of the cookies the refresh above just wrote,
    // which produces a sign-in loop rather than an error.
    return redirectWithSession(request, '/login', session);
  }

  // The response from updateSession, unmodified. Constructing a new one here
  // would discard the refreshed session.
  return session.response;
}

export const config = {
  /**
   * Runs on everything except static assets and image files.
   *
   * The exclusions are for cost, not correctness: every matched request makes a
   * getUser() call to the Supabase auth server, and there is no session to
   * refresh on a favicon.
   *
   * Written as a negative lookahead over all paths rather than a positive list
   * of protected ones, because the session refresh has to happen on every page
   * a signed-in user might visit -- not just the guarded ones. Matching only
   * /dashboard would mean tokens never rotate while someone reads the public
   * pages, and they would find themselves signed out on arrival.
   *
   * `_next/static` and `_next/image` are Next's own asset routes. The file
   * extension list catches everything served out of public/.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf)$).*)',
  ],
};
