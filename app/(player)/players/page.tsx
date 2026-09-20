import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { PlayerRole } from '@/types/database';

export const metadata: Metadata = {
  title: 'Players',
};

const ROLE_LABELS: Record<PlayerRole, string> = {
  igl: 'IGL',
  assaulter: 'Assaulter',
  sniper: 'Sniper',
  support: 'Support',
  flex: 'Flex',
};

/**
 * The player roster.
 *
 * WHY ROLE IS SHOWN FOR ONE ROW AND NOT THE REST
 *
 * primary_role lives on player_preferences, and 0003 scopes SELECT on that
 * table to its owner -- a visible skill band lets someone tune their own to
 * land in a specific player's squad, which is queue manipulation. So a roster
 * query that joins preferences returns a role for exactly one row: yours.
 *
 * That is the policy working, not a bug, and the fix is NOT service_role. This
 * page runs on the anon key with the user's JWT, like every other page under
 * app/, and bypassing RLS to populate a column would publish the strategic half
 * of every player's profile to satisfy a table layout.
 *
 * So the column says "Private" for everyone else and means it. If roles should
 * be public later, that is a migration exposing primary_role alone -- a
 * deliberate narrowing of the rule 0003 argued for, reviewed as such -- not a
 * key swap here.
 *
 * profiles itself IS readable by every signed-in user, which is the deliberate
 * opening in the model: a recommender cannot show you four strangers without
 * reading their names. What keeps that safe is what 0001 left out of the table
 * -- no email, no phone, no credentials -- so the worst case is a list of
 * public gamer handles.
 */
export default async function PlayersPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  /**
   * Two queries rather than one join, and the split is the point.
   *
   * The roster is a public read of profiles. The role is an own-row read of
   * preferences. Expressing that as a single left join would render a column
   * that is populated by a policy rather than by a filter, and the next person
   * to touch it would reasonably read the nulls as "no role set" instead of
   * "not visible to you" -- and reach for service_role to "fix" them.
   *
   * is_active is filtered here rather than by policy: 0003 has no opinion on
   * suspended profiles, so they are readable, and a roster is the one place a
   * suspended account should not appear.
   */
  const [profilesResult, myPreferencesResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, bgmi_ign, region, is_active')
      .eq('is_active', true)
      .order('display_name', { ascending: true }),
    supabase
      .from('player_preferences')
      .select('profile_id, primary_role')
      .maybeSingle(),
  ]);

  if (profilesResult.error) {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Could not load the roster</h1>
        <p className="text-red-800">{profilesResult.error.message}</p>
      </main>
    );
  }

  const profiles = profilesResult.data ?? [];

  // No `.eq()` on the preferences query above: the SELECT policy already
  // restricts it to the caller's row, so maybeSingle() returns that row or
  // nothing. An error here is not worth failing the page for -- the roster is
  // still complete without your own role in it.
  const myRole = myPreferencesResult.data?.primary_role ?? null;
  const myProfileId = myPreferencesResult.data?.profile_id ?? null;

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Players</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every active player. Roles are private to each player, so only yours is
          shown.
        </p>
      </div>

      {profiles.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No active players yet.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left">
              <th scope="col" className="py-2 pr-4 font-medium">
                Player
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                In-game name
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Region
              </th>
              <th scope="col" className="py-2 font-medium">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const isMe = profile.id === myProfileId;

              return (
                <tr key={profile.id} className="border-b border-neutral-200">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/players/${profile.id}`}
                      className="underline"
                    >
                      {profile.display_name}
                    </Link>
                    {isMe ? (
                      <span className="ml-2 text-xs text-neutral-500">you</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{profile.bgmi_ign}</td>
                  <td className="py-2 pr-4">
                    {profile.region ?? (
                      <span className="text-neutral-500">Not set</span>
                    )}
                  </td>
                  <td className="py-2">
                    {isMe && myRole ? (
                      ROLE_LABELS[myRole]
                    ) : (
                      <span className="text-neutral-500">Private</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
