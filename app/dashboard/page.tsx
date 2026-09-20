import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * The authenticated profile, as plain text.
 *
 * Deliberately the whole of Phase 2's dashboard. There is no navigation, no
 * sign-out control, no stats and no queue -- those are later phases, and a
 * placeholder UI built now would be written against guesses about data this
 * phase has not produced yet. What this page is for is proving the chain end to
 * end: a session exists, it resolves to an auth user, that user has a profile
 * because the 0002 trigger made one, and the 0003 SELECT policy lets them read
 * it. If this renders, Phase 2 works.
 *
 * A server component, so the query runs on the server with the user's JWT and
 * the row arrives already rendered. There is no client-side fetch and no
 * loading state to manage.
 */
export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /**
   * The middleware has already redirected unauthenticated requests here, so
   * this branch is close to unreachable -- but only close. Middleware runs on a
   * matcher that could be edited, and a Server Component is rendered by the
   * framework, not by the middleware, so the two are not actually coupled. A
   * page that reads `user.id` must establish that `user` exists rather than
   * assume an upstream file still guarantees it.
   */
  if (!user) {
    redirect('/login');
  }

  /**
   * No `.eq('auth_user_id', user.id)` filter would be needed for correctness --
   * the RLS policy on profiles is SELECT-public, so this returns the whole
   * table without one, and `maybeSingle()` would then fail on multiple rows.
   *
   * It is here because "my profile" is the question being asked, and the query
   * should say so. Relying on a policy to narrow a result set is how you end up
   * with a query whose meaning changes when the policy does.
   */
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    // Rendered rather than thrown: the message is the reason to look at this
    // page at all during Phase 2, and an error boundary would hide it.
    return (
      <main className="p-8 font-mono text-sm">
        <p>Could not load profile.</p>
        <p>{error.message}</p>
      </main>
    );
  }

  if (!profile) {
    /**
     * An authenticated account with no profile row. This is the exact state
     * that handle_new_user() exists to make impossible, so reaching it means
     * something is wrong at the database level -- most likely that the
     * `on_auth_user_created` trigger is missing, which a project restore from
     * backup can do silently.
     *
     * Stated plainly instead of rendering an empty page, because an empty
     * dashboard looks like a styling bug and would send someone looking in
     * entirely the wrong place.
     */
    return (
      <main className="p-8 font-mono text-sm">
        <p>No profile row for this account.</p>
        <p>auth_user_id: {user.id}</p>
        <p>
          Check that the on_auth_user_created trigger exists on auth.users
          (supabase/migrations/0002_triggers.sql).
        </p>
      </main>
    );
  }

  return (
    <main className="p-8 font-mono text-sm">
      <pre className="whitespace-pre-wrap">
        {[
          `id:            ${profile.id}`,
          `auth_user_id:  ${profile.auth_user_id ?? '(null)'}`,
          `display_name:  ${profile.display_name}`,
          `bgmi_ign:      ${profile.bgmi_ign}`,
          `region:        ${profile.region ?? '(null)'}`,
          `avatar_url:    ${profile.avatar_url ?? '(null)'}`,
          `bio:           ${profile.bio ?? '(null)'}`,
          `is_active:     ${profile.is_active}`,
          `created_at:    ${profile.created_at}`,
          `updated_at:    ${profile.updated_at}`,
        ].join('\n')}
      </pre>
    </main>
  );
}
