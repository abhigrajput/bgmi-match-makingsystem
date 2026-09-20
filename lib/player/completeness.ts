/**
 * Profile completeness: which of the two things matchmaking needs are missing.
 *
 * Phase 8 matchmaking needs preferences AND availability. Preferences say what
 * a player will accept; availability says when they can play. A player with
 * neither cannot be matched at all -- not "matched poorly", not matched. The
 * queue would hold them indefinitely while the matcher skips them every pass,
 * and nothing in that loop produces an error anybody sees.
 *
 * So this is not a progress bar for engagement. It is the one warning a player
 * gets before a feature that does not exist yet silently fails to work for
 * them, which is why it is computed here once and shown in both places that can
 * show it rather than being re-derived per page.
 *
 * The profile row itself is deliberately NOT a step. handle_new_user()
 * guarantees it exists with a display_name and an IGN from signup, so it is
 * never missing, and listing a step that is always complete trains people to
 * ignore the indicator.
 */

import type { PlayerPreferences } from '@/types/database';

export type CompletenessStep = {
  key: 'preferences' | 'availability';
  label: string;
  /** What the player loses by leaving it undone. Shown when it is undone. */
  consequence: string;
  href: string;
  done: boolean;
};

export type Completeness = {
  steps: CompletenessStep[];
  /** True only when every step is done -- i.e. this player is matchable. */
  readyToMatch: boolean;
  missingCount: number;
};

export function computeCompleteness(input: {
  preferences: Pick<PlayerPreferences, 'id'> | null;
  availabilityCount: number;
}): Completeness {
  const steps: CompletenessStep[] = [
    {
      key: 'preferences',
      label: 'Set your role and teammate preferences',
      consequence:
        'Without preferences the matcher has no role to fill you into and no skill band to respect.',
      href: '/profile',
      /**
       * Presence of the row is the whole test, and it is enough because 0001
       * gives every column a default: a row that exists is a complete row. The
       * alternative -- checking whether the values differ from the defaults --
       * would mark a player incomplete for deliberately accepting them, which
       * is a legitimate choice and not an omission.
       */
      done: input.preferences !== null,
    },
    {
      key: 'availability',
      label: 'Add at least one weekly availability window',
      consequence:
        'Without a window there are no hours to overlap, so no squad can be formed around you.',
      href: '/profile/availability',
      done: input.availabilityCount > 0,
    },
  ];

  const missingCount = steps.filter((step) => !step.done).length;

  return { steps, missingCount, readyToMatch: missingCount === 0 };
}
