import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CompletenessCard } from '@/components/player/completeness-card';
import { StatePanel } from '@/components/shell/state-panel';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  RoleBadge,
} from '@/components/ui';
import { computeCompleteness } from '@/lib/player/completeness';
import { loadPlayerOverview } from '@/lib/player/queries';
import { DAY_NAMES, formatMinutes } from '@/lib/player/time';
import type { CommPreference } from '@/types/database';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * The signed-in landing page: who you are, what you have declared, and what is
 * still missing before squad formation can use any of it.
 *
 * A server component. Every read runs with the user's JWT under RLS, and the
 * queries are shared with /profile via lib/player/queries so the two pages
 * cannot disagree about whether you are ready to be matched.
 */

const COMM_LABELS: Record<CommPreference, string> = {
  voice_required: 'Voice required',
  voice_optional: 'Voice optional',
  text_only: 'Text only',
  silent: 'Silent',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
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
     */
    return (
      <StatePanel
        title="No profile row for this account"
        body={`auth_user_id ${result.authUserId}. Check that the on_auth_user_created trigger exists on auth.users (supabase/migrations/0002_triggers.sql).`}
      />
    );
  }

  if (result.status === 'error') {
    return <StatePanel title="Could not load your dashboard" body={result.message} />;
  }

  const { profile, preferences, availability } = result.overview;

  const completeness = computeCompleteness({
    preferences,
    availabilityCount: availability.length,
  });

  // The first window in the week, for a player who has several. Purely a
  // display convenience: it is the first row in the already-sorted list, not
  // a computation about the current time, which would differ between the
  // server render and the reader's clock.
  const firstWindow = availability[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${profile.display_name}`}
        description={
          <span className="font-mono">{profile.bgmi_ign}</span>
        }
      />

      <CompletenessCard completeness={completeness} />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <Link href="/profile" className="text-xs font-medium text-data hover:underline">
              Edit
            </Link>
          </CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Row label="Region" value={profile.region ?? <span className="text-muted">Not set</span>} />
              <Row label="Bio" value={profile.bio ? 'Set' : <span className="text-muted">Not set</span>} />
              <Row
                label="Public page"
                value={
                  <Link href={`/players/${profile.id}`} className="text-data hover:underline">
                    View
                  </Link>
                }
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <Link href="/profile" className="text-xs font-medium text-data hover:underline">
              {preferences ? 'Edit' : 'Set up'}
            </Link>
          </CardHeader>
          <CardBody>
            {preferences ? (
              <dl className="text-sm">
                <Row label="Primary role" value={<RoleBadge role={preferences.primary_role} />} />
                <Row
                  label="Secondary"
                  value={
                    preferences.secondary_role ? (
                      <RoleBadge role={preferences.secondary_role} />
                    ) : (
                      // "None" rather than "Flex": 0001 is explicit that NULL
                      // means no second role, which is not the flex competence.
                      <span className="text-muted">None</span>
                    )
                  }
                />
                <Row label="Comms" value={COMM_LABELS[preferences.comm_preference]} />
                <Row
                  label="Skill band"
                  value={
                    <span className="font-mono tabular">
                      {preferences.min_teammate_skill}–{preferences.max_teammate_skill}
                    </span>
                  }
                />
                <Row label="Languages" value={preferences.languages.join(', ')} />
              </dl>
            ) : (
              <p className="text-sm text-muted">
                Not set up yet. Until they are, squad formation has no role to
                fill you into and no skill band to respect.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <Link href="/profile/availability" className="text-xs font-medium text-data hover:underline">
              {availability.length > 0 ? 'Edit' : 'Add'}
            </Link>
          </CardHeader>
          <CardBody>
            <dl className="text-sm">
              <Row
                label="Windows"
                value={<span className="font-mono tabular">{availability.length}</span>}
              />
              {firstWindow ? (
                <Row
                  label="First in the week"
                  value={
                    <span className="font-mono tabular">
                      {DAY_NAMES[firstWindow.day_of_week].slice(0, 3)}{' '}
                      {formatMinutes(firstWindow.start_minute)}–
                      {formatMinutes(firstWindow.end_minute)}
                    </span>
                  }
                />
              ) : null}
            </dl>
            {availability.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No windows yet, so there are no hours to overlap with anyone.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
