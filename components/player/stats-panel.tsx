import { BarChart3 } from 'lucide-react';

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ProgressBar } from '@/components/ui/misc';
import type { PlayerStats } from '@/types/database';

const AXES: { key: keyof PlayerStats; label: string }[] = [
  { key: 'aim_score', label: 'Aim' },
  { key: 'game_sense', label: 'Game sense' },
  { key: 'teamwork_score', label: 'Teamwork' },
  { key: 'clutch_score', label: 'Clutch' },
  { key: 'consistency_score', label: 'Consistency' },
];

/**
 * Read-only view of one player_stats row.
 *
 * Read-only by construction, not by UI choice: 0003 revokes INSERT/UPDATE on
 * player_stats from `authenticated`, so there is no form a player could submit
 * that would change these. They are computed, never entered.
 *
 * `last_computed_at` null means no writer has ever scored this player; the
 * row then holds column defaults (50 across the board), and showing those as a
 * rating would present a default as a measurement. The panel says so instead.
 */
export function PlayerStatsPanel({ stats }: { stats: PlayerStats | null }) {
  if (!stats || stats.last_computed_at === null) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No ratings yet"
        body="Ratings are computed from match results, not entered. They appear here once this player has a scored stats row."
      />
    );
  }

  const figures = [
    { label: 'Overall', value: stats.overall_rating },
    { label: 'K/D', value: Number(stats.kd_ratio).toFixed(2) },
    { label: 'Win rate', value: `${Number(stats.win_rate).toFixed(1)}%` },
    { label: 'Avg damage', value: Math.round(Number(stats.avg_damage)) },
    { label: 'Headshot', value: `${Number(stats.headshot_rate).toFixed(1)}%` },
    { label: 'Matches', value: stats.matches_played },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skill profile</CardTitle>
        <span className="text-xs text-muted">Computed, read-only</span>
      </CardHeader>
      <CardBody className="grid gap-6 md:grid-cols-2">
        <dl className="grid grid-cols-3 gap-3">
          {figures.map((figure) => (
            <div key={figure.label} className="rounded-input border border-border bg-surface-2 p-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted">{figure.label}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular text-fg">{figure.value}</dd>
            </div>
          ))}
        </dl>
        <dl className="space-y-3">
          {AXES.map((axis) => {
            const value = Number(stats[axis.key]);
            return (
              <div key={axis.key}>
                <div className="flex justify-between text-sm">
                  <dt className="text-muted">{axis.label}</dt>
                  <dd className="font-mono tabular text-fg">{value}</dd>
                </div>
                <ProgressBar value={value} label={`${axis.label} ${value} of 100`} tone="data" className="mt-1.5" />
              </div>
            );
          })}
        </dl>
      </CardBody>
    </Card>
  );
}
