import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CompletenessCard } from '@/components/player/completeness-card';
import { computeCompleteness } from '@/lib/player/completeness';
import { loadPlayerOverview } from '@/lib/player/queries';
import { DAY_NAMES, formatMinutes } from '@/lib/player/time';
import type { CommPreference, PlayerRole } from '@/types/database';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * The signed-in landing page: who you are, what you have declared, and what is
 * still missing before matchmaking can use any of it.
 *
 * Phase 2 left this as a text dump of the profile row, whose job was to prove
 * the chain end to end -- session, auth user, trigger-provisioned profile, RLS
 * read. That chain is proven, and the dump is replaced here by summaries of the
 * three things a player owns.
 *
 * Still deliberately absent: no queue, no matchmaking, no stats charts. Those
 * belong to later phases, and a placeholder built now would be written against
 * guesses about data that does not exist yet -- player_stats has no writer
 * until Phase 6, so any chart here would be plotting six columns of 50.
 *
 * A server component. Every read runs with the user's JWT under RLS, and the
 * queries are shared with /profile via lib/player/queries so the two pages
 * cannot disagree about whether you are ready to be matched.
 */

/**
 * Sign-out control.
 *
 * A plain HTML form, not a button with an onClick. /auth/signout is POST-only
 * on purpose -- a sign-out reachable by GET can be triggered by any
 * <img src="/auth/signout"> on any page on the internet -- and a form is how
 * you issue a POST without shipping JavaScript to do it. This stays a server
 * component and works with JS disabled.
 */
function SignOutForm() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
      >
        Sign out
      </button>
    </form>
  );
}

const ROLE_LABELS: Record<PlayerRole, string> = {
  igl: 'IGL',
  assaulter: 'Assaulter',
  sniper: 'Sniper',
  support: 'Support',
  flex: 'Flex',
};

const COMM_LABELS: Record<CommPreference, string> = {
  voice_required: 'Voice required',
  voice_optional: 'Voice optional',
  text_only: 'Text only',
  silent: 'Silent',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default async function DashboardPage() {
  const result = await loadPlayerOverview();

  if (result.status === 'unauthenticated') {
    redirect('/login');
  }

  if (result.status === 'no-profile') {
    /**
     * An authenticated account with no profile row -- the exact state
     * handle_new_user() exists to make impossible. Reaching it means something
     * is wrong at the database level, most likely that the on_auth_user_created
     * trigger is missing, which a project restore from backup can do silently.
     *
     * Stated plainly rather than rendered as an empty page, because an empty
     * dashboard looks like a styling bug and sends someone looking in entirely
     * the wrong place.
     */
    return (
      <main className="mx-auto w-full max-w-3xl space-y-3 px-6 py-8 text-sm">
        <h1 className="text-lg font-semibold">No profile row for this account</h1>
        <p>auth_user_id: {result.authUserId}</p>
        <p className="text-neutral-700">
          Check that the on_auth_user_created trigger exists on auth.users
          (supabase/migrations/0002_triggers.sql).
        </p>
        {/* Offered on the failure paths too: the page is a dead end without it,
            and signing out and back in is the first thing worth trying. */}
        <SignOutForm />
      </main>
    );
  }

  if (result.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-3 px-6 py-8 text-sm">
        <h1 className="text-lg font-semibold">Could not load your dashboard</h1>
        <p className="text-red-800">{result.message}</p>
        <SignOutForm />
      </main>
    );
  }

  const { profile, preferences, availability } = result.overview;

  const completeness = computeCompleteness({
    preferences,
    availabilityCount: availability.length,
  });

  // The next window to come round in the week, for a player who has several.
  // Purely a display convenience: it is the first row in the already-sorted
  // list, not a computation about the current time, which would differ between
  // the server render and the reader's clock.
  const firstWindow = availability[0];

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold">{profile.display_name}</h1>
          <p className="text-sm text-neutral-600">{profile.bgmi_ign}</p>
        </div>
        <SignOutForm />
      </header>

      <CompletenessCard completeness={completeness} />

      <div className="grid gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="profile-summary"
          className="rounded border border-neutral-200 p-4"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="profile-summary" className="text-sm font-semibold">
              Profile
            </h2>
            <Link href="/profile" className="text-xs underline">
              Edit
            </Link>
          </div>

          <dl className="mt-2 text-sm">
            <Row
              label="Region"
              value={
                profile.region ?? (
                  <span className="text-neutral-500">Not set</span>
                )
              }
            />
            <Row
              label="Bio"
              value={
                profile.bio ? (
                  'Set'
                ) : (
                  <span className="text-neutral-500">Not set</span>
                )
              }
            />
            <Row
              label="Public page"
              value={
                <Link href={`/players/${profile.id}`} className="underline">
                  View
                </Link>
              }
            />
          </dl>
        </section>

        <section
          aria-labelledby="preferences-summary"
          className="rounded border border-neutral-200 p-4"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="preferences-summary" className="text-sm font-semibold">
              Preferences
            </h2>
            <Link href="/profile" className="text-xs underline">
              {preferences ? 'Edit' : 'Set up'}
            </Link>
          </div>

          {preferences ? (
            <dl className="mt-2 text-sm">
              <Row
                label="Primary role"
                value={ROLE_LABELS[preferences.primary_role]}
              />
              <Row
                label="Secondary role"
                value={
                  preferences.secondary_role ? (
                    ROLE_LABELS[preferences.secondary_role]
                  ) : (
                    // "None" rather than "Flex": 0001 is explicit that NULL
                    // means no second role, which is not the flex competence.
                    <span className="text-neutral-500">None</span>
                  )
                }
              />
              <Row
                label="Comms"
                value={COMM_LABELS[preferences.comm_preference]}
              />
              <Row
                label="Skill band"
                value={`${preferences.min_teammate_skill}–${preferences.max_teammate_skill}`}
              />
              <Row
                label="Languages"
                value={preferences.languages.join(', ')}
              />
              <Row
                label="Max ping"
                value={
                  preferences.max_ping_ms === null ? (
                    <span className="text-neutral-500">No limit</span>
                  ) : (
                    `${preferences.max_ping_ms} ms`
                  )
                }
              />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">
              Not set up yet. Until they are, the matcher has no role to fill you
              into and no skill band to respect.
            </p>
          )}
        </section>

        <section
          aria-labelledby="availability-summary"
          className="rounded border border-neutral-200 p-4"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="availability-summary" className="text-sm font-semibold">
              Availability
            </h2>
            <Link href="/profile/availability" className="text-xs underline">
              {availability.length > 0 ? 'Edit' : 'Add'}
            </Link>
          </div>

          <dl className="mt-2 text-sm">
            <Row
              label="Windows"
              value={
                availability.length === 1
                  ? '1 window'
                  : `${availability.length} windows`
              }
            />
            {firstWindow ? (
              <Row
                label="First in the week"
                value={`${DAY_NAMES[firstWindow.day_of_week]} ${formatMinutes(
                  firstWindow.start_minute,
                )}–${formatMinutes(firstWindow.end_minute)}`}
              />
            ) : null}
          </dl>

          {availability.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">
              No windows yet, so there are no hours to overlap with anyone.
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="roster-summary"
          className="rounded border border-neutral-200 p-4"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="roster-summary" className="text-sm font-semibold">
              Players
            </h2>
            <Link href="/players" className="text-xs underline">
              Browse
            </Link>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            Everyone signed up so far. Queueing and squad recommendations arrive
            in a later phase.
          </p>
        </section>
      </div>
    </main>
  );
}
