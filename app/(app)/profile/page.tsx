import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock, ExternalLink } from 'lucide-react';

import { CompletenessCard } from '@/components/player/completeness-card';
import { PlayerStatsPanel } from '@/components/player/stats-panel';
import { StatePanel } from '@/components/shell/state-panel';
import {
  Avatar,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@/components/ui';
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
 * A server component: the reads run on the server with the user's JWT, and the
 * rows arrive already rendered. The only client code on this page is the two
 * forms, which are client components solely because `useFormState` requires
 * it.
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
      <StatePanel
        title="No profile row for this account"
        body={`handle_new_user() should have created one at signup (auth_user_id ${result.authUserId}). Check that the on_auth_user_created trigger still exists on auth.users -- supabase/migrations/0002_triggers.sql.`}
      />
    );
  }

  if (result.status === 'error') {
    return <StatePanel title="Could not load your profile" body={result.message} />;
  }

  const { profile, preferences, availability, stats } = result.overview;

  const completeness = computeCompleteness({
    preferences,
    availabilityCount: availability.length,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Profile"
        title={
          <span className="flex items-center gap-3">
            <Avatar name={profile.display_name} src={profile.avatar_url} size="lg" />
            <span>
              {profile.display_name}
              <span className="block font-mono text-sm font-normal text-muted">
                {profile.bgmi_ign}
              </span>
            </span>
          </span>
        }
        actions={
          <ButtonLink href={`/players/${profile.id}`} variant="secondary" size="sm">
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            Public page
          </ButtonLink>
        }
      />

      <CompletenessCard completeness={completeness} />

      <PlayerStatsPanel stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Profile</CardTitle>
              <p className="mt-1 text-xs text-muted">
                Visible to every signed-in player.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <ProfileForm profile={profile} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Preferences</CardTitle>
              <p className="mt-1 text-xs text-muted">
                Private to you. A visible skill band could be used to steer who
                you get matched with.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <PreferencesForm preferences={preferences} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <Link
            href="/profile/availability"
            className="text-sm font-medium text-data hover:underline"
          >
            Edit windows
          </Link>
        </CardHeader>
        <CardBody>
          {availability.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No windows yet"
              body="Add at least one weekly window so there are hours to overlap with other players."
              action={
                <ButtonLink href="/profile/availability" size="sm">
                  Add a window
                </ButtonLink>
              }
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {availability.map((window) => (
                <li
                  key={window.id}
                  className="rounded-input border border-border bg-surface-2 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-fg">
                    {DAY_NAMES[window.day_of_week].slice(0, 3)}
                  </span>{' '}
                  <span className="font-mono tabular text-muted">
                    {formatMinutes(window.start_minute)}–
                    {formatMinutes(window.end_minute)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
