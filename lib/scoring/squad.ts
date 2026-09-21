/**
 * Squad formation: turn a pool of registered players into squads.
 *
 * Greedy construction followed by local search, both deterministic. The goal
 * is not a provably optimal partition -- that is NP-hard for squads of four --
 * but one that is (a) never worse than the rules allow, because no vetoed pair
 * is ever placed together, (b) clearly better than sorting by rating, and (c)
 * explainable: every squad carries the reasons it was formed.
 *
 * Determinism matters here more than usual. A tournament organiser who presses
 * "Form squads" twice on the same registrations must get the same squads, and
 * the tests assert exactly that. There is no randomness anywhere below; every
 * tie is broken by registration order.
 */

import { ROLE_LABELS } from '@/lib/roles';
import type { PlayerRole } from '@/types/database';

import {
  intersectIntervals,
  isHardIncompatible,
  totalMinutes,
  vetoReason,
  weeklyIntervals,
} from './compatibility';
import type { PairResult, PairScorer, PlayerVector, VetoRule } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SquadMember = PlayerVector & { assignedRole: PlayerRole };

export type Squad = {
  members: SquadMember[];
  /** Mean pairwise + role coverage bonus - rating spread penalty (see below). */
  score: number;
  meanPairScore: number;
  /** Mean of each pair's components, for matches.squad_score_components. */
  components: Record<string, number>;
  reasons: string[];
  strongestPair: PairSummary | null;
  weakestPair: PairSummary | null;
  source: 'ml' | 'rule_based';
};

export type PairSummary = { a: string; b: string; score: number };

export type Unmatched = { player: PlayerVector; reason: string };

export type FormationResult = { squads: Squad[]; unmatched: Unmatched[] };

// ---------------------------------------------------------------------------
// Tuning constants -- named so the tests and docs can refer to them.
// ---------------------------------------------------------------------------

/** Weight on "this candidate covers a role the squad lacks" during greedy fill. */
export const ROLE_COVERAGE_BONUS = 0.15;
/** Squad score: bonus per fraction of distinct roles covered. */
export const SQUAD_ROLE_WEIGHT = 0.1;
/** Squad score: penalty per unit of normalised rating standard deviation. */
export const SQUAD_SPREAD_WEIGHT = 0.1;
/** Local-search budget. */
export const MAX_SWAP_ITERATIONS = 200;

// ---------------------------------------------------------------------------
// Pair cache
// ---------------------------------------------------------------------------

/**
 * Scores every pair once. The swap phase re-evaluates the same pairs
 * thousands of times, and for the ML scorer each evaluation is a model call.
 */
export function makePairCache(scorer: PairScorer) {
  const cache = new Map<string, PairResult>();
  return (a: PlayerVector, b: PlayerVector): PairResult => {
    const key = a.profileId < b.profileId ? `${a.profileId}|${b.profileId}` : `${b.profileId}|${a.profileId}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = scorer(a, b);
      cache.set(key, hit);
    }
    return hit;
  };
}

function vetoed(a: PlayerVector, b: PlayerVector): VetoRule | null {
  // Checked directly, not through the scorer: vetoes are rules, and no scorer
  // -- including a model that learned otherwise -- is allowed to override them.
  return isHardIncompatible(a, b).rule;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const SPECIALIST_ROLES: PlayerRole[] = ['igl', 'assaulter', 'sniper', 'support'];

/**
 * Role options for one player, each with a cost: primary 0, secondary 1, flex
 * 2. A flex-primary player can fill any specialist slot at no cost -- that is
 * what declaring flex means.
 */
function roleOptions(player: PlayerVector): { role: PlayerRole; cost: number }[] {
  if (player.primaryRole === 'flex') {
    return [...SPECIALIST_ROLES.map((role) => ({ role, cost: 0 })), { role: 'flex', cost: 0 }];
  }
  const options: { role: PlayerRole; cost: number }[] = [{ role: player.primaryRole, cost: 0 }];
  if (player.secondaryRole) options.push({ role: player.secondaryRole, cost: 1 });
  options.push({ role: 'flex', cost: 2 });
  return options;
}

/**
 * Assigns in-squad roles to maximise distinct specialist coverage, then
 * minimise how far players are pushed off their primary.
 *
 * Exhaustive: a squad of four with at most five options each is at most 625
 * combinations, which is cheaper than being clever. Iteration order is fixed,
 * so ties resolve the same way every time.
 */
export function assignRoles(players: PlayerVector[]): SquadMember[] {
  let best: { roles: PlayerRole[]; coverage: number; cost: number } | null = null;
  const options = players.map(roleOptions);

  const walk = (index: number, roles: PlayerRole[], cost: number) => {
    if (index === players.length) {
      const coverage = new Set(roles.filter((r) => r !== 'flex')).size;
      if (
        !best ||
        coverage > best.coverage ||
        (coverage === best.coverage && cost < best.cost)
      ) {
        best = { roles: [...roles], coverage, cost };
      }
      return;
    }
    for (const option of options[index]!) {
      roles.push(option.role);
      walk(index + 1, roles, cost + option.cost);
      roles.pop();
    }
  };
  walk(0, [], 0);

  const chosen = (best as { roles: PlayerRole[] } | null)?.roles ?? players.map((p) => p.primaryRole);
  return players.map((player, i) => ({ ...player, assignedRole: chosen[i]! }));
}

/** Distinct specialist roles the squad covers, after role assignment. */
export function roleCoverage(members: SquadMember[]): number {
  return new Set(members.map((m) => m.assignedRole).filter((r) => r !== 'flex')).size;
}

// ---------------------------------------------------------------------------
// Scoring a squad
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function pairsOf<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!]);
  }
  return out;
}

/**
 * squadScore = mean pairwise score
 *            + 0.10 * (distinct roles covered / squad size)
 *            - 0.10 * (rating standard deviation / 50)
 *
 * 50 is the largest standard deviation possible on a 0-100 scale, so the
 * spread term is normalised to [0, 1]. A vetoed pair contributes its score of
 * 0 to the mean -- which is how the rank-only baseline is penalised for the
 * vetoes it walks into.
 */
export function squadScore(
  members: SquadMember[],
  score: (a: PlayerVector, b: PlayerVector) => PairResult,
): number {
  const pairs = pairsOf(members);
  const meanPair =
    pairs.length === 0 ? 0 : pairs.reduce((s, [a, b]) => s + score(a, b).score, 0) / pairs.length;
  const coverage = roleCoverage(members) / members.length;
  const spread = stddev(members.map((m) => m.overallRating)) / 50;
  return meanPair + SQUAD_ROLE_WEIGHT * coverage - SQUAD_SPREAD_WEIGHT * spread;
}

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** Builds the full Squad object: roles, score, components and reasons. */
export function describeSquad(
  players: PlayerVector[],
  score: (a: PlayerVector, b: PlayerVector) => PairResult,
): Squad {
  const members = assignRoles(players);
  const pairs = pairsOf(members).map(([a, b]) => ({ a, b, result: score(a, b) }));

  const meanPairScore =
    pairs.length === 0 ? 0 : pairs.reduce((s, p) => s + p.result.score, 0) / pairs.length;

  const components: Record<string, number> = {};
  for (const p of pairs) {
    for (const [key, value] of Object.entries(p.result.components)) {
      components[key] = (components[key] ?? 0) + value / pairs.length;
    }
  }

  const sortedPairs = [...pairs].sort((x, y) => y.result.score - x.result.score);
  const strongest = sortedPairs[0];
  const weakest = sortedPairs[sortedPairs.length - 1];

  // --- reasons ------------------------------------------------------------
  const reasons: string[] = [];

  const coverage = roleCoverage(members);
  const roleList = members.map((m) => ROLE_LABELS[m.assignedRole]).join(' + ');
  reasons.push(
    coverage === Math.min(members.length, 4)
      ? `Full role coverage: ${roleList}`
      : `${coverage} distinct roles: ${roleList}`,
  );

  const ratings = members.map((m) => Math.round(m.overallRating));
  const lo = Math.min(...ratings);
  const hi = Math.max(...ratings);
  reasons.push(
    hi - lo <= 10
      ? `Tight skill band: ratings ${lo}–${hi}`
      : `Ratings span ${lo}–${hi} (${hi - lo} points)`,
  );

  const languageSets = members.map(
    (m) => new Set(m.languages.map((l) => l.trim().toLowerCase())),
  );
  const common = [...languageSets[0]!].filter((l) => languageSets.every((set) => set.has(l))).sort();
  reasons.push(
    common.length > 0
      ? `Everyone speaks ${common.join(', ')}`
      : 'No single language shared by the whole squad',
  );

  const shared = members
    .slice(1)
    .reduce((acc, m) => intersectIntervals(acc, weeklyIntervals(m)), weeklyIntervals(members[0]!));
  const sharedMinutes = totalMinutes(shared);
  reasons.push(
    sharedMinutes > 0
      ? `${formatHours(sharedMinutes)} hours a week when all ${members.length} are available`
      : 'No hour in the week when the whole squad is available',
  );

  if (strongest && pairs.length > 1) {
    reasons.push(
      `Strongest pair: ${strongest.a.ign} & ${strongest.b.ign} (${Math.round(strongest.result.score * 100)})`,
    );
  }
  if (weakest) {
    reasons.push(
      `Weakest link: ${weakest.a.ign} & ${weakest.b.ign} (${Math.round(weakest.result.score * 100)})` +
        (weakest.result.reasons.length > 0
          ? ` — ${weakest.result.reasons[weakest.result.reasons.length - 1]}`
          : ''),
    );
  }

  return {
    members,
    score: squadScore(members, score),
    meanPairScore,
    components,
    reasons,
    strongestPair: strongest
      ? { a: strongest.a.profileId, b: strongest.b.profileId, score: strongest.result.score }
      : null,
    weakestPair: weakest
      ? { a: weakest.a.profileId, b: weakest.b.profileId, score: weakest.result.score }
      : null,
    source: pairs.some((p) => p.result.source === 'ml') ? 'ml' : 'rule_based',
  };
}

// ---------------------------------------------------------------------------
// Formation
// ---------------------------------------------------------------------------

function byRegistration(a: PlayerVector, b: PlayerVector): number {
  if (a.registeredAt !== b.registeredAt) return a.registeredAt < b.registeredAt ? -1 : 1;
  return a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0;
}

/**
 * Why a seed could not be completed into a squad, in words a player can act
 * on: which rule excluded most of the pool, or that the pool simply ran out.
 */
function blockingReason(
  seed: PlayerVector,
  squad: PlayerVector[],
  pool: PlayerVector[],
  size: number,
): string {
  const others = pool.filter((p) => !squad.includes(p));
  if (others.length + squad.length < size) {
    return `Only ${others.length + squad.length} compatible players left in the pool; a squad needs ${size}.`;
  }
  const counts = new Map<VetoRule, number>();
  let example: string | null = null;
  for (const other of others) {
    const rule = squad.map((m) => vetoed(m, other)).find((r): r is VetoRule => r !== null);
    if (rule) {
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
      if (!example) example = vetoReason(rule, seed, other);
    }
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  if (!top) return 'No remaining combination of players could complete a squad.';
  const label: Record<VetoRule, string> = {
    skill_band: 'teammate skill band',
    comm: 'comms preference',
    language: 'language',
  };
  return `Vetoed with ${top[1]} of ${others.length} remaining players, mostly on ${label[top[0]]}${example ? ` (e.g. ${example.toLowerCase()})` : ''}.`;
}

/**
 * Greedy construction, then single-player swap improvement.
 *
 * 1. Players queue in registration order.
 * 2. The first unassigned player seeds a squad.
 * 3. Candidates are unassigned players vetoed with NO current member.
 * 4. Add the candidate maximising mean pair score to the members plus
 *    ROLE_COVERAGE_BONUS if it brings a role the squad lacks; repeat to size.
 * 5. A squad that cannot be completed sends its members back to the pool
 *    once; a seed that fails a second time is unmatched, with the reason.
 * 6. Swap improvement (see improveBySwaps).
 */
export function formSquads(
  players: PlayerVector[],
  size: number,
  scorer: PairScorer,
): FormationResult {
  const score = makePairCache(scorer);
  const queue = [...players].sort(byRegistration);
  const failures = new Map<string, number>();
  // The reason from a seed's FIRST failed attempt, when the pool was larger.
  // By the second attempt the compatible players have often been placed
  // elsewhere, and "only 1 player left" would hide the veto that actually
  // excluded this player.
  const firstReasons = new Map<string, string>();
  const groups: PlayerVector[][] = [];
  const unmatched: Unmatched[] = [];

  while (queue.length > 0) {
    const seed = queue.shift()!;
    const squad = [seed];

    while (squad.length < size) {
      const candidates = queue.filter((c) => squad.every((m) => vetoed(m, c) === null));
      if (candidates.length === 0) break;

      const covered = new Set(squad.map((m) => m.primaryRole));
      let best: PlayerVector | null = null;
      let bestValue = -Infinity;
      for (const candidate of candidates) {
        const mean = squad.reduce((s, m) => s + score(m, candidate).score, 0) / squad.length;
        const bringsRole =
          !covered.has(candidate.primaryRole) ||
          (candidate.secondaryRole !== null && !covered.has(candidate.secondaryRole));
        const value = mean + (bringsRole ? ROLE_COVERAGE_BONUS : 0);
        // Strictly greater: candidates are in registration order, so the
        // earliest registrant wins a tie.
        if (value > bestValue) {
          bestValue = value;
          best = candidate;
        }
      }
      squad.push(best!);
      queue.splice(queue.indexOf(best!), 1);
    }

    if (squad.length === size) {
      groups.push(squad);
      continue;
    }

    const count = (failures.get(seed.profileId) ?? 0) + 1;
    failures.set(seed.profileId, count);
    const partners = squad.slice(1);
    const reason = blockingReason(seed, squad, [...queue, ...partners], size);
    if (count >= 2) {
      const first = firstReasons.get(seed.profileId);
      const poolRanOut = reason.startsWith('Only ');
      unmatched.push({
        player: seed,
        reason: poolRanOut && first && first.startsWith('Vetoed') ? first : reason,
      });
      // Partners go back to where they were in registration order, so a
      // failed seed does not reshuffle everyone behind it.
      queue.push(...partners);
      queue.sort(byRegistration);
    } else {
      firstReasons.set(seed.profileId, reason);
      // Back of the queue, so the next attempt is seeded by someone else and
      // this player gets a second chance against a different starting squad.
      queue.push(...partners);
      queue.sort(byRegistration);
      queue.push(seed);
    }
  }

  const improved = improveBySwaps(groups, score);
  const squads = improved.map((group) => describeSquad(group, score));
  return { squads, unmatched };
}

/**
 * Local search: repeatedly apply the single best improving swap of one player
 * between two squads. A swap is only considered if it creates no vetoed pair
 * in either squad. Stops when no swap improves the total or after
 * MAX_SWAP_ITERATIONS applied swaps. Fixed iteration order, so deterministic.
 */
export function improveBySwaps(
  groups: PlayerVector[][],
  score: (a: PlayerVector, b: PlayerVector) => PairResult,
): PlayerVector[][] {
  const squads = groups.map((g) => [...g]);
  // Memoised on the member set: between iterations only two squads change, so
  // almost every candidate swap re-asks about a squad already scored.
  const memo = new Map<string, number>();
  const value = (g: PlayerVector[]) => {
    const key = g.map((m) => m.profileId).sort().join('|');
    let v = memo.get(key);
    if (v === undefined) {
      v = squadScore(assignRoles(g), score);
      memo.set(key, v);
    }
    return v;
  };
  const current = squads.map(value);
  const compatible = (g: PlayerVector[], newcomer: PlayerVector, leaving: PlayerVector) =>
    g.every((m) => m === leaving || vetoed(m, newcomer) === null);

  for (let iteration = 0; iteration < MAX_SWAP_ITERATIONS; iteration++) {
    let best: { i: number; j: number; x: number; y: number; gain: number; vi: number; vj: number } | null = null;

    for (let i = 0; i < squads.length; i++) {
      for (let j = i + 1; j < squads.length; j++) {
        const si = squads[i]!;
        const sj = squads[j]!;
        for (let x = 0; x < si.length; x++) {
          for (let y = 0; y < sj.length; y++) {
            const px = si[x]!;
            const py = sj[y]!;
            if (!compatible(si, py, px) || !compatible(sj, px, py)) continue;
            const ni = si.map((m, k) => (k === x ? py : m));
            const nj = sj.map((m, k) => (k === y ? px : m));
            const vi = value(ni);
            const vj = value(nj);
            const gain = vi + vj - current[i]! - current[j]!;
            // A small epsilon so floating-point noise cannot cause a swap and
            // its reverse to alternate forever.
            if (gain > 1e-9 && (!best || gain > best.gain)) {
              best = { i, j, x, y, gain, vi, vj };
            }
          }
        }
      }
    }

    if (!best) break;
    const si = squads[best.i]!;
    const sj = squads[best.j]!;
    const px = si[best.x]!;
    si[best.x] = sj[best.y]!;
    sj[best.y] = px;
    current[best.i] = best.vi;
    current[best.j] = best.vj;
  }

  return squads;
}
