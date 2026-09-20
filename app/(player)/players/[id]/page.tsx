import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

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
 * needs it client-side. No stats either, though the policy would permit it:
 * player_stats has no writer until Phase 6, so every row would read 50 across
 * the board, and a rating shown before anything computes it is worse than no
 * rating at all.
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
  const [profileResult, myProfileResult] = await Promise.all([
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
  ]);

  const { data: profile, error } = profileResult;

  if (error) {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Could not load this player</h1>
        <p className="text-red-800">{error.message}</p>
      </main>
    );
  }

  /**
   * A malformed uuid is a 22P02 from Postgres and lands in the error branch
   * above; a well-formed id with no row lands here. Both are "no such player"
   * to a visitor, and notFound() renders the 404 for the second.
   *
   * Worth being precise about what a 404 means here: profiles is readable by
   * every authenticated user, so a missing row really is missing rather than
   * hidden by policy. On a table with a restrictive SELECT policy the same code
   * would conflate "does not exist" with "not yours to see" -- which is usually
   * the right thing to tell a stranger, but is not what is happening on this
   * page.
   */
  if (!profile) {
    notFound();
  }

  const isMe = myProfileResult.data?.id === profile.id;

  return (
    <main className="space-y-6">
      <div className="flex items-start gap-4">
        {/*
          A plain <img>, not next/image: the URL is arbitrary user input, and
          next/image would need every possible host in remotePatterns or it
          throws at render. The scheme is restricted to http/https by the
          avatar_url schema, which is the check that matters here.

          No alt text describing the person -- the name is beside it, and
          "Avatar of X" would just repeat it to a screen reader. Empty alt
          marks it decorative.
        */}
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-full border border-neutral-200 object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 text-lg text-neutral-500"
          >
            {profile.display_name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div>
          <h1 className="text-xl font-semibold">{profile.display_name}</h1>
          <p className="text-sm text-neutral-600">{profile.bgmi_ign}</p>
        </div>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">Region</dt>
          <dd className="text-neutral-700">
            {profile.region ?? 'Not set'}
          </dd>
        </div>

        <div>
          <dt className="font-medium">Bio</dt>
          {/* whitespace-pre-line so line breaks the player typed survive. The
              value is rendered as text by React, never as markup. */}
          <dd className="whitespace-pre-line text-neutral-700">
            {profile.bio ?? 'Nothing yet.'}
          </dd>
        </div>

        <div>
          <dt className="font-medium">Joined</dt>
          <dd className="text-neutral-700">
            {/*
              Formatted with an explicit locale and UTC rather than the
              default. Left to the runtime, a server render and a client
              hydration can disagree about both, and React reports that as a
              hydration mismatch on a date nobody is reading closely.
            */}
            {new Intl.DateTimeFormat('en-GB', {
              dateStyle: 'medium',
              timeZone: 'UTC',
            }).format(new Date(profile.created_at))}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-neutral-500">
        Preferences, availability and skill ratings are not shown. The first two
        are private to each player; ratings arrive with match results in a later
        phase.
      </p>

      <p className="flex gap-4 text-sm">
        <Link href="/players" className="underline">
          Back to all players
        </Link>
        {/* This page is the read-only view of a row the owner edits elsewhere,
            so when it is your own, offer the way back to the editor. */}
        {isMe ? (
          <Link href="/profile" className="underline">
            Edit your profile
          </Link>
        ) : null}
      </p>
    </main>
  );
}
