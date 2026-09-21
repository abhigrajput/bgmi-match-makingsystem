import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';

import { PlayerStatsPanel } from '@/components/player/stats-panel';
import { StatePanel } from '@/components/shell/state-panel';
import { Avatar, ButtonLink, Card, CardBody } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

type Params = { params: { id: string } };

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const supabase = createClient();

  const { data } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', params.id)
    .maybeSingle();

  return { title: data?.display_name ?? 'Player' };
}

/**
 * One player's public page.
 *
 * "Public" throughout this app means visible to every signed-in player, never
 * anonymous -- 0003's profiles SELECT policy is `TO authenticated`, and an
 * anonymous roster would be a scraping surface harvestable by anyone holding
 * the anon key from the page source.
 *
 * What is NOT here is as deliberate as what is. No preferences: 0003 scopes
 * them to their owner, so a query for someone else's returns nothing. No
 * availability, for the stronger reason given in that migration -- a weekly
 * schedule tied to a named person is a stalking aid, and overlap scoring never
 * needs it client-side. Stats ARE shown: player_stats is readable by every
 * signed-in user, and the panel refuses to present an unscored row as a
 * rating.
 */
export default async function PlayerProfilePage({ params }: Params) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  /**
   * The second query answers "is this me?" -- asked of profiles rather than by
   * comparing params.id to user.id, because those are different identifier
   * spaces: user.id is an auth.users id and the page is keyed by a profiles id.
   * Comparing them directly always says no, silently.
   */
  const [profileResult, myProfileResult, statsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, bgmi_ign, region, bio, avatar_url, created_at')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
    supabase
      .from('player_stats')
      .select('*')
      .eq('profile_id', params.id)
      .maybeSingle(),
  ]);

  const { data: profile, error } = profileResult;

  if (error) {
    return <StatePanel title="Could not load this player" body={error.message} />;
  }

  /**
   * A malformed uuid is a 22P02 from Postgres and lands in the error branch
   * above; a well-formed id with no row lands here. Both are "no such player"
   * to a visitor, and notFound() renders the 404 for the second.
   *
   * Worth being precise about what a 404 means here: profiles is readable by
   * every authenticated user, so a missing row really is missing rather than
   * hidden by policy.
   */
  if (!profile) {
    notFound();
  }

  const isMe = myProfileResult.data?.id === profile.id;

  return (
    <div className="space-y-6">
      <Link
        href="/players"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        All players
      </Link>

      <Card>
        <CardBody className="flex flex-wrap items-start gap-5 py-6">
          <Avatar name={profile.display_name} src={profile.avatar_url} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              {profile.display_name}
            </h1>
            <p className="font-mono text-sm text-muted">{profile.bgmi_ign}</p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Region</dt>
                <dd className="mt-0.5 text-fg">{profile.region ?? 'Not set'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Joined</dt>
                <dd className="mt-0.5 text-fg">
                  {/*
                    Explicit locale and UTC. Left to the runtime, a server
                    render and a client hydration can disagree about both, and
                    React reports that as a hydration mismatch.
                  */}
                  {new Intl.DateTimeFormat('en-GB', {
                    dateStyle: 'medium',
                    timeZone: 'UTC',
                  }).format(new Date(profile.created_at))}
                </dd>
              </div>
            </dl>
            {/* whitespace-pre-line so line breaks the player typed survive.
                The value is rendered as text by React, never as markup. */}
            <p className="mt-4 whitespace-pre-line text-sm text-muted">
              {profile.bio ?? 'No bio yet.'}
            </p>
          </div>
          {isMe ? (
            <ButtonLink href="/profile" variant="secondary" size="sm">
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              Edit profile
            </ButtonLink>
          ) : null}
        </CardBody>
      </Card>

      <PlayerStatsPanel stats={statsResult.data ?? null} />

      <p className="text-xs text-muted">
        Preferences and availability are private to each player and are never
        shown here.
      </p>
    </div>
  );
}
