/**
 * Model features for a pair: the seven Phase C component scores, computed from
 * OBSERVABLE player data, plus the raw absolute rating gap.
 *
 * The raw gap is included alongside the Gaussian skill score on purpose. The
 * Gaussian encodes our prior about how skill gaps hurt; the raw gap lets the
 * model learn a different shape if the feedback disagrees with that prior.
 */

import { componentScores } from './compatibility';
import type { PlayerVector } from './types';

export const FEATURE_NAMES = [
  'skill',
  'role',
  'availability',
  'comm',
  'language',
  'region',
  'teamwork',
  'abs_rating_diff',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export function pairFeatures(a: PlayerVector, b: PlayerVector): number[] {
  const parts = componentScores(a, b);
  return [
    parts.skill.score,
    parts.role.score,
    parts.availability.score,
    parts.comm.score,
    parts.language.score,
    parts.region.score,
    parts.teamwork.score,
    Math.abs(a.overallRating - b.overallRating),
  ];
}
