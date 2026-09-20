-- =============================================================================
-- phase3_verify.sql
--
-- Post-deployment check for the assumptions Phase 3 APPLICATION code makes
-- about the database. Run it against the local stack or the Supabase SQL
-- Editor and read the result grid: every row must say PASS.
--
-- It is a different kind of check from phase2_verify.sql. That file proves the
-- Phase 2 objects landed. This one proves that the names and privileges the
-- Next.js layer was written against are still the ones the database has --
-- because Phase 3 added two files that encode those names:
--
--   lib/validation/player.ts    mirrors each CHECK, to produce a readable
--                               message instead of a raw 23514.
--   app/(player)/actions.ts     maps constraint NAMES back onto form fields.
--
-- That mapping is a string match. Rename a constraint in a later migration and
-- nothing fails loudly: the lookup misses, and the player gets a generic
-- fallback instead of the sentence that tells them which field to fix. This
-- file is what makes that failure loud.
--
-- Phase 3 adds no migration. Every object checked here was created by
-- 0001-0003; what is new is that application code now depends on their names.
--
-- Read-only. Creates nothing, changes nothing, safe against production.
--
-- WHAT THIS FILE CANNOT CHECK: that each zod schema agrees with the CHECK it
-- mirrors. Proving that needs values pushed through both layers, not a catalog
-- read. The bound here is that the constraints still exist under the names the
-- code knows; the bounds themselves are kept in sync by hand, in one commit,
-- as lib/validation/player.ts says at the top.
-- =============================================================================

with
-- Every constraint name keyed in CHECK_CONSTRAINT_MESSAGES in actions.ts.
-- Kept in the same order as that table, so the two can be read side by side.
expected_checks(name) as (
    values
        ('profiles_display_name_not_blank'),
        ('profiles_bgmi_ign_not_blank'),
        ('player_preferences_min_skill_range'),
        ('player_preferences_max_skill_range'),
        ('player_preferences_skill_band_ordered'),
        ('player_preferences_roles_distinct'),
        ('player_preferences_max_ping_positive'),
        ('player_availability_day_range'),
        ('player_availability_start_range'),
        ('player_availability_end_range'),
        ('player_availability_window_ordered'),
        ('player_availability_tz_offset_range')
),

-- Every name keyed in UNIQUE_CONSTRAINT_MESSAGES. Two are implicit names
-- Postgres generated for an inline `unique` (<table>_<column>_key); the third
-- was named explicitly in 0001. Both forms are matched the same way, which is
-- the point -- the code cannot tell them apart either.
expected_uniques(name) as (
    values
        ('profiles_bgmi_ign_key'),
        ('player_preferences_profile_id_key'),
        ('player_availability_no_duplicate_window')
),

results(seq, label, expected_count, actual_count) as (

    -- --- the constraint names the error mapping depends on ----------------
    -- Counted as a group first, so a single missing name is visible at a
    -- glance; the per-name breakdown at the bottom of this file says which.
    select 1, 'CHECK constraints named by actions.ts', 12, (
        select count(*)::int
        from expected_checks e
        join pg_constraint c on c.conname = e.name
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' and c.contype = 'c'
    )

    union all
    select 2, 'UNIQUE constraints named by actions.ts', 3, (
        select count(*)::int
        from expected_uniques e
        join pg_constraint c on c.conname = e.name
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' and c.contype = 'u'
    )

    -- --- player_stats stays machine-owned ---------------------------------
    -- The single most important invariant in Phase 3, and the reason there is
    -- no stats action. If a client write path ever appears here, a player can
    -- forge their own skill rating -- and because 0001 STORES overall_rating
    -- rather than computing it, nothing downstream would notice.
    union all
    select 3, 'player_stats client write policies (must be 0)', 0, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'player_stats'
          and cmd <> 'SELECT'
    )

    union all
    select 4, 'player_stats write grants to authenticated (must be 0)', 0, (
        select count(*)::int
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'player_stats'
          and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    )

    -- --- the five writable profile columns --------------------------------
    -- updateProfile() writes exactly these and names them one by one rather
    -- than spreading the parsed object. This asserts the other side of that:
    -- that the grant still covers five columns and no more. A sixth would mean
    -- is_active or auth_user_id became client-writable, which is self-unbanning
    -- and account takeover respectively.
    union all
    select 5, 'profiles column-level UPDATE grants to authenticated', 5, (
        select count(*)::int
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'profiles'
          and grantee = 'authenticated'
          and privilege_type = 'UPDATE'
          and column_name in
              ('display_name', 'bgmi_ign', 'region', 'avatar_url', 'bio')
    )

    union all
    select 6, 'profiles UPDATE grants outside those five (must be 0)', 0, (
        select count(*)::int
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'profiles'
          and grantee = 'authenticated'
          and privilege_type = 'UPDATE'
          and column_name not in
              ('display_name', 'bgmi_ign', 'region', 'avatar_url', 'bio')
    )

    -- --- the policies the pages were written against ----------------------
    -- /players renders a roster of strangers, which only works because the
    -- profiles SELECT policy is open to every authenticated user.
    union all
    select 7, 'profiles SELECT policy for authenticated', 1, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'profiles'
          and cmd = 'SELECT'
    )

    -- Full CRUD own-row on both player-owned tables: upsertPreferences needs
    -- INSERT and UPDATE, the availability editor needs INSERT and DELETE, and
    -- every page read needs SELECT.
    union all
    select 8, 'player_preferences policies (SELECT/INSERT/UPDATE/DELETE)', 4, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public' and tablename = 'player_preferences'
    )

    union all
    select 9, 'player_availability policies (SELECT/INSERT/UPDATE/DELETE)', 4, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public' and tablename = 'player_availability'
    )

    -- The roster shows role only for the signed-in player. That is not a UI
    -- choice -- it is this policy being owner-scoped. If preferences ever
    -- become publicly readable, /players should be revisited deliberately, and
    -- this row is where that change announces itself.
    union all
    select 10, 'player_preferences SELECT is owner-scoped, not public', 1, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'player_preferences'
          and cmd = 'SELECT'
          and qual like '%current_profile_id%'
    )

    union all
    select 11, 'player_availability SELECT is owner-scoped, not public', 1, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'player_availability'
          and cmd = 'SELECT'
          and qual like '%current_profile_id%'
    )

    -- --- enum vocabularies the forms are built from -----------------------
    -- PLAYER_ROLES and COMM_PREFERENCES in types/database.ts populate the
    -- selects, and ROLE_LABELS / COMM_LABELS are total Records over them. A
    -- value added to the Postgres type but not to those arrays is an option
    -- the form never offers; one removed is a label for a value that no longer
    -- exists.
    union all
    select 12, 'player_role enum values', 5, (
        select count(*)::int
        from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'player_role'
    )

    union all
    select 13, 'comm_preference enum values', 4, (
        select count(*)::int
        from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'comm_preference'
    )
)

select
    seq                                              as "#",
    label                                            as "check",
    expected_count                                   as "expected",
    actual_count                                     as "actual",
    case when expected_count = actual_count
         then 'PASS' else 'FAIL' end                 as "result"
from results

union all

-- Per-name breakdown, so a failure on row 1 or 2 says which constraint is
-- missing instead of only that one is. Rows appear only when something is
-- absent: on a healthy database this section is empty.
select
    100,
    'MISSING CHECK constraint: ' || e.name,
    1,
    0,
    'FAIL'
from expected_checks e
where not exists (
    select 1
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.conname = e.name and n.nspname = 'public' and c.contype = 'c'
)

union all

select
    101,
    'MISSING UNIQUE constraint: ' || e.name,
    1,
    0,
    'FAIL'
from expected_uniques e
where not exists (
    select 1
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.conname = e.name and n.nspname = 'public' and c.contype = 'u'
)

order by 1, 2;

-- =============================================================================
-- END phase3_verify.sql
--
-- 13 checks, plus a per-name breakdown that stays empty while everything is
-- present. If you add a policy, a constraint, or an enum value, update the
-- expected counts here in the same commit -- otherwise this file quietly stops
-- being a check, which is the failure mode phase2_verify.sql warns about too.
-- =============================================================================
