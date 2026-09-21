/**
 * The scorer's view of a player, and of a score.
 *
 * Deliberately NOT the database row types. The scoring engine is pure
 * TypeScript with no I/O, so it can be unit-tested with plain objects and run
 * identically in an API route, a training script and a test. lib/scoring/
 * vectors.ts is the one place that maps rows onto this shape.
 */

import type { CommPreference, PlayerRole } from '@/types/database';

export type AvailabilityWindow = {
  /** 0 = Sunday ... 6 = Saturday, as stored. */
  day: number;
  /** Minutes from LOCAL midnight, 0..1440. */
  start: number;
  end: number;
  /** Minutes to ADD to UTC to get local time (IST = +330), as stored. */
  tzOffset: number;
};

export type SkillAxes = {
  aim: number;
  gameSense: number;
  teamwork: number;
  clutch: number;
  consistency: number;
};

export type PlayerVector = {
  profileId: string;
  ign: string;
  displayName: string;
  /** 0-100. */
  overallRating: number;
  axes: SkillAxes;
  primaryRole: PlayerRole;
  secondaryRole: PlayerRole | null;
  comm: CommPreference;
  languages: string[];
  region: string | null;
  /** The teammate skill band this player accepts, 0-100 inclusive. */
  minSkill: number;
  maxSkill: number;
  availability: AvailabilityWindow[];
  /** ISO timestamp; orders the formation queue (first come, first seeded). */
  registeredAt: string;
};

/** A 0..1 score with the human-readable lines that justify it. */
export type Scored = { score: number; reasons: string[] };

export type ComponentName =
  | 'skill'
  | 'role'
  | 'availability'
  | 'comm'
  | 'language'
  | 'region'
  | 'teamwork';

export type Components = Record<ComponentName, number>;

export type VetoRule = 'skill_band' | 'comm' | 'language';

export type PairResult = {
  /** 0..1. Exactly 0 when vetoed. */
  score: number;
  reasons: string[];
  components: Components;
  /** Set when a hard rule forbids this pair; the score is then 0. */
  veto: VetoRule | null;
  /** Which scorer produced `score`. */
  source: 'ml' | 'rule_based';
};

/** Anything that can score a pair. The optimizer is written against this. */
export type PairScorer = (a: PlayerVector, b: PlayerVector) => PairResult;
