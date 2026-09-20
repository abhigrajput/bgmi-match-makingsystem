/**
 * Zod schemas for everything a player writes about themselves: their profile,
 * their preferences, and their weekly availability windows.
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT FOR
 *
 * Every constraint below already exists in 0001_init.sql as a CHECK, a NOT
 * NULL, or a UNIQUE. The database enforces them against every writer -- this
 * app, the Python ML service, psql, a hand-rolled PostgREST request carrying
 * the anon key that ships to the browser -- and it is the only layer that can
 * make that claim. So nothing here is a safety boundary. Deleting this file
 * would not make a single invalid row writable.
 *
 * What it produces is error messages. A CHECK violation arriving from Postgres
 * is SQLSTATE 23514 carrying a constraint name; rendered honestly that reads
 * `new row for relation "player_availability" violates check constraint
 * "player_availability_window_ordered"`, which tells a player nothing about
 * which of the two time fields to change. Parsing first turns that into "The
 * end time must be after the start time." under the end-time input. The
 * database is the guarantee; this is the sentence.
 *
 * THE TWO ARE KEPT IN SYNC DELIBERATELY. There is no generator and no runtime
 * cross-check -- a schema here that is looser than its CHECK produces a raw
 * 23514 in the UI, and one that is stricter silently rejects rows the database
 * would have accepted, which is worse because nothing reports it. Every schema
 * below names the constraint it mirrors. If you change a CHECK in a migration,
 * change the schema in the same commit; app/(player)/actions.ts maps those
 * constraint names back onto these fields, so a rename in SQL breaks the
 * mapping as well as the rule.
 *
 * Shapes accept what an HTML form posts -- strings for everything, "" for an
 * untouched optional field -- because these are parsed on the far side of a
 * FormData round trip. Coercion and empty-to-null handling live in the schemas
 * rather than in the actions, so the two entry points cannot disagree about
 * what an empty input meant.
 */

import { z } from 'zod';

import { bgmiIgnSchema, displayNameSchema } from '@/lib/validation/auth';
import {
  COMM_PREFERENCES,
  PLAYER_ROLES,
  type CommPreference,
  type PlayerRole,
} from '@/types/database';

// Re-exported rather than redefined. profiles.display_name and profiles.bgmi_ign
// are written by both signup and the profile editor, and two copies of one rule
// drift: signup would accept a name the profile page then refuses to save.
export { bgmiIgnSchema, displayNameSchema };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * An optional free-text field arriving from a form.
 *
 * A form posts "" for an untouched input, and "" is not what the database means
 * by "not set" -- the column is nullable, so absence is NULL. Storing "" adds a
 * third state that reads as present-but-empty everywhere downstream, and
 * `bio ?? '(none)'` then renders a blank line instead of the fallback. Trimmed
 * first, so a field of spaces collapses to NULL too.
 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { message: `${label} must be ${max} characters or fewer.` })
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * A normalized 0-100 axis.
 *
 * Mirrors the `between 0 and 100` CHECKs shared by player_stats' six axes and
 * player_preferences' skill band. `.int()` is not decoration: those columns are
 * `smallint`, so 55.5 is not a range violation but a type error from Postgres
 * -- a different, uglier failure with no constraint name to map.
 *
 * Coerced because `<input type="number">` still posts a string.
 */
const score0to100 = (label: string) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .int({ message: `${label} must be a whole number.` })
    .min(0, { message: `${label} must be at least 0.` })
    .max(100, { message: `${label} must be at most 100.` });

/** UUID, for row identifiers that come back out of a form as hidden fields. */
const uuidSchema = z.uuid({ message: 'Malformed identifier.' });

// ---------------------------------------------------------------------------
// profiles -- the columns a client may write
//
// Exactly five, and the list is not ours to extend: 0003 re-grants column-level
// UPDATE on profiles to (display_name, bgmi_ign, region, avatar_url, bio) and
// nothing else. id, created_at and updated_at are identity and audit fields,
// auth_user_id is account takeover if writable, and is_active is the suspension
// flag -- a user who can set it can un-ban themselves. Adding a sixth key here
// would not grant the privilege; it would turn a save into a 42501.
// ---------------------------------------------------------------------------

/**
 * Coarse server region. Free text in the database on purpose -- BGMI's region
 * list changes faster than a migration cycle, and a bad value degrades matching
 * rather than corrupting it -- so the only rule is a length bound.
 */
export const regionSchema = optionalText(40, 'Region');

export const bioSchema = optionalText(500, 'Bio');

/**
 * No CHECK backs this one.
 *
 * avatar_url is plain nullable text, so the database would accept
 * `javascript:alert(1)` without complaint -- and this value is fed into an
 * `<img src>`, where that scheme is an injection vector on some renderers.
 * React escapes the attribute but does not police the scheme, so restricting it
 * to http/https has to happen somewhere, and this is the only place every write
 * passes through.
 *
 * Called out because it breaks the rule the rest of the file follows: this IS
 * the enforcement, not an error message for an enforcement living elsewhere. If
 * a second writer to avatar_url ever appears, it needs its own copy of the
 * check -- or, better, a CHECK constraint in a migration should replace this.
 */
export const avatarUrlSchema = z
  .string()
  .trim()
  .max(2048, { message: 'Avatar URL must be 2048 characters or fewer.' })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .refine((value) => value === null || /^https?:\/\//i.test(value), {
    message: 'Avatar URL must start with http:// or https://.',
  })
  .refine(
    (value) => {
      if (value === null) return true;
      try {
        // Constructed only to reject what the scheme test let through --
        // "https://" alone passes the regex and is not a URL.
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid avatar URL.' },
  );

/**
 * Mirrors profiles_display_name_not_blank, profiles_bgmi_ign_not_blank, and the
 * UNIQUE on bgmi_ign -- which this schema cannot check and does not try to.
 * Uniqueness is a question about the whole table at an instant, so any answer
 * given here is stale before the UPDATE runs. The constraint decides, and the
 * action maps the resulting 23505 back onto the field.
 */
export const updateProfileSchema = z.object({
  display_name: displayNameSchema,
  bgmi_ign: bgmiIgnSchema,
  region: regionSchema,
  avatar_url: avatarUrlSchema,
  bio: bioSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------
// player_preferences
// ---------------------------------------------------------------------------

/**
 * The two enum columns, built from the runtime arrays in types/database.ts
 * rather than fresh literal lists -- so adding a value to `player_role`
 * propagates to the schema, the select input and the TypeScript union together.
 * A value accepted here but absent from the Postgres type raises 22P02 (invalid
 * input for enum), which carries no constraint name and so cannot be mapped
 * back to a field: another reason not to hand-maintain a second list.
 */
export const playerRoleSchema = z.enum(
  PLAYER_ROLES as unknown as [PlayerRole, ...PlayerRole[]],
  { message: 'Choose a valid role.' },
);

export const commPreferenceSchema = z.enum(
  COMM_PREFERENCES as unknown as [CommPreference, ...CommPreference[]],
  { message: 'Choose a valid communication preference.' },
);

/**
 * secondary_role is genuinely optional, and NULL means "no second role" --
 * which 0001 is explicit is NOT the same as 'flex'. 'flex' is a competence (the
 * player fills whatever the squad lacks); NULL is the absence of a declaration.
 * A form posts "" for the empty option, so "" becomes null before the enum runs
 * -- otherwise every player who leaves it blank gets "Choose a valid role."
 *
 * `preprocess` rather than a union with `z.literal('')`. A union reports its
 * own failure ("Invalid input") instead of the failure of the branch that came
 * closest, so `secondary_role=bogus` would lose "Choose a valid role." --
 * exactly the message this file exists to produce. Normalising the empty case
 * first leaves one schema to fail, with its own words.
 */
export const secondaryRoleSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  playerRoleSchema.nullable(),
);

/**
 * Mirrors player_preferences_max_ping_positive:
 * `max_ping_ms is null or max_ping_ms > 0`.
 *
 * NULL means "no constraint stated", so "" maps to null and not to 0. A stored
 * 0 is a stated constraint nothing can satisfy: the player is never matched,
 * and no error is raised anywhere to say why.
 *
 * The 1000 ceiling is ours, not the database's. Past it the value has stopped
 * being a filter -- no BGMI session is playable at a second of latency -- and
 * is almost always a stray zero.
 *
 * Preprocessed for the same reason as secondary_role above: a union would
 * answer "Invalid input" for `abc`, discarding the branch messages entirely.
 */
export const maxPingSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce
    .number({ message: 'Max ping must be a number.' })
    .int({ message: 'Max ping must be a whole number of milliseconds.' })
    .positive({ message: 'Max ping must be greater than 0.' })
    .max(1000, { message: 'Max ping must be 1000 ms or less.' })
    .nullable(),
);

/**
 * languages is `text[] not null default array['en']`.
 *
 * Accepted as a comma-separated string because that is what one text input
 * posts, and a tag widget is not worth a client bundle for a field most players
 * set once. Blank entries are dropped and duplicates collapsed before the array
 * is built: the column is only ever read as a whole set for an overlap test, so
 * "en,,en" and "en" mean the same thing, and storing the noisy form makes the
 * overlap count wrong.
 */
export const languagesSchema = z
  .string()
  .trim()
  .transform((value) =>
    Array.from(
      new Set(
        value
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ),
  )
  .pipe(
    z
      .array(
        z
          .string()
          .min(2, { message: 'Each language tag needs at least 2 characters.' })
          .max(20, { message: 'Language tags must be 20 characters or fewer.' }),
      )
      // NOT NULL with a default means an omitted array is fine, but an
      // explicitly empty one is a different thing: it leaves the player with no
      // language in common with anybody, which reads downstream as "matches
      // nobody" rather than as a form mistake.
      .min(1, { message: 'List at least one language.' })
      .max(10, { message: 'List 10 languages or fewer.' }),
  );

/**
 * Mirrors, in order:
 *   player_preferences_min_skill_range     min between 0 and 100
 *   player_preferences_max_skill_range     max between 0 and 100
 *   player_preferences_skill_band_ordered  min <= max
 *   player_preferences_roles_distinct      secondary is null or <> primary
 *   player_preferences_max_ping_positive   null or > 0
 *
 * The last two are cross-field, so they are `superRefine` rather than per-field
 * rules -- and each issue is attached to the field the player should change,
 * not to the form. An "invalid preferences" banner over nine inputs is not an
 * error message, it is a scavenger hunt.
 *
 * `wants_ranked` has no constraint to mirror: a checkbox posts "on" when ticked
 * and is absent when not, so the action passes a boolean and this only records
 * the type.
 */
export const preferencesSchema = z
  .object({
    primary_role: playerRoleSchema,
    secondary_role: secondaryRoleSchema,
    comm_preference: commPreferenceSchema,
    min_teammate_skill: score0to100('Minimum teammate skill'),
    max_teammate_skill: score0to100('Maximum teammate skill'),
    wants_ranked: z.boolean(),
    languages: languagesSchema,
    max_ping_ms: maxPingSchema,
  })
  .superRefine((value, ctx) => {
    if (value.min_teammate_skill > value.max_teammate_skill) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_teammate_skill'],
        // An inverted band is not rejected for tidiness. It matches nobody, and
        // at the application layer "matched nobody" is indistinguishable from
        // "nobody is online" -- so the player waits in a queue that can never
        // serve them, with nothing to indicate why.
        message:
          'Maximum teammate skill must be greater than or equal to the minimum.',
      });
    }

    if (
      value.secondary_role !== null &&
      value.secondary_role === value.primary_role
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondary_role'],
        // One competence declared twice is double-counted by role-coverage
        // scoring, so a squad reads as better covered than it is.
        message: 'Your secondary role must differ from your primary role.',
      });
    }
  });

export type PreferencesInput = z.infer<typeof preferencesSchema>;

// ---------------------------------------------------------------------------
// player_availability
// ---------------------------------------------------------------------------

/** Mirrors player_availability_day_range. 0 = Sunday ... 6 = Saturday. */
export const dayOfWeekSchema = z.coerce
  .number({ message: 'Choose a day of the week.' })
  .int({ message: 'Choose a day of the week.' })
  .min(0, { message: 'Choose a day of the week.' })
  .max(6, { message: 'Choose a day of the week.' });

/**
 * Minutes from local midnight. Mirrors player_availability_start_range and
 * player_availability_end_range, both `between 0 and 1440`.
 *
 * 1440 is in range on purpose -- it is how a window says "until local midnight"
 * -- and it is only meaningful as an end value. Nothing forbids it as a start,
 * but the strict ordering rule below makes a start of 1440 unsatisfiable, so
 * the player gets the ordering message instead of a bound message about a
 * number they never thought of as out of bounds.
 */
export const minuteOfDaySchema = (label: string) =>
  z.coerce
    .number({ message: `${label} must be a time.` })
    .int({ message: `${label} must be a whole number of minutes.` })
    .min(0, { message: `${label} must fall within a single day.` })
    .max(1440, { message: `${label} must fall within a single day.` });

/**
 * Mirrors player_availability_tz_offset_range: -720 (UTC-12) to +840 (UTC+14).
 *
 * Stored per row rather than per profile so a window can be normalized to UTC
 * without a named-timezone lookup at read time.
 *
 * The sign convention is the POSTGRES one -- minutes to add to UTC, so UTC+5:30
 * is +330 -- and it is the opposite of JavaScript's `getTimezoneOffset()`,
 * which returns -330 for that same zone. A client filling this field from the
 * browser must negate. Getting it backwards is silent: the value is in range,
 * the window lands eleven hours away, and overlap scoring simply pairs nobody.
 */
export const timezoneOffsetSchema = z.coerce
  .number({ message: 'Timezone offset must be a number.' })
  .int({ message: 'Timezone offset must be a whole number of minutes.' })
  .min(-720, { message: 'Timezone offset must be between UTC-12 and UTC+14.' })
  .max(840, { message: 'Timezone offset must be between UTC-12 and UTC+14.' });

/**
 * One contiguous weekly window.
 *
 * Mirrors player_availability_window_ordered: `start_minute < end_minute`,
 * strictly. A zero-length window is never intentional and contributes nothing
 * but noise to overlap scoring.
 *
 * A window crossing midnight (22:00 -> 02:00) is NOT expressible as one row,
 * and is not made expressible here. 0001 represents it as two rows, which keeps
 * every row a plain interval that overlap logic can treat uniformly. The editor
 * should split it; this schema rejects the single-row form with the ordering
 * message, which says so.
 */
export const availabilityWindowSchema = z
  .object({
    day_of_week: dayOfWeekSchema,
    start_minute: minuteOfDaySchema('Start time'),
    end_minute: minuteOfDaySchema('End time'),
    timezone_offset_minutes: timezoneOffsetSchema,
  })
  .superRefine((value, ctx) => {
    if (value.start_minute >= value.end_minute) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_minute'],
        message:
          'The end time must be after the start time. A window that crosses midnight is entered as two windows.',
      });
    }
  });

export type AvailabilityWindowInput = z.infer<typeof availabilityWindowSchema>;

/**
 * Removing a window takes only its id. The row is not re-validated, and the
 * caller's ownership of it is deliberately not checked here -- it cannot
 * usefully be. The DELETE policy on player_availability restricts the statement
 * to rows whose profile_id is the caller's, so an id belonging to someone else
 * deletes nothing. A check in this layer would be a second opinion on a
 * question the policy has already answered authoritatively.
 */
export const removeAvailabilitySchema = z.object({
  id: uuidSchema,
});

export type RemoveAvailabilityInput = z.infer<typeof removeAvailabilitySchema>;

// ---------------------------------------------------------------------------
// player_stats -- read side only
//
// The 0-100 axes are mirrored here for completeness, and because a formatter or
// a chart wants one name for "this number is on the 0-100 scale". There is no
// write schema, and no action uses one. player_stats is machine-owned: 0003
// grants clients SELECT and nothing else, and the service that writes it holds
// service_role. Phase 6 owns that path.
//
// If a statsSchema for a write ever seems to be missing, the write is the
// mistake, not the schema.
// ---------------------------------------------------------------------------

export const skillAxisSchema = score0to100('Skill score');

export const skillAxesSchema = z.object({
  aim_score: skillAxisSchema,
  game_sense: skillAxisSchema,
  teamwork_score: skillAxisSchema,
  clutch_score: skillAxisSchema,
  consistency_score: skillAxisSchema,
  overall_rating: skillAxisSchema,
});
