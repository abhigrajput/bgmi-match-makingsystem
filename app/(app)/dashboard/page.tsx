import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CalendarDays, Crosshair, Gauge, Swords, Trophy } from 'lucide-react';

import { CompletenessCard } from '@/components/player/completeness-card';
import { StatePanel } from '@/components/shell/state-panel';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  RoleBadge,
  ScoreRing,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { computeCompleteness } from '@/lib/player/completeness';
import { loadPlayerOverview } from '@/lib/player/queries';
import { DAY_NAMES, formatMinutes } from '@/lib/player/time';
import { createClient } from '@/lib/supabase/server';
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

  const { profile, preferences, availability, stats } = result.overview;

  // Three more reads for the panels below, all as the user. Matches need no
  // player filter: 0003 already limits them to ones this player sat in.
  const supabase = createClient();
  const [upcoming, myRegs, recent, matchCount] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, slug, name, starts_at, squad_size, status')
      .eq('status', 'open')
      .order('starts_at', { ascending: true })
      .limit(3),
    supabase.from('tournament_registrations').select('tournament_id').eq('profile_id', profile.id),
    supabase
      .from('matches')
      .select('id, status, synergy_score, tournament_id, created_at')
      .order('created_at', { ascending: false })
      .limit(3),
    supabase.from('matches').select('id', { count: 'exact', head: true }),
  ]);
  const joined = new Set((myRegs.data ?? []).map((r) => r.tournament_id));
  const tournamentNames = new Map((upcoming.data ?? []).map((t) => [t.id, t.name]));
  const missingNames = (recent.data ?? [])
    .map((m) => m.tournament_id)
    .filter((id): id is string => !!id && !tournamentNames.has(id));
  if (missingNames.length > 0) {
    const { data } = await supabase.from('tournaments').select('id, name').in('id', missingNames);
    for (const t of data ?? []) tournamentNames.set(t.id, t.name);
  }
  const scored = stats && stats.last_computed_at !== null;

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Rating" value={scored ? stats!.overall_rating : '–'} icon={Gauge} hint={scored ? 'Computed from match history' : 'Not rated yet'} />
        <StatCard label="Squads" value={matchCount.count ?? 0} icon={Crosshair} hint="Squads you were placed in" />
        <StatCard label="Win rate" value={scored ? `${Number(stats!.win_rate).toFixed(1)}%` : '–'} icon={Trophy} />
        <StatCard label="Tournaments joined" value={joined.size} icon={Swords} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming tournaments</CardTitle>
            <Link href="/tournaments" className="text-xs font-medium text-data hover:underline">
              All
            </Link>
          </CardHeader>
          {(upcoming.data ?? []).length === 0 ? (
            <CardBody>
              <EmptyState icon={Swords} title="No open tournaments" body="New tournaments appear here as soon as registration opens." />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {(upcoming.data ?? []).map((t) => (
                <li key={t.id}>
                  <Link href={`/tournaments/${t.slug}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-surface-2/60">
                    <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{t.name}</span>
                      <span className="block text-xs text-muted">{formatDateTime(t.starts_at)}</span>
                    </span>
                    {joined.has(t.id) ? <Badge tone="accent">You&apos;re in</Badge> : <Badge tone="success">Open</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My recent matches</CardTitle>
            <Link href="/matches" className="text-xs font-medium text-data hover:underline">
              All
            </Link>
          </CardHeader>
          {(recent.data ?? []).length === 0 ? (
            <CardBody>
              <EmptyState
                icon={Crosshair}
                title="No matches yet"
                body="Register for a tournament; your squad shows up here once it is formed."
                action={<ButtonLink href="/tournaments" size="sm">Find a tournament</ButtonLink>}
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {(recent.data ?? []).map((m) => (
                <li key={m.id}>
                  <Link href={`/matches/${m.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-surface-2/60">
                    {m.synergy_score !== null ? <ScoreRing score={m.synergy_score} size={40} /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {(m.tournament_id && tournamentNames.get(m.tournament_id)) || 'Casual match'}
                      </span>
                      <span className="block text-xs text-muted">{formatDateTime(m.created_at)}</span>
                    </span>
                    <StatusBadge status={m.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

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
