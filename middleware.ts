import { NextResponse, type NextRequest } from 'next/server';

import { missingSupabaseConfig } from '@/lib/supabase/config';
import {
  MIDDLEWARE_PROTECTED_TIMEOUT_MS,
  MIDDLEWARE_PUBLIC_TIMEOUT_MS,
  SUPABASE_UNREACHABLE_HEADER,
} from '@/lib/supabase/fetch-timeout';
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

/**
 * Whether the request carries a Supabase session cookie at all.
 *
 * @supabase/ssr stores the session as `sb-<project-ref>-auth-token`, split into
 * `.0`, `.1` chunks when large. No cookie means nothing to refresh and nobody to
 * verify, so there is no reason to call Supabase.
 */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'));
}

export async function middleware(request: NextRequest) {
  const isProtectedRoute = isProtected(request.nextUrl.pathname);

  // A build without Supabase settings: the same answer as an outage, with or
  // without a cookie, because nobody's session can be checked. Names only.
  const missingConfig = missingSupabaseConfig();
  if (missingConfig.length > 0) {
    console.error(`Supabase is not configured, missing at build time: ${missingConfig.join(', ')}`);
    if (isProtectedRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '?error=service';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  /**
   * No session cookie: decided without a network call. Public pages render;
   * protected ones go to /login. This is every anonymous visitor, so a
   * Supabase outage cannot slow down the public site for them at all.
   *
   * Signed-in visitors to public pages are still refreshed below. Skipping
   * them would leave the refresh to the page's server component, which cannot
   * write cookies: the rotated refresh token would be lost and the next use of
   * the old one rejected as reuse, signing the user out. (Task.md, decisions.)
   */
  if (!hasAuthCookie(request)) {
    if (isProtectedRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const session = await updateSession(
    request,
    isProtectedRoute ? MIDDLEWARE_PROTECTED_TIMEOUT_MS : MIDDLEWARE_PUBLIC_TIMEOUT_MS,
  );

  if (session.unavailable) {
    if (isProtectedRoute) {
      // Not "you are signed out": the session may be perfectly valid. The
      // login page shows a service message for this flag.
      return redirectWithSession(request, '/login', session, '?error=service');
    }

    // Fail open. Tell the page so it does not wait on Supabase a second time.
    const headers = new Headers(request.headers);
    headers.set(SUPABASE_UNREACHABLE_HEADER, '1');
    return NextResponse.next({ request: { headers } });
  }

  if (!session.user && isProtectedRoute) {
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
   * The exclusions are for cost, not correctness: a matched request carrying a
   * session cookie makes a getUser() call to the Supabase auth server, and
   * there is no session to refresh on a favicon.
   *
   * Written as a negative lookahead over all paths rather than a positive list
   * of protected ones, because the session refresh has to happen on every page
   * a signed-in user might visit -- not just the guarded ones. Matching only
   * /dashboard would mean tokens never rotate while someone reads the public
   * pages, and they would find themselves signed out on arrival.
   *
   * `_next/static` and `_next/image` are Next's own asset routes. The file
   * extension list catches everything served out of public/. robots.txt,
   * sitemap.xml and the web manifest are crawler and browser fetches that never
   * carry a session worth refreshing.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf)$).*)',
  ],
};
