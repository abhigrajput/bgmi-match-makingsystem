'use server';

/**
 * Server Actions for the player-owned tables: profiles, player_preferences and
 * player_availability.
 *
 * These are the only client write paths in the phase, and the set is closed on
 * purpose. There is no stats action: player_stats is machine-owned, 0003 grants
 * clients SELECT on it and no policy for anything else, and the process that
 * writes it holds service_role. Phase 6 owns that path -- adding a fourth
 * action here would produce a 42501 at best and a forged skill rating at worst.
 *
 * Every action follows the same three steps, in the same order:
 *
 *   1. Parse with the matching schema in lib/validation/player.ts.
 *   2. Perform the Supabase call, as the signed-in user, under RLS.
 *   3. revalidatePath() the routes whose rendered output the write invalidated.
 *
 * And every action returns rather than throws. A Server Action that throws hands
 * the client a digest -- an opaque hash, with the real message reaching only the
 * server log -- so a throw here is a player staring at "An unexpected error
 * occurred" for a typo in their IGN. The union below carries the message back to
 * the field it belongs under.
 *
 * WHAT RLS DOES AND WHAT THIS FILE DOES
 *
 * The Supabase client from lib/supabase/server.ts authenticates as the user even
 * though it runs on the server: it sends their JWT, and every policy applies.
 * So the ownership rules are not restated here. `update(...).eq('id', profileId)`
 * is how the query says which row it means -- the policy is what guarantees no
 * other row could have been touched had the filter been wrong or absent. The two
 * are not redundant; one is intent, the other is enforcement. No service role
 * key is imported, and none belongs anywhere under app/.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import {
  availabilityWindowSchema,
  preferencesSchema,
  removeAvailabilitySchema,
  updateProfileSchema,
} from '@/lib/validation/player';
import type { UUID } from '@/types/database';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * What every action returns. A discriminated union on `ok`, so a caller that
 * checks `result.ok` gets `error` narrowed into existence and cannot read it on
 * the success branch -- which is the whole reason for the discriminant rather
 * than an optional `error` on one loose object.
 *
 * `fieldErrors` is keyed by form field name so a form can render each message
 * under its input. `error` is always populated on failure, including when
 * fieldErrors is: a caller with nowhere to put per-field messages still has one
 * sentence to show, and a form that silently renders nothing is the failure
 * mode this shape exists to prevent.
 */
export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<string, string[]>>;
    };

/** Small helper so the failure branches below read as one line each. */
function failure(
  error: string,
  fieldErrors?: Partial<Record<string, string[]>>,
): ActionResult {
  return { ok: false, error, fieldErrors };
}

// ---------------------------------------------------------------------------
// Postgres error mapping
// ---------------------------------------------------------------------------

/**
 * Constraint name -> the field it belongs to, and what to say about it.
 *
 * This table is the other half of the sync contract described at the top of
 * lib/validation/player.ts. In the normal case it is unreachable: the schema
 * rejects the same input first, with a better message and without a round trip.
 * It is reached when the two have drifted, when a race beats the parse (the IGN
 * that was free when the form rendered and taken by the time it posted), or when
 * a write arrives from somewhere other than our form.
 *
 * Renaming a constraint in a migration without editing this map does not fail
 * loudly. The entry stops matching, and the player gets the generic fallback
 * instead of the sentence -- a silent degradation, which is why the constraint
 * names are written out in full here rather than matched by prefix.
 */
const CHECK_CONSTRAINT_MESSAGES: Record<
  string,
  { field: string; message: string }
> = {
  profiles_display_name_not_blank: {
    field: 'display_name',
    message: 'Display name cannot be blank.',
  },
  profiles_bgmi_ign_not_blank: {
    field: 'bgmi_ign',
    message: 'In-game name cannot be blank.',
  },

  player_preferences_min_skill_range: {
    field: 'min_teammate_skill',
    message: 'Minimum teammate skill must be between 0 and 100.',
  },
  player_preferences_max_skill_range: {
    field: 'max_teammate_skill',
    message: 'Maximum teammate skill must be between 0 and 100.',
  },
  player_preferences_skill_band_ordered: {
    field: 'max_teammate_skill',
    message:
      'Maximum teammate skill must be greater than or equal to the minimum.',
  },
  player_preferences_roles_distinct: {
    field: 'secondary_role',
    message: 'Your secondary role must differ from your primary role.',
  },
  player_preferences_max_ping_positive: {
    field: 'max_ping_ms',
    message: 'Max ping must be greater than 0, or left blank for no limit.',
  },

  player_availability_day_range: {
    field: 'day_of_week',
    message: 'Choose a day of the week.',
  },
  player_availability_start_range: {
    field: 'start_minute',
    message: 'The start time must fall within a single day.',
  },
  player_availability_end_range: {
    field: 'end_minute',
    message: 'The end time must fall within a single day.',
  },
  player_availability_window_ordered: {
    field: 'end_minute',
    message: 'The end time must be after the start time.',
  },
  player_availability_tz_offset_range: {
    field: 'timezone_offset_minutes',
    message: 'Timezone offset must be between UTC-12 and UTC+14.',
  },
};

/**
 * Unique-violation (23505) messages, keyed by the index name Postgres reports.
 *
 * An inline `unique` on a column produces `<table>_<column>_key`; a named table
 * constraint keeps its own name. Both forms appear below because 0001 uses both.
 */
const UNIQUE_CONSTRAINT_MESSAGES: Record<
  string,
  { field: string; message: string }
> = {
  profiles_bgmi_ign_key: {
    field: 'bgmi_ign',
    message: 'That in-game name is already taken. Choose another one.',
  },
  player_preferences_profile_id_key: {
    field: 'form',
    message: 'Your preferences already exist. Reload the page and try again.',
  },
  player_availability_no_duplicate_window: {
    field: 'form',
    message: 'You already have that exact window on that day.',
  },
};

/** The subset of PostgrestError this file reads. */
type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

/**
 * Pulls the constraint name out of a Postgres error message.
 *
 * PostgREST forwards the message body but not the structured `constraint`
 * field, so the name has to come out of the text -- which for both 23505 and
 * 23514 is the only quoted identifier that matters:
 *
 *   violates check constraint "player_availability_window_ordered"
 *   duplicate key value violates unique constraint "profiles_bgmi_ign_key"
 *
 * `details` is searched as well because Supabase occasionally carries the
 * constraint there while the message stays generic.
 */
function constraintNameFrom(error: PostgrestLikeError): string | null {
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`;
  const match = haystack.match(/constraint "([^"]+)"/);
  // `?? null` rather than a non-null assertion: under noUncheckedIndexedAccess
  // group 1 is `string | undefined` even though a match guarantees it, and the
  // two absent cases mean the same thing to every caller.
  return match?.[1] ?? null;
}

/**
 * Turns a Postgres error into an ActionResult.
 *
 * Only two codes are translated, because only two are things a player can fix:
 *
 *   23505 unique_violation  -- someone else took the value, or you already have
 *                              the row. Actionable: change it.
 *   23514 check_violation   -- a value is out of range. Actionable: correct it.
 *
 * Everything else (42501 insufficient_privilege, 23503 foreign_key_violation,
 * a network failure) is a bug in this app or an outage, not a mistake the
 * player made, and is reported as one generic sentence. The raw message is
 * deliberately not shown: it names tables, columns and policies, which is
 * reconnaissance for anyone probing the write paths, and it is meaningless to
 * everyone else.
 */
function mapPostgresError(
  error: PostgrestLikeError,
  fallback: string,
): ActionResult {
  const constraint = constraintNameFrom(error);

  if (error.code === '23505') {
    const known = constraint
      ? UNIQUE_CONSTRAINT_MESSAGES[constraint]
      : undefined;

    if (known) {
      return known.field === 'form'
        ? failure(known.message)
        : failure(known.message, { [known.field]: [known.message] });
    }

    return failure('That value is already taken. Choose another one.');
  }

  if (error.code === '23514') {
    const known = constraint
      ? CHECK_CONSTRAINT_MESSAGES[constraint]
      : undefined;

    if (known) {
      return failure(known.message, { [known.field]: [known.message] });
    }

    /**
     * A CHECK fired that this file does not know by name. The constraint name is
     * included -- and it is the one place a raw database identifier is shown to
     * a user. That is a deliberate trade: this branch means the schema and the
     * migration have drifted, the player cannot fix it themselves, and the name
     * is the only thing that makes the bug report actionable. It names a rule,
     * not data, so it discloses nothing the migration files do not.
     */
    return failure(
      constraint
        ? `That value is not allowed (${constraint}). Check the highlighted fields.`
        : 'One of those values is not allowed. Check the highlighted fields.',
    );
  }

  return failure(fallback);
}

// ---------------------------------------------------------------------------
// Caller identity
// ---------------------------------------------------------------------------

/**
 * Resolves the signed-in account to its profile id.
 *
 * Needed because player_preferences and player_availability are keyed by
 * profiles.id, not by auth.users.id, and the client only knows the latter. In
 * the database this translation is current_profile_id(); here it is one query,
 * and the two must agree -- a write whose profile_id does not match what the
 * policy computes is rejected by the WITH CHECK, which is the correct outcome
 * but an opaque one.
 *
 * `getUser()` rather than `getSession()`: getSession reads the cookie and trusts
 * it, while getUser revalidates the token against the auth server. For a read
 * that only decides what to render, either would do; for the identity that
 * decides which row gets written, only the verified one is acceptable.
 */
async function resolveProfileId(
  supabase: ReturnType<typeof createClient>,
): Promise<{ profileId: UUID } | { failure: ActionResult }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The middleware should have redirected before the form ever rendered, so
    // reaching this usually means the session expired while the page was open.
    // Said plainly, because "could not save" would send the player looking at
    // their input instead of at the sign-in link.
    return {
      failure: failure('Your session has expired. Sign in again to save.'),
    };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    return { failure: failure('Could not load your profile. Try again.') };
  }

  if (!data) {
    // An authenticated account with no profile row -- the exact state
    // handle_new_user() exists to make impossible. See the same branch in
    // app/dashboard/page.tsx: it points at a missing on_auth_user_created
    // trigger, which a restore from backup can drop silently.
    return {
      failure: failure(
        'No profile exists for this account. Sign out and back in; if it persists, the signup trigger is missing.',
      ),
    };
  }

  return { profileId: data.id };
}

/** Narrows the union above without repeating the `'failure' in x` test. */
function isFailure<T>(
  result: T | { failure: ActionResult },
): result is { failure: ActionResult } {
  return typeof result === 'object' && result !== null && 'failure' in result;
}

// ---------------------------------------------------------------------------
// Revalidation
// ---------------------------------------------------------------------------

/**
 * Every route whose server-rendered output depends on a profile.
 *
 * Profile edits are visible in four places, and missing one leaves a stale name
 * on screen after a save that reported success -- which reads as the save having
 * failed. /players is included because the roster renders display_name and
 * region; the public profile is revalidated by path so only the edited player's
 * page is dropped from the cache rather than the whole segment.
 */
function revalidateProfileViews(profileId: UUID) {
  revalidatePath('/profile');
  revalidatePath('/dashboard');
  revalidatePath('/players');
  revalidatePath(`/players/${profileId}`);
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse({
    display_name: formData.get('display_name') ?? '',
    bgmi_ign: formData.get('bgmi_ign') ?? '',
    region: formData.get('region') ?? '',
    avatar_url: formData.get('avatar_url') ?? '',
    bio: formData.get('bio') ?? '',
  });

  if (!parsed.success) {
    return failure(
      'Check the highlighted fields.',
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = createClient();

  const identity = await resolveProfileId(supabase);
  if (isFailure(identity)) return identity.failure;

  /**
   * Five columns, and no more -- these are exactly the ones 0003 re-granted
   * column-level UPDATE on. Spreading `parsed.data` would work today and break
   * the moment a sixth key is added to the schema, with a 42501 naming a
   * privilege rather than the field.
   */
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: parsed.data.display_name,
      bgmi_ign: parsed.data.bgmi_ign,
      region: parsed.data.region,
      avatar_url: parsed.data.avatar_url,
      bio: parsed.data.bio,
    })
    .eq('id', identity.profileId);

  if (error) {
    return mapPostgresError(error, 'Could not save your profile. Try again.');
  }

  revalidateProfileViews(identity.profileId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// player_preferences
// ---------------------------------------------------------------------------

/**
 * Upsert rather than update, because handle_new_user() provisions a profile row
 * and nothing else -- a player who has never opened this form has no
 * preferences row at all, so the first save is an INSERT and every later one an
 * UPDATE. Both are permitted to the owner by 0003, and the UNIQUE on profile_id
 * from 0001 is what makes onConflict able to tell them apart.
 *
 * Doing this as "select, then insert or update" would be a race: two saves from
 * two tabs both see no row, both insert, and the second gets a 23505 for what
 * the player experiences as saving twice. The upsert resolves that in one
 * statement.
 */
export async function upsertPreferences(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse({
    primary_role: formData.get('primary_role') ?? '',
    secondary_role: formData.get('secondary_role') ?? '',
    comm_preference: formData.get('comm_preference') ?? '',
    min_teammate_skill: formData.get('min_teammate_skill') ?? '',
    max_teammate_skill: formData.get('max_teammate_skill') ?? '',
    // An unchecked checkbox is absent from FormData entirely -- it does not post
    // "false". Presence is the value, and the coercion has to happen here
    // because the schema cannot distinguish "absent" from "absent and unticked".
    wants_ranked: formData.get('wants_ranked') !== null,
    languages: formData.get('languages') ?? '',
    max_ping_ms: formData.get('max_ping_ms') ?? '',
  });

  if (!parsed.success) {
    return failure(
      'Check the highlighted fields.',
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = createClient();

  const identity = await resolveProfileId(supabase);
  if (isFailure(identity)) return identity.failure;

  const { error } = await supabase.from('player_preferences').upsert(
    {
      // Sent explicitly, and it is the value the INSERT policy's WITH CHECK
      // compares against current_profile_id(). A mismatch is a rejection, not a
      // silently misfiled row.
      profile_id: identity.profileId,
      primary_role: parsed.data.primary_role,
      secondary_role: parsed.data.secondary_role,
      comm_preference: parsed.data.comm_preference,
      min_teammate_skill: parsed.data.min_teammate_skill,
      max_teammate_skill: parsed.data.max_teammate_skill,
      wants_ranked: parsed.data.wants_ranked,
      languages: parsed.data.languages,
      max_ping_ms: parsed.data.max_ping_ms,
    },
    { onConflict: 'profile_id' },
  );

  if (error) {
    return mapPostgresError(
      error,
      'Could not save your preferences. Try again.',
    );
  }

  // Preferences are not shown on the public profile -- 0003 scopes SELECT on
  // this table to the owner -- so /players and /players/[id] are not
  // invalidated. Only the two pages that can render them are.
  revalidatePath('/profile');
  revalidatePath('/dashboard');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// player_availability
// ---------------------------------------------------------------------------

export async function addAvailabilityWindow(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = availabilityWindowSchema.safeParse({
    day_of_week: formData.get('day_of_week') ?? '',
    start_minute: formData.get('start_minute') ?? '',
    end_minute: formData.get('end_minute') ?? '',
    // Defaulted to UTC rather than rejected when absent: the column has
    // `default 0`, and a player who never touches the field is stating no
    // offset, which is exactly what 0 means.
    timezone_offset_minutes: formData.get('timezone_offset_minutes') ?? 0,
  });

  if (!parsed.success) {
    return failure(
      'Check the highlighted fields.',
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = createClient();

  const identity = await resolveProfileId(supabase);
  if (isFailure(identity)) return identity.failure;

  const { error } = await supabase.from('player_availability').insert({
    profile_id: identity.profileId,
    day_of_week: parsed.data.day_of_week as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    start_minute: parsed.data.start_minute,
    end_minute: parsed.data.end_minute,
    timezone_offset_minutes: parsed.data.timezone_offset_minutes,
  });

  if (error) {
    return mapPostgresError(error, 'Could not add that window. Try again.');
  }

  revalidatePath('/profile/availability');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Deletes one window by id.
 *
 * No ownership check is performed before the delete, and that is not an
 * oversight. The DELETE policy on player_availability restricts the statement
 * to rows whose profile_id is the caller's, so an id belonging to another
 * player matches nothing and removes nothing. Re-checking here would be a second
 * opinion on a question the policy answers authoritatively -- and a check in
 * this layer is bypassable by anyone posting directly to PostgREST, so it would
 * be the weaker of the two anyway.
 *
 * The consequence is that a delete which affects zero rows is reported as
 * success, because it is indistinguishable from deleting an already-deleted
 * window (two tabs, same button). Both leave the player where they wanted to be:
 * the window is gone.
 */
export async function removeAvailabilityWindow(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = removeAvailabilitySchema.safeParse({
    id: formData.get('id') ?? '',
  });

  if (!parsed.success) {
    return failure('Could not remove that window.');
  }

  const supabase = createClient();

  const { error } = await supabase
    .from('player_availability')
    .delete()
    .eq('id', parsed.data.id);

  if (error) {
    return mapPostgresError(error, 'Could not remove that window. Try again.');
  }

  revalidatePath('/profile/availability');
  revalidatePath('/dashboard');
  return { ok: true };
}
