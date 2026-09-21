/**
 * Database rows -> PlayerVector. The ONE place that mapping lives, shared by
 * the squad-formation API route and scripts/train.ts, so the model is trained
 * on vectors built exactly the way it is later served them.
 *
 * Defaults for missing rows mirror the 0001 column defaults: a player with no
 * preferences row is treated as flex / voice optional / English / open band,
 * which is what saving the untouched form would store.
 */

import type {
  PlayerAvailability,
  PlayerPreferences,
  PlayerStats,
  Profile,
} from '@/types/database';

import type { PlayerVector } from './types';

export type VectorSource = {
  profile: Pick<Profile, 'id' | 'bgmi_ign' | 'display_name' | 'region'>;
  stats: Pick<
    PlayerStats,
    'overall_rating' | 'aim_score' | 'game_sense' | 'teamwork_score' | 'clutch_score' | 'consistency_score'
  > | null;
  preferences: Pick<
    PlayerPreferences,
    'primary_role' | 'secondary_role' | 'comm_preference' | 'languages' | 'min_teammate_skill' | 'max_teammate_skill'
  > | null;
  availability: Pick<
    PlayerAvailability,
    'day_of_week' | 'start_minute' | 'end_minute' | 'timezone_offset_minutes'
  >[];
  registeredAt?: string;
};

export function toPlayerVector(source: VectorSource): PlayerVector {
  const { profile, stats, preferences, availability } = source;
  return {
    profileId: profile.id,
    ign: profile.bgmi_ign,
    displayName: profile.display_name,
    overallRating: stats?.overall_rating ?? 50,
    axes: {
      aim: stats?.aim_score ?? 50,
      gameSense: stats?.game_sense ?? 50,
      teamwork: stats?.teamwork_score ?? 50,
      clutch: stats?.clutch_score ?? 50,
      consistency: stats?.consistency_score ?? 50,
    },
    primaryRole: preferences?.primary_role ?? 'flex',
    secondaryRole: preferences?.secondary_role ?? null,
    comm: preferences?.comm_preference ?? 'voice_optional',
    languages: preferences?.languages ?? ['en'],
    region: profile.region,
    minSkill: preferences?.min_teammate_skill ?? 0,
    maxSkill: preferences?.max_teammate_skill ?? 100,
    availability: availability.map((w) => ({
      day: w.day_of_week,
      start: w.start_minute,
      end: w.end_minute,
      tzOffset: w.timezone_offset_minutes,
    })),
    registeredAt: source.registeredAt ?? '1970-01-01T00:00:00.000Z',
  };
}
