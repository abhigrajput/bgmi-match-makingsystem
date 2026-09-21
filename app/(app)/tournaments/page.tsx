import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, CheckCircle2, MapPin, Swords, Users } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import {
  Badge,
  EmptyState,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { TOURNAMENT_STATUSES, type TournamentStatus } from '@/types/database';

export const metadata: Metadata = {
  title: 'Tournaments',
};

const FILTERS: { value: TournamentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'matched', label: 'Squads formed' },
  { value: 'completed', label: 'Completed' },
];

/**
 * Every tournament the signed-in player can see, as cards.
 *
 * Runs as the user: tournaments and registrations are both readable by any
 * signed-in player under 0005, so nothing here needs the service role.
 * Registration counts are per-tournament HEAD counts rather than a fetch of
 * every registration row, which would hit PostgREST's default row cap long
 * before the list got interesting.
 */
export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filter = TOURNAMENT_STATUSES.includes(searchParams.status as TournamentStatus)
    ? (searchParams.status as TournamentStatus)
    : 'all';

  let query = supabase
    .from('tournaments')
    .select('id, slug, name, status, starts_at, squad_size, region, is_seed')
    .neq('status', 'draft')
    .order('starts_at', { ascending: true });
  if (filter !== 'all') query = query.eq('status', filter);

  const [{ data: tournaments, error }, { data: me }] = await Promise.all([
    query,
    supabase.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ]);

  if (error) {
    return <StatePanel title="Could not load tournaments" body={error.message} />;
  }

  const list = tournaments ?? [];
  const [counts, mine] = await Promise.all([
    Promise.all(
      list.map((t) =>
        supabase
          .from('tournament_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', t.id)
          .then((r) => [t.id, r.count ?? 0] as const),
      ),
    ),
    me
      ? supabase.from('tournament_registrations').select('tournament_id').eq('profile_id', me.id)
      : Promise.resolve({ data: [] as { tournament_id: string }[] }),
  ]);
  const countBy = new Map(counts);
  const myTournaments = new Set((mine.data ?? []).map((r) => r.tournament_id));
  const busiest = Math.max(1, ...counts.map(([, n]) => n));

  return (
    <div>
      <PageHeader
        eyebrow="Compete"
        title="Tournaments"
        description="Register for an open tournament. When squads are formed, you are placed with players whose skill, roles, comms, languages and hours fit yours."
      />

      <nav aria-label="Filter by status" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <Link
              key={f.value}
              href={f.value === 'all' ? '/tournaments' : `/tournaments?status=${f.value}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors duration-150',
                active
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-border text-muted hover:border-border-strong hover:text-fg',
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {list.length === 0 ? (
        <EmptyState
          icon={Swords}
          title={filter === 'all' ? 'No tournaments yet' : 'Nothing matches this filter'}
          body={
            filter === 'all'
              ? 'Tournaments appear here as soon as one is scheduled.'
              : 'Try another status, or view every tournament.'
          }
          action={
            filter === 'all' ? undefined : (
              <Link href="/tournaments" className="text-sm font-medium text-data hover:underline">
                Show all tournaments
              </Link>
            )
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const registered = countBy.get(t.id) ?? 0;
            const joined = myTournaments.has(t.id);
            return (
              <li key={t.id}>
                <Link
                  href={`/tournaments/${t.slug}`}
                  className="group flex h-full flex-col rounded-card border border-border bg-surface p-5 transition-colors duration-150 hover:border-border-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <StatusBadge status={t.status} />
                    {joined ? (
                      <Badge tone="accent">
                        <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                        You&apos;re in
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-fg group-hover:text-accent">
                    {t.name}
                  </h2>
                  <dl className="mt-3 space-y-1.5 text-sm text-muted">
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Starts</dt>
                      <CalendarDays aria-hidden="true" className="h-4 w-4" />
                      <dd>{formatDateTime(t.starts_at)}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Format</dt>
                      <Users aria-hidden="true" className="h-4 w-4" />
                      <dd>{t.squad_size === 2 ? 'Duos' : `Squads of ${t.squad_size}`}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Region</dt>
                      <MapPin aria-hidden="true" className="h-4 w-4" />
                      <dd>{t.region ?? 'Any region'}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto pt-5">
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-muted">
                        <span className="font-mono tabular text-fg">{registered}</span> registered
                      </span>
                      <span className="text-muted">
                        enough for{' '}
                        <span className="font-mono tabular text-fg">
                          {Math.floor(registered / t.squad_size)}
                        </span>{' '}
                        {t.squad_size === 2 ? 'duos' : 'squads'}
                      </span>
                    </div>
                    <ProgressBar
                      value={registered}
                      max={busiest}
                      label={`${registered} registered, relative to the busiest tournament listed`}
                      tone="data"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
