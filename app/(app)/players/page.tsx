import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  RoleBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Players',
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
 * of every player's profile to satisfy a table layout. The leaderboard shows
 * roles through leaderboard_v, a view that exposes primary_role alone.
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
      .select('id, display_name, bgmi_ign, region, is_active, avatar_url')
      .eq('is_active', true)
      .order('display_name', { ascending: true }),
    supabase
      .from('player_preferences')
      .select('profile_id, primary_role')
      .maybeSingle(),
  ]);

  if (profilesResult.error) {
    return (
      <StatePanel
        title="Could not load the roster"
        body={profilesResult.error.message}
      />
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
    <div>
      <PageHeader
        eyebrow="Community"
        title="Players"
        description={`${profiles.length} active ${profiles.length === 1 ? 'player' : 'players'}. Roles are private to each player, so only yours is shown here; the leaderboard shows everyone's primary role.`}
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No active players yet"
          body="Players appear here as soon as they sign up."
        />
      ) : (
        <Table wrapperClassName="max-h-[70vh]">
          <THead>
            <tr>
              <TH>Player</TH>
              <TH>In-game name</TH>
              <TH>Region</TH>
              <TH>Role</TH>
            </tr>
          </THead>
          <TBody>
            {profiles.map((profile) => {
              const isMe = profile.id === myProfileId;

              return (
                <TR key={profile.id}>
                  <TD>
                    <Link
                      href={`/players/${profile.id}`}
                      className="flex items-center gap-2.5 font-medium text-fg hover:text-data"
                    >
                      <Avatar name={profile.display_name} src={profile.avatar_url} size="sm" />
                      {profile.display_name}
                      {isMe ? <Badge tone="accent">you</Badge> : null}
                    </Link>
                  </TD>
                  <TD className="font-mono text-muted">{profile.bgmi_ign}</TD>
                  <TD className="text-muted">{profile.region ?? 'Not set'}</TD>
                  <TD>
                    {isMe && myRole ? (
                      <RoleBadge role={myRole} />
                    ) : (
                      <span className="text-xs text-muted">Private</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
