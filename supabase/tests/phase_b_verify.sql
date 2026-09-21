-- =============================================================================
-- phase_b_verify.sql
--
-- Post-deployment check for 0005_tournaments_and_ml.sql. Run it against the
-- local stack or paste it into the hosted SQL Editor after 0005, and read the
-- result grid: every row must say PASS.
--
-- Catalog reads only. Creates nothing, changes nothing, safe against
-- production. The behavioural half -- that a client really cannot register
-- someone else, or read the view as anon -- is exercised through the REST API
-- by scripts/verify-prod.ts, because only a real JWT exercises a policy the way
-- a real client does.
-- =============================================================================

with expected(seq, label, expected_count, actual_count) as (

    select 1, 'Tables in public schema (8 + 3)', 11, (
        select count(*)::int from pg_tables where schemaname = 'public'
    )

    union all
    select 2, 'tournament_status enum has 4 labels', 4, (
        select count(*)::int
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'tournament_status'
    )

    union all
    select 3, 'tournaments columns', 14, (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public' and table_name = 'tournaments'
    )

    union all
    select 4, 'tournaments slug CHECK + registration-before-start CHECK', 2, (
        select count(*)::int
        from pg_constraint
        where conname in ('tournaments_slug_format', 'tournaments_registration_before_start')
    )

    union all
    select 5, 'One registration per (tournament, player) UNIQUE', 1, (
        select count(*)::int
        from pg_constraint
        where conname = 'tournament_registrations_one_per_player' and contype = 'u'
    )

    union all
    select 6, 'matches gained tournament_id, squad_score_components, reasons', 3, (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public' and table_name = 'matches'
          and column_name in ('tournament_id', 'squad_score_components', 'reasons')
    )

    union all
    select 7, 'is_seed columns (7 existing tables + 2 new)', 9, (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public' and column_name = 'is_seed'
    )

    union all
    select 8, 'guard_is_seed triggers on client-writable tables', 4, (
        select count(*)::int
        from pg_trigger
        where not tgisinternal and tgname like 'trg\_%\_guard\_is\_seed'
    )

    union all
    select 9, 'set_updated_at triggers (8 + tournaments)', 9, (
        select count(*)::int
        from pg_trigger
        where not tgisinternal and tgname like 'trg\_%\_set\_updated\_at'
    )

    union all
    select 10, 'Tables with RLS enabled', 11, (
        select count(*)::int from pg_tables where schemaname = 'public' and rowsecurity
    )

    union all
    select 11, 'Total policies (18 + 5)', 23, (
        select count(*)::int from pg_policies where schemaname = 'public'
    )

    union all
    select 12, 'tournaments + model_versions have zero write policies', 0, (
        -- Both are service-role-only. A write policy here would let a client
        -- open or close registration, or activate a model of its choosing.
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename in ('tournaments', 'model_versions')
          and cmd <> 'SELECT'
    )

    union all
    select 13, 'tournament_registrations: no UPDATE policy', 0, (
        select count(*)::int
        from pg_policies
        where schemaname = 'public' and tablename = 'tournament_registrations'
          and cmd in ('UPDATE', 'ALL')
    )

    union all
    select 14, 'At most one active model (partial unique index)', 1, (
        select count(*)::int from pg_indexes
        where schemaname = 'public' and indexname = 'uq_model_versions_single_active'
    )

    union all
    select 15, 'leaderboard_v exposes exactly 9 columns', 9, (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public' and table_name = 'leaderboard_v'
    )

    union all
    select 16, 'leaderboard_v readable by anon (must be 0)', 0, (
        select case when has_table_privilege('anon', 'public.leaderboard_v', 'select') then 1 else 0 end
    )

    union all
    select 17, 'leaderboard_v readable by authenticated', 1, (
        select case when has_table_privilege('authenticated', 'public.leaderboard_v', 'select') then 1 else 0 end
    )

    union all
    select 18, 'tournaments readable by anon (must be 0)', 0, (
        select case when has_table_privilege('anon', 'public.tournaments', 'select') then 1 else 0 end
    )

    union all
    select 19, 'tournaments insertable by authenticated (must be 0)', 0, (
        select case when has_table_privilege('authenticated', 'public.tournaments', 'insert') then 1 else 0 end
    )

    union all
    select 20, 'public_stats() and analytics_overview() are SECURITY DEFINER', 2, (
        select count(*)::int
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('public_stats', 'analytics_overview')
          and p.prosecdef
    )

    union all
    select 21, 'public_stats() executable by anon', 1, (
        select case when has_function_privilege('anon', 'public.public_stats()', 'execute') then 1 else 0 end
    )

    union all
    select 22, 'analytics_overview() executable by anon (must be 0)', 0, (
        select case when has_function_privilege('anon', 'public.analytics_overview()', 'execute') then 1 else 0 end
    )

    union all
    select 23, 'Functions with a pinned search_path (5 + 3)', 8, (
        select count(*)::int
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
              'set_updated_at', 'handle_new_user', 'current_profile_id',
              'profile_is_in_match', 'is_match_participant',
              'guard_is_seed', 'public_stats', 'analytics_overview'
          )
          and exists (
              select 1 from unnest(p.proconfig) cfg where cfg like 'search\_path=%'
          )
    )

    union all
    select 24, 'guard_is_seed() executable by client roles (must be 0)', 0, (
        select (case when has_function_privilege('anon', 'public.guard_is_seed()', 'execute') then 1 else 0 end)
             + (case when has_function_privilege('authenticated', 'public.guard_is_seed()', 'execute') then 1 else 0 end)
    )
)
select
    seq,
    label,
    expected_count,
    actual_count,
    case when expected_count = actual_count then 'PASS' else 'FAIL' end as result
from expected
order by seq;
