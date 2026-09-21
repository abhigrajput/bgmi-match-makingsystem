/**
 * One squad-formation run, end to end but still pure: vectors in, squads,
 * baseline comparison and a persistable summary out. The API route wraps this
 * with database reads and writes; the tests call it directly.
 */

import { rankOnlySquads } from './baseline';
import { compare, type Comparison } from './evaluate';
import { activeScorer } from './model';
import { formSquads, type Squad } from './squad';
import type { PairScorer, PlayerVector } from './types';

export type UnmatchedSummary = {
  profile_id: string;
  ign: string;
  display_name: string;
  reason: string;
};

/**
 * Stored on tournaments.formation_summary. Everything the Comparison tab and
 * /analytics show about a formation after the fact comes from here, so it is
 * a record of what happened rather than a recomputation on today's data.
 */
export type FormationSummary = {
  formed_at: string;
  scoring_source: 'ml' | 'rule_based';
  model_version: string | null;
  players: number;
  squads: number;
  baseline_squads: number;
  comparison: Comparison;
  unmatched: UnmatchedSummary[];
};

export type FormationRun = {
  squads: Squad[];
  summary: FormationSummary;
};

export function runFormation(
  players: PlayerVector[],
  squadSize: number,
  options: { scorer?: PairScorer; source?: 'ml' | 'rule_based'; version?: string | null; now?: Date } = {},
): FormationRun {
  const active = options.scorer
    ? { scorer: options.scorer, source: options.source ?? 'rule_based', version: options.version ?? null }
    : activeScorer();

  const result = formSquads(players, squadSize, active.scorer);
  const baseline = rankOnlySquads(players, squadSize);
  const comparison = compare(
    result.squads.map((s) => s.members),
    baseline.groups,
    active.scorer,
  );

  return {
    squads: result.squads,
    summary: {
      formed_at: (options.now ?? new Date()).toISOString(),
      scoring_source: active.source,
      model_version: active.version,
      players: players.length,
      squads: result.squads.length,
      baseline_squads: baseline.groups.length,
      comparison,
      unmatched: result.unmatched.map((u) => ({
        profile_id: u.player.profileId,
        ign: u.player.ign,
        display_name: u.player.displayName,
        reason: u.reason,
      })),
    },
  };
}

/** 0..1 squad score -> the 0-100 smallint matches.synergy_score holds. */
export function toSynergyScore(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

/** Type guard for summaries read back out of jsonb. */
export function isFormationSummary(value: unknown): value is FormationSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<FormationSummary>;
  return (
    typeof v.formed_at === 'string' &&
    !!v.comparison &&
    typeof v.comparison === 'object' &&
    Array.isArray(v.unmatched)
  );
}
