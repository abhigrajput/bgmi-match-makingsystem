import { describe, expect, it } from 'vitest';

import { rankOnlySquads } from '../baseline';
import { isHardIncompatible, pairScore } from '../compatibility';
import { compare } from '../evaluate';
import { assignRoles, formSquads, roleCoverage } from '../squad';

import { fixturePool, makePlayer } from './fixtures';

function allPairs<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!]);
  }
  return out;
}

describe('formSquads', () => {
  const pool = fixturePool(40);
  const result = formSquads(pool, 4, pairScore);

  it('never places a vetoed pair in the same squad', () => {
    for (const squad of result.squads) {
      for (const [a, b] of allPairs(squad.members)) {
        expect(isHardIncompatible(a, b).vetoed).toBe(false);
      }
    }
  });

  it('never uses a player twice, and accounts for every player exactly once', () => {
    const placed = result.squads.flatMap((s) => s.members.map((m) => m.profileId));
    const unmatched = result.unmatched.map((u) => u.player.profileId);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed, ...unmatched].sort()).toEqual(pool.map((p) => p.profileId).sort());
  });

  it('respects the squad size', () => {
    for (const squad of result.squads) expect(squad.members).toHaveLength(4);
    const duos = formSquads(pool, 2, pairScore);
    for (const squad of duos.squads) expect(squad.members).toHaveLength(2);
  });

  it('is deterministic', () => {
    const again = formSquads([...pool].reverse(), 4, pairScore);
    const ids = (r: typeof result) =>
      r.squads.map((s) => s.members.map((m) => m.profileId).sort().join(','));
    expect(ids(again)).toEqual(ids(result));
  });

  it('gives every unmatched player a reason', () => {
    for (const u of result.unmatched) expect(u.reason.length).toBeGreaterThan(10);
  });

  it('explains every squad, including its weakest link', () => {
    for (const squad of result.squads) {
      expect(squad.reasons.some((r) => r.startsWith('Weakest link'))).toBe(true);
      expect(squad.reasons.some((r) => /role/i.test(r))).toBe(true);
    }
  });

  it('beats the rank-only baseline on the fixed 40-player fixture', () => {
    const baseline = rankOnlySquads(pool, 4);
    const comparison = compare(
      result.squads.map((s) => s.members),
      baseline.groups,
      pairScore,
    );
    expect(comparison.optimizer.meanSquadScore).toBeGreaterThan(comparison.baseline.meanSquadScore);
    expect(comparison.baseline.vetoedPairs).toBeGreaterThanOrEqual(1);
    expect(comparison.optimizer.vetoedPairs).toBe(0);
  });

  it('reports the pool running out as the reason', () => {
    const three = [0, 1, 2].map((i) => makePlayer({ profileId: `x${i}` }));
    const r = formSquads(three, 4, pairScore);
    expect(r.squads).toHaveLength(0);
    expect(r.unmatched.length).toBeGreaterThan(0);
    expect(r.unmatched[0]!.reason).toMatch(/needs 4/);
  });

  it('reports a veto as the reason when that is what blocked the squad', () => {
    const players = [
      makePlayer({ profileId: 'silent', comm: 'silent', registeredAt: '2026-01-01T00:00:00Z' }),
      ...[1, 2, 3, 4].map((i) =>
        makePlayer({ profileId: `v${i}`, comm: 'voice_required', registeredAt: `2026-01-01T00:0${i}:00Z` }),
      ),
    ];
    const r = formSquads(players, 4, pairScore);
    const silent = r.unmatched.find((u) => u.player.profileId === 'silent');
    expect(silent?.reason).toMatch(/comms/);
  });
});

describe('assignRoles', () => {
  it('spreads four distinct primaries onto four distinct roles', () => {
    const squad = assignRoles(
      (['igl', 'assaulter', 'sniper', 'support'] as const).map((role, i) =>
        makePlayer({ profileId: `r${i}`, primaryRole: role }),
      ),
    );
    expect(roleCoverage(squad)).toBe(4);
    expect(squad.map((m) => m.assignedRole)).toEqual(['igl', 'assaulter', 'sniper', 'support']);
  });

  it('moves a duplicate onto a declared secondary before resorting to flex', () => {
    const squad = assignRoles([
      makePlayer({ profileId: 'a', primaryRole: 'sniper' }),
      makePlayer({ profileId: 'b', primaryRole: 'sniper', secondaryRole: 'support' }),
      makePlayer({ profileId: 'c', primaryRole: 'igl' }),
    ]);
    expect(squad.map((m) => m.assignedRole)).toEqual(['sniper', 'support', 'igl']);
  });

  it('lets a flex player fill the missing specialist slot', () => {
    const squad = assignRoles([
      makePlayer({ profileId: 'a', primaryRole: 'igl' }),
      makePlayer({ profileId: 'b', primaryRole: 'assaulter' }),
      makePlayer({ profileId: 'c', primaryRole: 'sniper' }),
      makePlayer({ profileId: 'd', primaryRole: 'flex' }),
    ]);
    expect(squad[3]!.assignedRole).toBe('support');
  });
});

describe('rankOnlySquads', () => {
  it('chunks by rating and leaves the remainder over', () => {
    const players = [10, 90, 50, 70, 30].map((r, i) => makePlayer({ profileId: `b${i}`, overallRating: r }));
    const { groups, leftover } = rankOnlySquads(players, 2);
    expect(groups.map((g) => g.map((p) => p.overallRating))).toEqual([[90, 70], [50, 30]]);
    expect(leftover.map((p) => p.overallRating)).toEqual([10]);
  });
});
