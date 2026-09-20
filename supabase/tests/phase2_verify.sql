-- =============================================================================
-- phase2_verify.sql
--
-- Post-deployment check for 0002_triggers.sql and 0003_rls.sql. Run it in the
-- Supabase SQL Editor AFTER applying both, and read the result grid: every row
-- must say PASS.
--
-- This is not a repeat of 0002_ign_collision_test.sql. That one proves the
-- trigger *behaves* correctly; this one proves the objects actually *landed*.
-- Both matter, and they fail in different ways: a migration can apply without
-- error and still leave a policy uncreated if it was edited between the local
-- run and the deployment.
--
-- Read-only. Creates nothing, changes nothing, and is safe to run against
-- production at any time -- including later, as a drift check, since a restore
-- from backup can silently drop the trigger on auth.users.
--
-- The expected counts below are the ones observed on a clean apply of
-- 0001 + 0002 + 0003. If you add a policy or a table, update them here in the
-- same commit, or this file quietly stops being a check.
-- =============================================================================

with expected(seq, label, expected_count, actual_count) as (

    -- --- structure, from 0001 -------------------------------------------
    select 1, 'Tables in public schema', 8, (
        select count(*)::int from pg_tables where schemaname = 'public'
    )

    -- --- 0002: updated_at maintenance -----------------------------------
    union all
    select 2, 'set_updated_at triggers (one per table)', 8, (
        select count(*)::int
        from pg_trigger
        where not tgisinternal
          and tgname like 'trg\_%\_set\_updated\_at'
    )

    -- --- 0002: profile provisioning -------------------------------------
    union all
    select 3, 'on_auth_user_created trigger on auth.users', 1, (
        select count(*)::int
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal
          and t.tgname = 'on_auth_user_created'
          and n.nspname = 'auth'
          and c.relname = 'users'
    )

    union all
    select 4, 'handle_new_user() is SECURITY DEFINER', 1, (
        select count(*)::int
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'handle_new_user'
          and p.prosecdef
    )

    union all
    select 5, 'Functions with a pinned search_path', 5, (
        -- All five of ours must pin it. An unpinned search_path on a SECURITY
        -- DEFINER function is a privilege-escalation route, not a style point.
        select count(*)::int
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
              'set_updated_at', 'handle_new_user', 'current_profile_id',
              'profile_is_in_match', 'is_match_participant'
          )
          and p.proconfig is not null
          and exists (
              select 1 from unnest(p.proconfig) cfg
              where cfg like 'search\_path=%'
          )
    )

    -- --- 0003: RLS ------------------------------------------------------
    union all
    select 6, 'Tables with RLS enabled', 8, (
        select count(*)::int
        from pg_tables
        where schemaname = 'public' and rowsecurity
    )

    union all
    select 7, 'Total policies', 18, (
        select count(*)::int from pg_policies where schemaname = 'public'
    )

    union all
    select 8, 'Machine-owned tables have zero write policies', 0, (
        -- player_stats, matches and match_participants are service_role-only.
        -- A write policy appearing on any of them is the single most damaging
        -- drift possible here: it would open rating forgery.
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename in ('player_stats', 'matches', 'match_participants')
          and cmd <> 'SELECT'
    )

    union all
    select 9, 'profiles has no INSERT or DELETE policy', 0, (
        -- The trigger owns INSERT; nobody owns DELETE, because a profile
        -- delete CASCADEs away match history and peer feedback.
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'profiles'
          and cmd in ('INSERT', 'DELETE')
    )

    union all
    select 10, 'matchmaking_queue has no UPDATE policy', 0, (
        -- Any UPDATE grant here is an UPDATE grant on `state`, which is the
        -- matcher's concurrency control.
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = 'matchmaking_queue'
          and cmd = 'UPDATE'
    )

    -- --- 0003: table-level privileges, the second layer -----------------
    union all
    select 11, 'anon holds zero privileges on the 8 tables', 0, (
        select count(*)::int
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee = 'anon'
    )

    union all
    select 12, 'authenticated cannot UPDATE profiles.is_active', 0, (
        -- Column-level grant. Not expressible as a policy: if a user can write
        -- this column, suspension is a suggestion.
        select count(*)::int
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'is_active'
          and grantee = 'authenticated'
          and privilege_type = 'UPDATE'
    )

    union all
    select 13, 'authenticated cannot UPDATE profiles.auth_user_id', 0, (
        -- Repointing this at another account is account takeover.
        select count(*)::int
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'auth_user_id'
          and grantee = 'authenticated'
          and privilege_type = 'UPDATE'
    )

    union all
    select 14, 'authenticated CAN UPDATE profiles.display_name', 1, (
        -- The inverse check. Without it, rows 12 and 13 would also pass if the
        -- column grants had been revoked entirely and never re-granted --
        -- locked down, but with a profile nobody can edit.
        select count(*)::int
        from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'display_name'
          and grantee = 'authenticated'
          and privilege_type = 'UPDATE'
    )
)
select
    seq                                                       as "#",
    case when actual_count = expected_count
         then 'PASS' else 'FAIL' end                          as "result",
    label                                                     as "check",
    expected_count                                            as "expected",
    actual_count                                              as "actual"
from expected
order by seq;


-- =============================================================================
-- IF ANY ROW FAILS
--
-- Rows 1-5 failing means 0002 did not fully apply. Re-run it; it is written
-- with `create or replace` on the functions, but the CREATE TRIGGER statements
-- are not idempotent, so drop the named trigger first if it already exists.
--
-- Rows 6-14 failing means 0003 did not fully apply, and the database is open
-- in whatever way the failing row names. Rows 8, 9 and 10 are the severe ones:
-- each names a write path that should not exist. Treat a FAIL there as a live
-- exposure, not a deployment detail.
--
-- Row 7 failing low with rows 8-10 passing usually means a policy later in the
-- file did not run -- check the tail of 0003 (match_feedback) first, since a
-- statement error stops everything after it.
-- =============================================================================
