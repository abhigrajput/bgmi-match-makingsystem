import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * OAuth / email-confirmation callback.
 *
 * Where the user lands after clicking the confirmation link in their signup
 * email. Supabase appends a one-time `code` to the URL; exchanging it here sets
 * the session cookies and signs them in.
 *
 * This is a Route Handler rather than a page because it has no UI -- it exists
 * to perform one exchange and redirect. Rendering a page would mean rendering
 * it before the session exists, which is the state this route is fixing.
 *
 * It lives under app/auth/ rather than in the (auth) route group on purpose:
 * this is a machine endpoint and its path is part of a contract. The URL is
 * registered in the Supabase dashboard's redirect allow-list and is sent as
 * `emailRedirectTo` from the signup action, so moving it breaks confirmation
 * links that are already sitting in people's inboxes.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');

  /**
   * Where to go after a successful exchange.
   *
   * `next` is attacker-controlled -- the whole URL is, since it arrives in an
   * email that can be forged. Accepting it unchecked is an open redirect: a
   * link to our own domain that bounces the user to an attacker's login page,
   * carrying our origin's credibility with it.
   *
   * The guard is that it must be a path, not a URL. A leading `//` is rejected
   * along with everything else, because `//evil.example` is protocol-relative
   * and browsers treat it as absolute.
   */
  const requestedNext = searchParams.get('next');
  const next =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/dashboard';

  if (code) {
    const supabase = createClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  /**
   * No code, or an exchange that failed -- an expired link, one already used,
   * or one from a different browser than it was requested in.
   *
   * Redirected to /login with a flag rather than rendering an error, because
   * the only useful next step is to sign in, and the reason is not worth
   * distinguishing: all three are fixed by the same action. The flag is a bare
   * marker with no detail in it, since it ends up in the user's history and in
   * any referrer header the login page emits.
   */
  /**
   * No ?code= at all: an implicit-flow link (Supabase invites and recovery
   * emails), whose session is in the URL fragment where this server route
   * cannot see it. Hand it to /accept-invite, which reads the fragment in the
   * browser. The browser re-attaches the fragment because this redirect's
   * Location has none of its own.
   */
  if (!code) {
    return NextResponse.redirect(`${origin}/accept-invite?next=${encodeURIComponent(next)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
