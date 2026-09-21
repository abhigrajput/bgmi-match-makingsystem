import seedrandom from 'seedrandom';

import type { CommPreference, PlayerRole } from '@/types/database';

import type { PlayerVector } from '../types';

/**
 * A fully compatible default player: mid rating, open band, voice optional,
 * English, India-South, Monday-Friday 20:00-23:00 IST. Tests override only the
 * field under test, so a failure points at that field and nothing else.
 */
export function makePlayer(overrides: Partial<PlayerVector> = {}): PlayerVector {
  const id = overrides.profileId ?? 'p1';
  return {
    profileId: id,
    ign: overrides.ign ?? `ign_${id}`,
    displayName: `Player ${id}`,
    overallRating: 50,
    axes: { aim: 50, gameSense: 50, teamwork: 50, clutch: 50, consistency: 50 },
    primaryRole: 'assaulter',
    secondaryRole: null,
    comm: 'voice_optional',
    languages: ['en'],
    region: 'India-South',
    minSkill: 0,
    maxSkill: 100,
    availability: [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: 1200,
      end: 1380,
      tzOffset: 330,
    })),
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ROLES: PlayerRole[] = ['igl', 'assaulter', 'sniper', 'support', 'flex'];
const COMMS: CommPreference[] = ['voice_required', 'voice_optional', 'text_only', 'silent'];
const LANGS = ['en', 'hi', 'kn', 'ta', 'te', 'mr'];

/**
 * A fixed, deterministic 40-player pool with realistic friction: a spread of
 * ratings, some narrow skill bands, some silent and some voice-required
 * players, and a few who share no language with the majority. Seeded, so the
 * optimizer-vs-baseline assertion runs against the same pool every time.
 */
export function fixturePool(size = 40, seed = 'squad-fixture-v1'): PlayerVector[] {
  const rng = seedrandom(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;

  return Array.from({ length: size }, (_, i) => {
    const rating = Math.round(20 + rng() * 70);
    const primaryRole = pick(ROLES);
    const secondary = rng() < 0.5 ? pick(ROLES.filter((r) => r !== primaryRole)) : null;
    const narrow = rng() < 0.3;
    const langCount = 1 + Math.floor(rng() * 2);
    const languages = rng() < 0.85
      ? ['en', ...Array.from({ length: langCount - 1 }, () => pick(LANGS))]
      : [pick(['ta', 'te', 'mr'])];
    const evening = rng() < 0.85;
    return makePlayer({
      profileId: `f${String(i).padStart(2, '0')}`,
      ign: `fixture_${i}`,
      overallRating: rating,
      axes: {
        aim: rating,
        gameSense: rating,
        teamwork: Math.round(30 + rng() * 60),
        clutch: rating,
        consistency: rating,
      },
      primaryRole,
      secondaryRole: secondary,
      comm: pick(COMMS),
      languages: [...new Set(languages)],
      region: rng() < 0.6 ? 'India-South' : 'India-West',
      minSkill: narrow ? Math.max(0, rating - 15) : 0,
      maxSkill: narrow ? Math.min(100, rating + 15) : 100,
      availability: evening
        ? [{ day: 1 + Math.floor(rng() * 5), start: 1140, end: 1440, tzOffset: 330 }]
        : [{ day: 6, start: 480, end: 720, tzOffset: 330 }],
      registeredAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    });
  });
}
