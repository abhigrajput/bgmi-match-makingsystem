/**
 * Pairwise compatibility: how well two players would play together.
 *
 * Pure functions, no I/O. Every score is in [0, 1] and comes with the words
 * that justify it, because the product promise is an explained squad, not a
 * number. The squad optimizer (squad.ts) and the ML features (model.ts,
 * scripts/train.ts) are both built on the component scores defined here.
 *
 * Two kinds of rule, kept separate on purpose:
 *
 *   Hard vetoes (skill band, comms, language) are not "low scores". A silent
 *   player grouped with a voice-required one is not a 20% worse squad; it is a
 *   squad that will not function. A veto forces the pair score to exactly 0
 *   and the optimizer refuses to place the pair together at all -- no weight
 *   setting, and no model output, can trade it away.
 *
 *   Soft components are weighted and summed (WEIGHTS below).
 */

import { ROLE_LABELS } from '@/lib/roles';
import type { CommPreference, PlayerRole } from '@/types/database';

import type {
  AvailabilityWindow,
  ComponentName,
  Components,
  PairResult,
  PlayerVector,
  Scored,
  VetoRule,
} from './types';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Soft-component weights. They sum to 1, so the weighted sum stays in [0, 1]
 * and a pair score reads directly as a fraction of "ideal". Skill leads
 * because a lopsided squad is the most common complaint about queue-order
 * matching; role is second because coverage is what a random squad most often
 * lacks.
 */
export const WEIGHTS: Readonly<Components> = {
  skill: 0.3,
  role: 0.2,
  availability: 0.15,
  comm: 0.1,
  language: 0.1,
  region: 0.1,
  teamwork: 0.05,
};

/** Width of the skill Gaussian: a 15-point gap scores exp(-0.5) ≈ 0.61. */
export const SKILL_SIGMA = 15;

/** Six shared hours a week saturates the availability score. */
export const FULL_OVERLAP_MINUTES = 360;

const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const COMM_LABELS: Record<CommPreference, string> = {
  voice_required: 'voice required',
  voice_optional: 'voice optional',
  text_only: 'text only',
  silent: 'silent',
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export function skillScore(a: PlayerVector, b: PlayerVector): Scored {
  const diff = Math.abs(a.overallRating - b.overallRating);
  const score = Math.exp(-(diff * diff) / (2 * SKILL_SIGMA * SKILL_SIGMA));
  const gap = Math.round(diff);
  const reason =
    gap <= 3
      ? `Ratings nearly identical (${Math.round(a.overallRating)} vs ${Math.round(b.overallRating)})`
      : score >= 0.5
        ? `Ratings ${gap} points apart`
        : `Rating gap of ${gap} points`;
  return { score, reasons: [reason] };
}

/**
 * True when either player's rating falls outside the other's declared
 * teammate band. A player who asked for teammates rated 60-90 has not agreed
 * to a 40, however good the rest of the fit.
 */
export function bandVeto(a: PlayerVector, b: PlayerVector): boolean {
  const aAcceptsB = b.overallRating >= a.minSkill && b.overallRating <= a.maxSkill;
  const bAcceptsA = a.overallRating >= b.minSkill && a.overallRating <= b.maxSkill;
  return !(aAcceptsB && bAcceptsA);
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/**
 * Symmetric role-pair affinity. Written out as explicit pairs rather than a
 * formula because the values are domain judgement, not derivation: an IGL
 * with an assaulter is the classic pairing; two IGLs fight over the call; two
 * snipers leave the squad with no one entering fights.
 */
const ROLE_PAIRS: [PlayerRole, PlayerRole, number][] = [
  ['igl', 'assaulter', 0.95],
  ['igl', 'sniper', 0.9],
  ['igl', 'support', 0.9],
  ['igl', 'igl', 0.2],
  ['assaulter', 'support', 0.95],
  ['assaulter', 'sniper', 0.85],
  ['assaulter', 'assaulter', 0.5],
  ['sniper', 'support', 0.85],
  ['sniper', 'sniper', 0.3],
  ['support', 'support', 0.4],
  ['flex', 'igl', 0.75],
  ['flex', 'assaulter', 0.75],
  ['flex', 'sniper', 0.75],
  ['flex', 'support', 0.75],
  ['flex', 'flex', 0.6],
];

export const ROLE_MATRIX: Readonly<Record<PlayerRole, Record<PlayerRole, number>>> =
  (() => {
    const matrix = {} as Record<PlayerRole, Record<PlayerRole, number>>;
    for (const [x, y, value] of ROLE_PAIRS) {
      matrix[x] = { ...(matrix[x] ?? {}), [y]: value };
      matrix[y] = { ...(matrix[y] ?? {}), [x]: value };
    }
    return matrix;
  })();

export function roleAffinity(x: PlayerRole, y: PlayerRole): number {
  return ROLE_MATRIX[x][y];
}

function rolesOf(player: PlayerVector): PlayerRole[] {
  return player.secondaryRole
    ? [player.primaryRole, player.secondaryRole]
    : [player.primaryRole];
}

/**
 * Best affinity over every combination of each player's declared roles. A
 * sniper/support and a sniper score as sniper + support (0.85), not
 * sniper + sniper (0.30): the first player said they can play support, and a
 * scorer that ignored that would split a pair that works. The reason line says
 * when a secondary role was needed to get there.
 */
export function roleScore(a: PlayerVector, b: PlayerVector): Scored {
  let best = { score: -1, ra: a.primaryRole, rb: b.primaryRole };
  for (const ra of rolesOf(a)) {
    for (const rb of rolesOf(b)) {
      const value = roleAffinity(ra, rb);
      // Strictly greater: on a tie the earlier combination -- primaries first
      // -- wins, so a secondary is only invoked when it actually helps.
      if (value > best.score) best = { score: value, ra, rb };
    }
  }

  const usedSecondary: string[] = [];
  if (best.ra !== a.primaryRole) usedSecondary.push(`${a.ign} on secondary ${ROLE_LABELS[best.ra]}`);
  if (best.rb !== b.primaryRole) usedSecondary.push(`${b.ign} on secondary ${ROLE_LABELS[best.rb]}`);

  const pair = `${ROLE_LABELS[best.ra]} + ${ROLE_LABELS[best.rb]}`;
  let reason =
    best.ra === best.rb && best.ra !== 'flex'
      ? `Both want to play ${ROLE_LABELS[best.ra]}`
      : best.score >= 0.85
        ? `${pair} complement each other`
        : `${pair} is a workable role pairing`;
  if (usedSecondary.length > 0) reason += ` (${usedSecondary.join(', ')})`;

  return { score: best.score, reasons: [reason] };
}

// ---------------------------------------------------------------------------
// Comms
// ---------------------------------------------------------------------------

/** silent vs voice_required is the only comms pairing that is unplayable. */
export function commVeto(a: CommPreference, b: CommPreference): boolean {
  return (
    (a === 'silent' && b === 'voice_required') ||
    (a === 'voice_required' && b === 'silent')
  );
}

export function commScore(a: PlayerVector, b: PlayerVector): Scored {
  const x = a.comm;
  const y = b.comm;
  const has = (v: CommPreference) => x === v || y === v;

  let score: number;
  if (commVeto(x, y)) score = 0;
  else if (x === y) score = 1;
  else if (has('voice_optional') && x !== 'silent' && y !== 'silent') score = 0.8;
  else if (has('text_only') && has('voice_required')) score = 0.3;
  else score = 0.6;

  const reason =
    x === y
      ? `Same comms style (${COMM_LABELS[x]})`
      : `Comms: ${COMM_LABELS[x]} vs ${COMM_LABELS[y]}`;
  return { score, reasons: [reason] };
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function normaliseLanguages(languages: string[]): Set<string> {
  return new Set(languages.map((l) => l.trim().toLowerCase()).filter(Boolean));
}

export function sharedLanguages(a: PlayerVector, b: PlayerVector): string[] {
  const setB = normaliseLanguages(b.languages);
  return [...normaliseLanguages(a.languages)].filter((l) => setB.has(l)).sort();
}

/** Jaccard overlap of the two language sets. No common language is a veto. */
export function languageScore(a: PlayerVector, b: PlayerVector): Scored {
  const setA = normaliseLanguages(a.languages);
  const setB = normaliseLanguages(b.languages);
  const shared = sharedLanguages(a, b);
  const union = new Set([...setA, ...setB]).size;
  const score = union === 0 ? 0 : shared.length / union;
  const reason =
    shared.length === 0
      ? 'No common language'
      : `Share ${shared.join(', ')}${score < 0.5 ? ` (of ${union} languages between them)` : ''}`;
  return { score, reasons: [reason] };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type Interval = [start: number, end: number];

/**
 * One local window as half-open UTC minute-of-week intervals.
 *
 * local = UTC + offset, so UTC = local - offset. A window can land across the
 * week boundary after the shift (Sunday 02:00 IST is Saturday 20:30 UTC), in
 * which case it is split in two at 10080 rather than wrapped into a negative
 * or >10080 interval that no comparison would handle.
 */
export function toUtcWeekIntervals(window: AvailabilityWindow): Interval[] {
  const length = window.end - window.start;
  if (length <= 0) return [];
  const rawStart = window.day * MINUTES_PER_DAY + window.start - window.tzOffset;
  const start = ((rawStart % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  const end = start + length;
  if (end <= MINUTES_PER_WEEK) return [[start, end]];
  return [
    [start, MINUTES_PER_WEEK],
    [0, end - MINUTES_PER_WEEK],
  ];
}

/**
 * Sorted, non-overlapping union. Merging first is what stops a player with two
 * overlapping windows (20:00-23:00 and 22:00-24:00) from having the shared hour
 * counted twice against a teammate.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
  const merged: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function weeklyIntervals(player: Pick<PlayerVector, 'availability'>): Interval[] {
  return mergeIntervals(player.availability.flatMap(toUtcWeekIntervals));
}

/** Intersection of two merged interval lists, by a linear two-pointer sweep. */
export function intersectIntervals(x: Interval[], y: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const a = x[i]!;
    const b = y[j]!;
    const s = Math.max(a[0], b[0]);
    const e = Math.min(a[1], b[1]);
    if (s < e) out.push([s, e]);
    if (a[1] < b[1]) i++;
    else j++;
  }
  return out;
}

export function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

export function overlapMinutes(a: PlayerVector, b: PlayerVector): number {
  return totalMinutes(intersectIntervals(weeklyIntervals(a), weeklyIntervals(b)));
}

function hours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}` : h.toFixed(1);
}

export function availabilityScore(a: PlayerVector, b: PlayerVector): Scored {
  const minutes = overlapMinutes(a, b);
  const score = clamp01(minutes / FULL_OVERLAP_MINUTES);
  const reason =
    minutes === 0
      ? 'No shared play hours in the week'
      : `${hours(minutes)} shared hours a week`;
  return { score, reasons: [reason] };
}

// ---------------------------------------------------------------------------
// Region and teamwork
// ---------------------------------------------------------------------------

export function regionScore(a: PlayerVector, b: PlayerVector): Scored {
  if (!a.region || !b.region) {
    return { score: 0.8, reasons: ['Region not set for one player'] };
  }
  if (a.region.trim().toLowerCase() === b.region.trim().toLowerCase()) {
    return { score: 1, reasons: [`Same region (${a.region})`] };
  }
  return { score: 0.5, reasons: [`Different regions (${a.region} / ${b.region})`] };
}

/** Mean of the two measured teamwork axes, on 0..1. */
export function teamworkScore(a: PlayerVector, b: PlayerVector): Scored {
  const mean = (a.axes.teamwork + b.axes.teamwork) / 2;
  const score = clamp01(mean / 100);
  const reason =
    score >= 0.6
      ? `Both measured as team players (avg teamwork ${Math.round(mean)})`
      : `Low measured teamwork (avg ${Math.round(mean)})`;
  return { score, reasons: [reason] };
}

// ---------------------------------------------------------------------------
// Vetoes and the pair score
// ---------------------------------------------------------------------------

const VETO_REASON: Record<VetoRule, (a: PlayerVector, b: PlayerVector) => string> = {
  skill_band: (a, b) =>
    `Outside each other's teammate skill band (${Math.round(a.overallRating)} vs ${Math.round(b.overallRating)})`,
  comm: (a, b) =>
    `Comms conflict: ${COMM_LABELS[a.comm]} vs ${COMM_LABELS[b.comm]}`,
  language: () => 'No common language',
};

export function vetoReason(rule: VetoRule, a: PlayerVector, b: PlayerVector): string {
  return VETO_REASON[rule](a, b);
}

/**
 * The hard rules, in a fixed order so the reported rule is deterministic when
 * more than one applies.
 */
export function isHardIncompatible(
  a: PlayerVector,
  b: PlayerVector,
): { vetoed: boolean; rule: VetoRule | null } {
  if (bandVeto(a, b)) return { vetoed: true, rule: 'skill_band' };
  if (commVeto(a.comm, b.comm)) return { vetoed: true, rule: 'comm' };
  if (sharedLanguages(a, b).length === 0) return { vetoed: true, rule: 'language' };
  return { vetoed: false, rule: null };
}

/** All seven soft components with their reason lines. */
export function componentScores(
  a: PlayerVector,
  b: PlayerVector,
): Record<ComponentName, Scored> {
  return {
    skill: skillScore(a, b),
    role: roleScore(a, b),
    availability: availabilityScore(a, b),
    comm: commScore(a, b),
    language: languageScore(a, b),
    region: regionScore(a, b),
    teamwork: teamworkScore(a, b),
  };
}

const COMPONENT_ORDER: ComponentName[] = [
  'skill',
  'role',
  'availability',
  'comm',
  'language',
  'region',
  'teamwork',
];

/**
 * Picks the lines worth showing: the three components contributing most
 * (weighted) among the good ones, and the two costing most among the weak
 * ones. Seven reasons for every pair would bury the two that matter.
 */
export function summariseReasons(parts: Record<ComponentName, Scored>): string[] {
  const positives = COMPONENT_ORDER.filter((c) => parts[c].score >= 0.65)
    .sort((x, y) => WEIGHTS[y] * parts[y].score - WEIGHTS[x] * parts[x].score)
    .slice(0, 3)
    .flatMap((c) => parts[c].reasons);
  const negatives = COMPONENT_ORDER.filter((c) => parts[c].score < 0.5)
    .sort((x, y) => WEIGHTS[y] * (1 - parts[y].score) - WEIGHTS[x] * (1 - parts[x].score))
    .slice(0, 2)
    .flatMap((c) => parts[c].reasons);
  return [...positives, ...negatives];
}

/**
 * The rule-based pair score: weighted sum of the soft components, or exactly 0
 * with the veto as the only reason when a hard rule applies.
 */
export function pairScore(a: PlayerVector, b: PlayerVector): PairResult {
  const parts = componentScores(a, b);
  const components = Object.fromEntries(
    COMPONENT_ORDER.map((c) => [c, parts[c].score]),
  ) as Components;

  const veto = isHardIncompatible(a, b);
  if (veto.vetoed && veto.rule) {
    return {
      score: 0,
      reasons: [vetoReason(veto.rule, a, b)],
      components,
      veto: veto.rule,
      source: 'rule_based',
    };
  }

  const score = clamp01(
    COMPONENT_ORDER.reduce((sum, c) => sum + WEIGHTS[c] * components[c], 0),
  );

  return {
    score,
    reasons: summariseReasons(parts),
    components,
    veto: null,
    source: 'rule_based',
  };
}
