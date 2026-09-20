import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out and returns them to the login page.
 *
 * POST only, and there is no GET export on purpose. Sign-out is a state change,
 * and a state change reachable by GET is reachable by anything that can make
 * the browser issue one: an <img src="/auth/signout"> on any page on the
 * internet, a link-preview crawler, or a prefetch. That is CSRF -- low severity
 * here, since the worst outcome is an unwanted sign-out rather than a
 * destructive write, but it is free to prevent and there is no reason to accept
 * a class of bug just because this instance of it is mild.
 *
 * The practical consequence is that this endpoint must be called from a form:
 *
 *   <form action="/auth/signout" method="post">
 *     <button type="submit">Sign out</button>
 *   </form>
 *
 * Nothing in the app calls it yet -- the Phase 2 dashboard is specified as
 * profile text and nothing else, so it renders no sign-out control. The route
 * is in place for the Phase 3 navigation.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  // getUser() before signOut() so that a request with no valid session does not
  // trigger a pointless token revocation call to the auth server. It is also
  // the honest check: signOut() on an absent session succeeds, which would make
  // this route look like it did something when it did not.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Scope 'local' clears the session on this device only. The alternative,
    // 'global', revokes every refresh token for the account and signs the user
    // out of their phone as well -- correct for a "sign out everywhere" control
    // the user deliberately chose, wrong for the ordinary sign-out button,
    // which they expect to affect the browser they clicked it in.
    await supabase.auth.signOut({ scope: 'local' });
  }

  // Drops any cached render produced for the signed-in user, so the next
  // request does not serve their layout to whoever is at the keyboard now.
  revalidatePath('/', 'layout');

  // 303 rather than the default 307. A 307 preserves the method, so the browser
  // would re-issue this POST against /login. 303 is the status that means
  // "your POST is done, now GET this other thing", which is exactly the case.
  return NextResponse.redirect(new URL('/login', request.url), {
    status: 303,
  });
}
