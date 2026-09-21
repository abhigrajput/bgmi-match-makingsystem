import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Brain, CheckCircle2, Crown, Ruler } from 'lucide-react';

import { CompleteMatchButton } from '@/components/match/complete-button';
import { FeedbackForm } from '@/components/match/feedback-form';
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ProgressBar,
  RoleBadge,
  ScoreRing,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Match',
};

const COMPONENT_LABELS: Record<string, string> = {
  skill: 'Skill match',
  role: 'Role fit',
  availability: 'Shared hours',
  comm: 'Comms',
  language: 'Language',
  region: 'Region',
  teamwork: 'Teamwork',
};

/**
 * One match: the squad, assigned roles, synergy, reasons, scoring source, and
 * -- once completed -- a feedback form per teammate.
 *
 * Read entirely as the user. A non-participant gets a 404, not a 403: 0003
 * makes other people's matches invisible, and "not found" is also the right
 * thing to tell someone probing match ids.
 */
export default async function MatchPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: match }, { data: me }] = await Promise.all([
    supabase.from('matches').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ]);
  if (!match || !me) notFound();

  const { data: seats } = await supabase
    .from('match_participants')
    .select('profile_id, assigned_role, is_leader')
    .eq('match_id', match.id);
  const ids = (seats ?? []).map((s) => s.profile_id);

  const [profiles, stats, given, tournament] = await Promise.all([
    supabase.from('profiles').select('id, bgmi_ign, display_name, avatar_url').in('id', ids),
    supabase.from('player_stats').select('profile_id, overall_rating').in('profile_id', ids),
    supabase.from('match_feedback').select('ratee_profile_id, rating').eq('match_id', match.id).eq('rater_profile_id', me.id),
    match.tournament_id
      ? supabase.from('tournaments').select('name, slug').eq('id', match.tournament_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const profileBy = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const ratingBy = new Map((stats.data ?? []).map((s) => [s.profile_id, s.overall_rating]));
  const ratedBy = new Map((given.data ?? []).map((f) => [f.ratee_profile_id, f.rating]));

  const components = Object.entries((match.squad_score_components ?? {}) as Record<string, number>).filter(
    ([key]) => key in COMPONENT_LABELS,
  );
  const teammates = (seats ?? []).filter((s) => s.profile_id !== me.id);
  const completed = match.status === 'completed';

  return (
    <div className="space-y-6">
      <Link href="/matches" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        All matches
      </Link>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-5 py-6">
          {match.synergy_score !== null ? <ScoreRing score={match.synergy_score} size={80} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={match.status} />
              {match.scoring_source === 'ml' ? (
                <Badge tone="data">
                  <Brain aria-hidden="true" className="h-3 w-3" />
                  ML scored
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <Ruler aria-hidden="true" className="h-3 w-3" />
                  Rule-based
                </Badge>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
              {tournament.data ? (
                <Link href={`/tournaments/${tournament.data.slug}`} className="hover:text-accent">
                  {tournament.data.name}
                </Link>
              ) : (
                'Casual match'
              )}
            </h1>
            <p className="text-sm text-muted">
              Formed {formatDateTime(match.created_at)}
              {match.ended_at ? ` · completed ${formatDateTime(match.ended_at)}` : ''}
            </p>
          </div>
          {!completed && match.status !== 'abandoned' ? <CompleteMatchButton matchId={match.id} /> : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Squad</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {(seats ?? []).map((seat) => {
              const profile = profileBy.get(seat.profile_id);
              return (
                <li key={seat.profile_id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={profile?.display_name ?? '?'} src={profile?.avatar_url} size="sm" />
                  <Link href={`/players/${seat.profile_id}`} className="min-w-0 flex-1 hover:text-data">
                    <span className="flex items-center gap-1.5 font-mono text-sm text-fg">
                      {profile?.bgmi_ign}
                      {seat.is_leader ? <Crown aria-label="Squad leader" className="h-3.5 w-3.5 text-accent" /> : null}
                      {seat.profile_id === me.id ? <Badge tone="accent">you</Badge> : null}
                    </span>
                    <span className="block text-xs text-muted">{profile?.display_name}</span>
                  </Link>
                  {seat.assigned_role ? <RoleBadge role={seat.assigned_role} size="sm" /> : null}
                  <span className="w-8 text-right font-mono text-sm tabular text-muted">
                    {ratingBy.get(seat.profile_id) ?? '–'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Why this squad</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {match.reasons && match.reasons.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-muted">
                {match.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2">
                    <span aria-hidden="true" className="text-accent">›</span>
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                This match was not formed by the optimizer, so there is no explanation stored for it.
              </p>
            )}
            {components.length > 0 ? (
              <dl className="space-y-2.5">
                {components.map(([key, value]) => (
                  <div key={key}>
                    <div className="flex justify-between text-xs">
                      <dt className="text-muted">{COMPONENT_LABELS[key]}</dt>
                      <dd className="font-mono tabular text-fg">{Math.round(value * 100)}</dd>
                    </div>
                    <ProgressBar value={value * 100} label={`${COMPONENT_LABELS[key]} ${Math.round(value * 100)} of 100`} tone="data" className="mt-1" />
                  </div>
                ))}
              </dl>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Rate your teammates</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Ratings are final once submitted. They are the labels the matchmaking model learns from.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {!completed ? (
            <p className="text-sm text-muted">Feedback opens once the match is marked completed.</p>
          ) : teammates.length === 0 ? (
            <p className="text-sm text-muted">No teammates to rate.</p>
          ) : (
            <ul className="grid gap-6 md:grid-cols-2">
              {teammates.map((seat) => {
                const profile = profileBy.get(seat.profile_id);
                const ign = profile?.bgmi_ign ?? 'teammate';
                const already = ratedBy.get(seat.profile_id);
                return (
                  <li key={seat.profile_id} className="rounded-card border border-border p-4">
                    {already ? (
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" />
                        You rated <span className="font-mono text-fg">{ign}</span> {already}/5.
                      </p>
                    ) : (
                      <FeedbackForm matchId={match.id} rateeId={seat.profile_id} rateeIgn={ign} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
