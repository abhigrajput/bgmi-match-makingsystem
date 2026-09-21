import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BarChart3, Brain, MessageSquareQuote, Sparkles, Swords, Trophy, Users } from 'lucide-react';

import { DistributionBars, RoleDonut } from '@/components/charts/analytics-charts';
import { ComparisonCharts } from '@/components/charts/comparison-charts';
import { StatePanel } from '@/components/shell/state-panel';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { Comparison } from '@/lib/scoring/evaluate';
import { createClient } from '@/lib/supabase/server';
import { PLAYER_ROLES, type PlayerRole } from '@/types/database';

export const metadata: Metadata = {
  title: 'Analytics',
};

type Overview = {
  players: number;
  tournaments: number;
  squads: number;
  tournament_squads: number;
  feedback: number;
  avg_synergy: number | null;
  ml_share: number | null;
  rating_histogram: { bucket: number; count: number }[];
  role_distribution: { role: PlayerRole; count: number }[];
  feedback_distribution: { rating: number; count: number }[];
  formations: { name: string; slug: string; formed_at: string; comparison: Comparison | null }[];
};

type MetricBlock = { accuracy: number; precision: number; recall: number; f1: number; auc: number };

/**
 * Platform-wide numbers, every one read from the database on this request.
 *
 * The aggregates come from analytics_overview(), a definer function that
 * returns counts and averages only: pages run as the user and cannot see
 * other players' matches, and the service role is not allowed in pages.
 * Model metrics come from the active model_versions row, which
 * scripts/train.ts wrote from its own test-set evaluation.
 */
export default async function AnalyticsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data, error }, { data: model }] = await Promise.all([
    supabase.rpc('analytics_overview'),
    supabase
      .from('model_versions')
      .select('version, algorithm, trained_at, n_train, n_test, metrics, baselines')
      .eq('is_active', true)
      .maybeSingle(),
  ]);
  if (error || !data) {
    return <StatePanel title="Could not load analytics" body={error?.message ?? 'No data returned.'} />;
  }
  const o = data as unknown as Overview;

  const histogram = Array.from({ length: 10 }, (_, i) => ({
    // Band start only: ten '40–49' style labels collide at card width.
    label: String(i * 10),
    count: o.rating_histogram.find((b) => b.bucket === i + 1)?.count ?? 0,
  }));
  const roles = PLAYER_ROLES.map((role) => ({
    role,
    count: o.role_distribution.find((r) => r.role === role)?.count ?? 0,
  }));
  const feedback = [1, 2, 3, 4, 5].map((rating) => ({
    label: `${rating}★`,
    count: o.feedback_distribution.find((f) => f.rating === rating)?.count ?? 0,
  }));
  const latest = o.formations.find((f) => f.comparison);

  const metrics = model?.metrics as (MetricBlock & { cv?: { f1: { mean: number; std: number }; auc: { mean: number; std: number } } }) | null;
  const baselines = model?.baselines as Record<string, MetricBlock> | null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Live platform numbers, the latest squad formation against its rank-only baseline, and the active model's held-out metrics."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Players" value={o.players.toLocaleString('en-IN')} icon={Users} />
        <StatCard label="Tournaments" value={o.tournaments} icon={Trophy} />
        <StatCard label="Squads" value={o.squads.toLocaleString('en-IN')} icon={Swords} hint={`${o.tournament_squads} from tournaments`} />
        <StatCard label="Feedback" value={o.feedback.toLocaleString('en-IN')} icon={MessageSquareQuote} />
        <StatCard
          label="Avg synergy"
          value={o.avg_synergy !== null ? Number(o.avg_synergy).toFixed(1) : '–'}
          icon={Sparkles}
          hint="Optimizer-formed squads"
        />
        <StatCard
          label="ML share"
          value={o.ml_share !== null ? `${(Number(o.ml_share) * 100).toFixed(0)}%` : '–'}
          icon={Brain}
          hint="Of tournament squads"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rating distribution</CardTitle>
          </CardHeader>
          <CardBody>
            <DistributionBars data={histogram} unit="players" xLabel="Overall rating, 10-point bands (90 includes 100)" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Primary roles</CardTitle>
          </CardHeader>
          <CardBody>
            <RoleDonut data={roles} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Feedback ratings</CardTitle>
          </CardHeader>
          <CardBody>
            <DistributionBars data={feedback} unit="ratings" xLabel="Teammate rating given" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active model</CardTitle>
            {model ? <span className="font-mono text-xs text-muted">{model.version}</span> : null}
          </CardHeader>
          <CardBody>
            {model && metrics ? (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Logistic regression trained {formatDateTime(model.trained_at)} on {model.n_train} pairs, evaluated on{' '}
                  {model.n_test} held-out pairs from matches it never saw.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Held-out test metrics, model against baselines</caption>
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th scope="col" className="py-1.5 text-left font-medium">Scorer</th>
                        <th scope="col" className="py-1.5 text-right font-medium">Acc</th>
                        <th scope="col" className="py-1.5 text-right font-medium">F1</th>
                        <th scope="col" className="py-1.5 text-right font-medium">AUC</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular">
                      {[
                        ['Model', metrics],
                        ['Rule-based', baselines?.rule_based],
                        ['Rank-only', baselines?.rank_only],
                        ['Majority', baselines?.majority],
                      ].map(([name, m]) =>
                        m ? (
                          <tr key={name as string} className="border-t border-border">
                            <th scope="row" className="py-1.5 text-left font-sans font-normal text-fg">{name as string}</th>
                            <td className="py-1.5 text-right">{(m as MetricBlock).accuracy.toFixed(3)}</td>
                            <td className="py-1.5 text-right">{(m as MetricBlock).f1.toFixed(3)}</td>
                            <td className="py-1.5 text-right">{(m as MetricBlock).auc.toFixed(3)}</td>
                          </tr>
                        ) : null,
                      )}
                    </tbody>
                  </table>
                </div>
                {metrics.cv ? (
                  <p className="text-xs text-muted">
                    5-fold CV: F1 {metrics.cv.f1.mean.toFixed(3)} ± {metrics.cv.f1.std.toFixed(3)}, AUC{' '}
                    {metrics.cv.auc.mean.toFixed(3)} ± {metrics.cv.auc.std.toFixed(3)}.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState icon={Brain} title="No active model" body="Run scripts/train.ts to train and activate one." />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Optimizer vs rank-only</CardTitle>
            {latest ? (
              <p className="mt-1 text-xs text-muted">
                Latest formation:{' '}
                <Link href={`/tournaments/${latest.slug}`} className="text-data hover:underline">
                  {latest.name}
                </Link>
                , {formatDateTime(latest.formed_at)}
              </p>
            ) : null}
          </div>
        </CardHeader>
        <CardBody>
          {latest?.comparison ? (
            <ComparisonCharts comparison={latest.comparison} />
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No squads formed yet"
              body="Form squads in a tournament to compare the optimizer with rank-only grouping."
              action={
                <Link href="/tournaments" className="text-sm font-medium text-data hover:underline">
                  Go to tournaments
                </Link>
              }
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
