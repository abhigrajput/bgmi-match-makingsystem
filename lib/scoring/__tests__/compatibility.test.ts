import { describe, expect, it } from 'vitest';

import { PLAYER_ROLES } from '@/types/database';

import {
  FULL_OVERLAP_MINUTES,
  MINUTES_PER_WEEK,
  ROLE_MATRIX,
  WEIGHTS,
  availabilityScore,
  bandVeto,
  commScore,
  isHardIncompatible,
  languageScore,
  mergeIntervals,
  overlapMinutes,
  pairScore,
  regionScore,
  roleScore,
  skillScore,
  toUtcWeekIntervals,
} from '../compatibility';

import { fixturePool, makePlayer } from './fixtures';

const a = (o = {}) => makePlayer({ profileId: 'a', ...o });
const b = (o = {}) => makePlayer({ profileId: 'b', ...o });

describe('skillScore', () => {
  it('scores identical ratings as 1', () => {
    expect(skillScore(a(), b()).score).toBe(1);
  });

  it('scores a 15-point gap at exp(-0.5)', () => {
    expect(skillScore(a({ overallRating: 40 }), b({ overallRating: 55 })).score).toBeCloseTo(
      Math.exp(-0.5),
      10,
    );
  });

  it('drives a 100-point gap to effectively zero', () => {
    const s = skillScore(a({ overallRating: 0 }), b({ overallRating: 100 }));
    expect(s.score).toBeLessThan(1e-9);
    expect(s.reasons[0]).toContain('100');
  });
});

describe('vetoes', () => {
  it('vetoes when one rating is outside the other player\'s band', () => {
    const narrow = a({ overallRating: 70, minSkill: 60, maxSkill: 80 });
    expect(bandVeto(narrow, b({ overallRating: 40 }))).toBe(true);
    expect(isHardIncompatible(narrow, b({ overallRating: 40 })).rule).toBe('skill_band');
  });

  it('checks the band in both directions', () => {
    // a accepts b (open band) but b does not accept a.
    const picky = b({ overallRating: 50, minSkill: 45, maxSkill: 55 });
    expect(bandVeto(a({ overallRating: 80 }), picky)).toBe(true);
  });

  it('allows ratings exactly on the band edge', () => {
    expect(bandVeto(a({ minSkill: 50, maxSkill: 50 }), b({ overallRating: 50 }))).toBe(false);
  });

  it('vetoes silent with voice_required, in either order', () => {
    expect(isHardIncompatible(a({ comm: 'silent' }), b({ comm: 'voice_required' })).rule).toBe('comm');
    expect(isHardIncompatible(a({ comm: 'voice_required' }), b({ comm: 'silent' })).rule).toBe('comm');
  });

  it('vetoes a pair with no common language', () => {
    expect(isHardIncompatible(a({ languages: ['ta'] }), b({ languages: ['mr'] })).rule).toBe('language');
  });

  it('reports vetoes in a fixed priority order', () => {
    const veto = isHardIncompatible(
      a({ comm: 'silent', languages: ['ta'], minSkill: 90, maxSkill: 100 }),
      b({ comm: 'voice_required', languages: ['mr'] }),
    );
    expect(veto.rule).toBe('skill_band');
  });

  it('forces the pair score to exactly 0 with the rule as the reason', () => {
    const result = pairScore(a({ comm: 'silent' }), b({ comm: 'voice_required' }));
    expect(result.score).toBe(0);
    expect(result.veto).toBe('comm');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/comms conflict/i);
  });
});

describe('roleScore', () => {
  it('uses the explicit matrix values', () => {
    expect(roleScore(a({ primaryRole: 'igl' }), b({ primaryRole: 'assaulter' })).score).toBe(0.95);
    expect(roleScore(a({ primaryRole: 'sniper' }), b({ primaryRole: 'sniper' })).score).toBe(0.3);
    expect(roleScore(a({ primaryRole: 'igl' }), b({ primaryRole: 'igl' })).score).toBe(0.2);
  });

  it('is symmetric for every role pair', () => {
    for (const x of PLAYER_ROLES) {
      for (const y of PLAYER_ROLES) {
        expect(ROLE_MATRIX[x][y]).toBe(ROLE_MATRIX[y][x]);
      }
    }
  });

  it('defines every one of the 25 ordered pairs', () => {
    for (const x of PLAYER_ROLES) {
      for (const y of PLAYER_ROLES) {
        expect(typeof ROLE_MATRIX[x][y]).toBe('number');
      }
    }
  });

  it('scores flex with any specialist at 0.75 and flex-flex at 0.60', () => {
    for (const role of ['igl', 'assaulter', 'sniper', 'support'] as const) {
      expect(roleScore(a({ primaryRole: 'flex' }), b({ primaryRole: role })).score).toBe(0.75);
    }
    expect(roleScore(a({ primaryRole: 'flex' }), b({ primaryRole: 'flex' })).score).toBe(0.6);
  });

  it('upgrades through a secondary role and says so', () => {
    const result = roleScore(
      a({ primaryRole: 'sniper', secondaryRole: 'support', ign: 'Zed' }),
      b({ primaryRole: 'sniper' }),
    );
    expect(result.score).toBe(0.85);
    expect(result.reasons[0]).toContain('Zed on secondary Support');
  });

  it('keeps primaries when a secondary does not improve the score', () => {
    const result = roleScore(
      a({ primaryRole: 'igl', secondaryRole: 'sniper' }),
      b({ primaryRole: 'assaulter' }),
    );
    expect(result.score).toBe(0.95);
    expect(result.reasons[0]).not.toContain('secondary');
  });
});

describe('commScore', () => {
  it.each([
    ['voice_required', 'voice_required', 1],
    ['voice_optional', 'voice_required', 0.8],
    ['voice_optional', 'text_only', 0.8],
    ['text_only', 'voice_required', 0.3],
    ['voice_optional', 'silent', 0.6],
    ['text_only', 'silent', 0.6],
  ] as const)('%s + %s = %d', (x, y, expected) => {
    expect(commScore(a({ comm: x }), b({ comm: y })).score).toBe(expected);
    expect(commScore(a({ comm: y }), b({ comm: x })).score).toBe(expected);
  });
});

describe('languageScore', () => {
  it('is the Jaccard overlap', () => {
    expect(languageScore(a({ languages: ['en', 'hi'] }), b({ languages: ['en', 'kn'] })).score).toBeCloseTo(1 / 3);
  });

  it('ignores case and whitespace', () => {
    expect(languageScore(a({ languages: [' EN'] }), b({ languages: ['en'] })).score).toBe(1);
  });
});

describe('availability', () => {
  it('handles a window ending at 1440 (local midnight)', () => {
    // Monday 22:00-24:00 UTC.
    expect(toUtcWeekIntervals({ day: 1, start: 1320, end: 1440, tzOffset: 0 })).toEqual([[2760, 2880]]);
  });

  it('shifts across midnight when the offset moves the window to the previous day', () => {
    // Tuesday 02:00-04:00 IST is Monday 20:30-22:30 UTC.
    const [interval] = toUtcWeekIntervals({ day: 2, start: 120, end: 240, tzOffset: 330 });
    expect(interval).toEqual([1440 + 1230, 1440 + 1350]);
  });

  it('wraps Sunday early morning IST back to Saturday UTC', () => {
    // Sunday 00:00-02:00 IST = Saturday 18:30-20:30 UTC.
    expect(toUtcWeekIntervals({ day: 0, start: 0, end: 120, tzOffset: 330 })).toEqual([
      [MINUTES_PER_WEEK - 330, MINUTES_PER_WEEK - 210],
    ]);
  });

  it('splits a window that crosses the Saturday to Sunday week boundary', () => {
    // Saturday 22:00-24:00 at UTC-1 is Saturday 23:00 to Sunday 01:00 UTC,
    // so it must come back as two intervals split at the week boundary.
    expect(toUtcWeekIntervals({ day: 6, start: 1320, end: 1440, tzOffset: -60 })).toEqual([
      [MINUTES_PER_WEEK - 60, MINUTES_PER_WEEK],
      [0, 60],
    ]);
  });

  it('matches the same moment across two timezones', () => {
    const ist = a({ availability: [{ day: 1, start: 1230, end: 1350, tzOffset: 330 }] });
    const utc = b({ availability: [{ day: 1, start: 900, end: 1020, tzOffset: 0 }] });
    expect(overlapMinutes(ist, utc)).toBe(120);
  });

  it('scores zero overlap as 0', () => {
    const x = a({ availability: [{ day: 1, start: 600, end: 700, tzOffset: 0 }] });
    const y = b({ availability: [{ day: 2, start: 600, end: 700, tzOffset: 0 }] });
    expect(availabilityScore(x, y).score).toBe(0);
    expect(availabilityScore(x, y).reasons[0]).toMatch(/no shared/i);
  });

  it('saturates at full overlap', () => {
    // Default fixture: 5 days x 180 min shared = 900 min, above the 360 cap.
    expect(overlapMinutes(a(), b())).toBe(900);
    expect(availabilityScore(a(), b()).score).toBe(1);
  });

  it('scales linearly below the cap', () => {
    const x = a({ availability: [{ day: 3, start: 1200, end: 1380, tzOffset: 0 }] });
    expect(availabilityScore(x, x).score).toBeCloseTo(180 / FULL_OVERLAP_MINUTES);
  });

  it('does not double-count a player\'s own overlapping windows', () => {
    expect(mergeIntervals([[10, 50], [40, 80], [100, 120]])).toEqual([[10, 80], [100, 120]]);
    const doubled = a({
      availability: [
        { day: 1, start: 1200, end: 1320, tzOffset: 0 },
        { day: 1, start: 1260, end: 1380, tzOffset: 0 },
      ],
    });
    const single = b({ availability: [{ day: 1, start: 1200, end: 1380, tzOffset: 0 }] });
    expect(overlapMinutes(doubled, single)).toBe(180);
  });
});

describe('regionScore', () => {
  it('scores same / different / missing as 1 / 0.5 / 0.8', () => {
    expect(regionScore(a(), b()).score).toBe(1);
    expect(regionScore(a(), b({ region: 'India-West' })).score).toBe(0.5);
    expect(regionScore(a({ region: null }), b()).score).toBe(0.8);
  });
});

describe('pairScore', () => {
  it('uses weights that sum to 1', () => {
    const sum = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('scores two identical, fully compatible players highly', () => {
    const result = pairScore(a({ primaryRole: 'igl' }), b({ primaryRole: 'assaulter' }));
    expect(result.veto).toBeNull();
    // skill 1, role .95, avail 1, comm 1, lang 1, region 1, teamwork .5
    expect(result.score).toBeCloseTo(0.3 + 0.19 + 0.15 + 0.1 + 0.1 + 0.1 + 0.025, 10);
  });

  it('is symmetric', () => {
    const pool = fixturePool(12);
    for (const x of pool) {
      for (const y of pool) {
        expect(pairScore(x, y).score).toBeCloseTo(pairScore(y, x).score, 12);
      }
    }
  });

  it('keeps every component and the total within [0, 1] across a varied pool', () => {
    const pool = fixturePool(40);
    for (const x of pool) {
      for (const y of pool) {
        if (x === y) continue;
        const result = pairScore(x, y);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
        for (const value of Object.values(result.components)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('returns at most three positive and two negative reasons', () => {
    const result = pairScore(
      a({ overallRating: 30, primaryRole: 'sniper' }),
      b({ overallRating: 75, primaryRole: 'sniper', region: 'India-West' }),
    );
    expect(result.reasons.length).toBeLessThanOrEqual(5);
    expect(result.reasons.some((r) => /Both want to play Sniper/.test(r))).toBe(true);
  });
});
