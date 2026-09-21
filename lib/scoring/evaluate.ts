/**
 * Side-by-side metrics for two groupings of the same pool.
 *
 * Both groupings are measured with the SAME squad score and the same pair
 * scorer, so the comparison is about how players were grouped and nothing
 * else. A vetoed pair scores 0 inside squadScore, and is also counted
 * separately, because "this squad contains two people who cannot play
 * together" is worth stating plainly rather than leaving buried in an average.
 */

import { isHardIncompatible } from './compatibility';
import { assignRoles, makePairCache, roleCoverage, squadScore } from './squad';
import type { PairScorer, PlayerVector } from './types';

export type GroupingMetrics = {
  squads: number;
  /** Mean squadScore across squads, 0..~1.1. */
  meanSquadScore: number;
  /** Pairs placed together despite a hard veto. */
  vetoedPairs: number;
  /** Mean distinct specialist roles per squad, divided by squad size. */
  roleCoverage: number;
  /** Mean (max - min) overall rating within a squad. */
  meanRatingSpread: number;
};

export type Comparison = {
  optimizer: GroupingMetrics;
  baseline: GroupingMetrics;
};

export function measure(
  groups: PlayerVector[][],
  scorer: PairScorer,
): GroupingMetrics {
  const score = makePairCache(scorer);
  if (groups.length === 0) {
    return { squads: 0, meanSquadScore: 0, vetoedPairs: 0, roleCoverage: 0, meanRatingSpread: 0 };
  }

  let total = 0;
  let vetoed = 0;
  let coverage = 0;
  let spread = 0;

  for (const group of groups) {
    const members = assignRoles(group);
    total += squadScore(members, score);
    coverage += roleCoverage(members) / Math.min(group.length, 4);
    const ratings = group.map((p) => p.overallRating);
    spread += Math.max(...ratings) - Math.min(...ratings);
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (isHardIncompatible(group[i]!, group[j]!).vetoed) vetoed++;
      }
    }
  }

  return {
    squads: groups.length,
    meanSquadScore: total / groups.length,
    vetoedPairs: vetoed,
    roleCoverage: coverage / groups.length,
    meanRatingSpread: spread / groups.length,
  };
}

export function compare(
  optimizerGroups: PlayerVector[][],
  baselineGroups: PlayerVector[][],
  scorer: PairScorer,
): Comparison {
  return {
    optimizer: measure(optimizerGroups, scorer),
    baseline: measure(baselineGroups, scorer),
  };
}
