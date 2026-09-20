import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CompletenessCard } from '@/components/player/completeness-card';
import { computeCompleteness } from '@/lib/player/completeness';
import { loadPlayerOverview } from '@/lib/player/queries';
import { DAY_NAMES, formatMinutes } from '@/lib/player/time';

import { PreferencesForm } from './preferences-form';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = {
  title: 'My profile',
};

/**
 * View and edit your own profile and preferences.
 *
 * A server component: the three reads run on the server with the user's JWT,
 * and the rows arrive already rendered. The only client code on this page is
 * the two forms, which are client components solely because `useFormState`
 * requires it.
 *
 * Availability is summarised here but edited on its own page. Putting a third
 * form on this one would mean three independent submit buttons whose scopes a
 * player has to infer, and the availability editor needs a row-level remove
 * control that does not fit the same shape.
 */
export default async function ProfilePage() {
  const result = await loadPlayerOverview();

  if (result.status === 'unauthenticated') {
    // The middleware normally redirects before this renders. It is repeated
    // because middleware runs on an editable matcher and a Server Component is
    // rendered by the framework, not by the middleware -- the two are not
    // actually coupled.
    redirect('/login');
  }

  if (result.status === 'no-profile') {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">No profile row for this account</h1>
        <p>auth_user_id: {result.authUserId}</p>
        <p className="text-neutral-700">
          handle_new_user() should have created one at signup. Check that the
          on_auth_user_created trigger still exists on auth.users
          (supabase/migrations/0002_triggers.sql).
        </p>
      </main>
    );
  }

  if (result.status === 'error') {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Could not load your profile</h1>
        <p className="text-red-800">{result.message}</p>
      </main>
    );
  }

  const { profile, preferences, availability } = result.overview;

  const completeness = computeCompleteness({
    preferences,
    availabilityCount: availability.length,
  });

  return (
    <main className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold">My profile</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Everything here is yours to edit. Your skill ratings are not — they are
          computed from match results, not entered.
        </p>
      </div>

      <CompletenessCard completeness={completeness} />

      <section aria-labelledby="profile-heading" className="space-y-4">
        <div>
          <h2 id="profile-heading" className="text-base font-semibold">
            Profile
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Visible to every signed-in player on{' '}
            <Link href={`/players/${profile.id}`} className="underline">
              your public page
            </Link>
            .
          </p>
        </div>
        <ProfileForm profile={profile} />
      </section>

      <section aria-labelledby="preferences-heading" className="space-y-4">
        <div>
          <h2 id="preferences-heading" className="text-base font-semibold">
            Preferences
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Private to you. Other players cannot read your preferences — a
            visible skill band could be used to steer who you get matched with.
          </p>
        </div>
        <PreferencesForm preferences={preferences} />
      </section>

      <section aria-labelledby="availability-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="availability-heading" className="text-base font-semibold">
            Availability
          </h2>
          <Link href="/profile/availability" className="text-sm underline">
            Edit windows
          </Link>
        </div>

        {availability.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No windows yet. Add at least one so there are hours to overlap with
            other players.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {availability.map((window) => (
              <li key={window.id}>
                <span className="font-medium">
                  {DAY_NAMES[window.day_of_week]}
                </span>{' '}
                {formatMinutes(window.start_minute)}–
                {formatMinutes(window.end_minute)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
