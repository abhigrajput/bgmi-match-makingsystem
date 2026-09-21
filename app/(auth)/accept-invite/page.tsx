import type { Metadata } from 'next';

import { AcceptInvite } from './accept-invite';

export const metadata: Metadata = {
  title: 'Accept your invite',
};

/**
 * Landing page for Supabase invite (and password-recovery) links.
 *
 * Those links sign the user in with the implicit flow: the session arrives in
 * the URL FRAGMENT (#access_token=...&refresh_token=...), which is never sent
 * to a server. /auth/callback therefore cannot handle them -- it only sees
 * ?code= links -- and forwards anything without a code here, where browser
 * code can read the fragment. Browsers carry a fragment across a redirect
 * whose Location has none, so the tokens survive that hop.
 *
 * An invited account has no password yet, so the page's job after signing in
 * is to have the user set one.
 */
export default function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next =
    searchParams.next && searchParams.next.startsWith('/') && !searchParams.next.startsWith('//')
      ? searchParams.next
      : '/dashboard';
  return <AcceptInvite next={next} />;
}
