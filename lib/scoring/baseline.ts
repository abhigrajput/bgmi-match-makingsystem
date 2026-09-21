/**
 * The rank-only baseline: sort by rating, cut into consecutive squads.
 *
 * This is the "skill-based matchmaking" most games actually ship, and it is
 * the comparison the optimizer has to beat to justify existing. It looks
 * reasonable -- every squad has similar ratings -- and is blind to everything
 * else: roles, comms, language, hours, and the vetoes. The comparison tab
 * exists to show what that blindness costs.
 */

import type { PlayerVector } from './types';

export function rankOnlySquads(
  players: PlayerVector[],
  size: number,
): { groups: PlayerVector[][]; leftover: PlayerVector[] } {
  // Ties broken by id so the baseline is as deterministic as the optimizer.
  const sorted = [...players].sort(
    (a, b) => b.overallRating - a.overallRating || (a.profileId < b.profileId ? -1 : 1),
  );
  const full = Math.floor(sorted.length / size) * size;
  const groups: PlayerVector[][] = [];
  for (let i = 0; i < full; i += size) groups.push(sorted.slice(i, i + size));
  return { groups, leftover: sorted.slice(full) };
}
