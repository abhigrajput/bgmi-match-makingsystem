import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Crosshair } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  ScoreRing,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Matches',
};

/**
 * The signed-in player's own matches, newest first.
 *
 * No filter on the player is written here, and none is needed: 0003 only lets
 * a participant SELECT a match, so "all matches" under this JWT IS "my
 * matches". The tournament names come from a second query because the
 * Database type declares no relationships to embed.
 */
export default async function MatchesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, status, synergy_score, scoring_source, tournament_id, created_at, ended_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return <StatePanel title="Could not load your matches" body={error.message} />;

  const tournamentIds = [...new Set((matches ?? []).map((m) => m.tournament_id).filter(Boolean) as string[])];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name, slug').in('id', tournamentIds)
    : { data: [] as { id: string; name: string; slug: string }[] };
  const tournamentBy = new Map((tournaments ?? []).map((t) => [t.id, t]));

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="Matches"
        description="Every squad you have been placed in. Mark a match completed after you play it, then rate your teammates."
      />

      {!matches || matches.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title="No matches yet"
          body="Register for a tournament. When squads are formed, your match appears here."
          action={<ButtonLink href="/tournaments">Browse tournaments</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {matches.map((m) => {
            const tournament = m.tournament_id ? tournamentBy.get(m.tournament_id) : undefined;
            return (
              <li key={m.id}>
                <Link
                  href={`/matches/${m.id}`}
                  className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 transition-colors duration-150 hover:border-border-strong"
                >
                  {m.synergy_score !== null ? (
                    <ScoreRing score={m.synergy_score} size={48} />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-xs text-muted">
                      –
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg">{tournament?.name ?? 'Casual match'}</p>
                    <p className="text-xs text-muted">{formatDateTime(m.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={m.status} />
                    <Badge tone={m.scoring_source === 'ml' ? 'data' : 'neutral'}>
                      {m.scoring_source === 'ml' ? 'ML' : 'Rules'}
                    </Badge>
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
