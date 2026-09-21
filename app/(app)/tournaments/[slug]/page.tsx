import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CalendarDays, MapPin, Users } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import { StatusBadge } from '@/components/ui';
import { TournamentWorkspace, type PlayerRow } from '@/components/tournament/workspace';
import { formatDateTime } from '@/lib/format';
import { computeCompleteness } from '@/lib/player/completeness';
import { isFormationSummary } from '@/lib/scoring/formation';
import { createClient } from '@/lib/supabase/server';

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const supabase = createClient();
  const { data } = await supabase.from('tournaments').select('name').eq('slug', params.slug).maybeSingle();
  return { title: data?.name ?? 'Tournament' };
}

/**
 * One tournament. The server half reads everything a signed-in player may see
 * under RLS -- the tournament, who registered, each registrant's public
 * leaderboard row, and the caller's own registration and completeness -- and
 * hands it to the client workspace. Nothing here uses the service role.
 */
export default async function TournamentPage({ params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('slug', params.slug)
    .maybeSingle();
  if (error) return <StatePanel title="Could not load this tournament" body={error.message} />;
  if (!tournament) notFound();

  const [{ data: me }, { data: registrations, error: regError }] = await Promise.all([
    supabase.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle(),
    supabase
      .from('tournament_registrations')
      .select('profile_id, desired_role, registered_at')
      .eq('tournament_id', tournament.id)
      .order('registered_at', { ascending: true }),
  ]);
  if (regError) return <StatePanel title="Could not load registrations" body={regError.message} />;

  const ids = (registrations ?? []).map((r) => r.profile_id);
  const [profiles, board, myPrefs, myWindows] = await Promise.all([
    ids.length
      ? supabase.from('profiles').select('id, bgmi_ign, display_name, avatar_url, region').in('id', ids)
      : Promise.resolve({ data: [] as { id: string; bgmi_ign: string; display_name: string; avatar_url: string | null; region: string | null }[] }),
    // leaderboard_v is the only view of other players' primary roles (0005).
    ids.length
      ? supabase.from('leaderboard_v').select('profile_id, primary_role, overall_rating').in('profile_id', ids)
      : Promise.resolve({ data: [] as { profile_id: string; primary_role: null; overall_rating: null }[] }),
    me ? supabase.from('player_preferences').select('id').eq('profile_id', me.id).maybeSingle() : Promise.resolve({ data: null }),
    me
      ? supabase.from('player_availability').select('id', { count: 'exact', head: true }).eq('profile_id', me.id)
      : Promise.resolve({ count: 0 }),
  ]);

  const profileBy = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const boardBy = new Map((board.data ?? []).map((b) => [b.profile_id, b]));

  const players: PlayerRow[] = (registrations ?? []).flatMap((r) => {
    const profile = profileBy.get(r.profile_id);
    if (!profile) return [];
    const row = boardBy.get(r.profile_id);
    return [
      {
        profile_id: r.profile_id,
        ign: profile.bgmi_ign,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        region: profile.region,
        role: r.desired_role ?? row?.primary_role ?? null,
        rating: row?.overall_rating ?? null,
      },
    ];
  });

  const mine = (registrations ?? []).find((r) => r.profile_id === me?.id);
  const complete = computeCompleteness({
    preferences: myPrefs.data,
    availabilityCount: ('count' in myWindows ? myWindows.count : 0) ?? 0,
  }).readyToMatch;

  return (
    <div className="space-y-6">
      <Link href="/tournaments" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        All tournaments
      </Link>

      <header className="relative overflow-hidden rounded-card border border-border bg-surface p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 bg-[radial-gradient(ellipse_at_center,rgb(var(--accent)/0.14),transparent_65%)]"
        />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={tournament.status} />
            {tournament.is_seed ? (
              <span className="text-xs text-muted">Demo tournament</span>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg">{tournament.name}</h1>
          {tournament.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">{tournament.description}</p>
          ) : null}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Starts</dt>
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              <dd>{formatDateTime(tournament.starts_at)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Format</dt>
              <Users aria-hidden="true" className="h-4 w-4" />
              <dd>{tournament.squad_size === 2 ? 'Duos' : `Squads of ${tournament.squad_size}`}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Region</dt>
              <MapPin aria-hidden="true" className="h-4 w-4" />
              <dd>{tournament.region ?? 'Any region'}</dd>
            </div>
            {tournament.registration_closes_at ? (
              <div>
                <dt className="inline">Registration closes </dt>
                <dd className="inline">{formatDateTime(tournament.registration_closes_at)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </header>

      <TournamentWorkspace
        slug={tournament.slug}
        status={tournament.status}
        squadSize={tournament.squad_size}
        isSeed={tournament.is_seed}
        players={players}
        summary={isFormationSummary(tournament.formation_summary) ? tournament.formation_summary : null}
        me={{
          profileId: me?.id ?? null,
          registered: Boolean(mine),
          desiredRole: mine?.desired_role ?? null,
          profileComplete: complete,
        }}
      />
    </div>
  );
}
