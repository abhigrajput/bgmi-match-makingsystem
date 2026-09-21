-- =============================================================================
-- 0006_verify.sql -- post-deployment check for 0006_organiser_role.sql.
-- Read-only; every row must say PASS.
-- =============================================================================

with expected(seq, label, expected_count, actual_count) as (

    select 1, 'profiles.is_organiser exists, boolean, not null, default false', 1, (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name = 'is_organiser' and data_type = 'boolean'
          and is_nullable = 'NO' and column_default = 'false'
    )

    union all
    select 2, 'authenticated cannot UPDATE profiles.is_organiser', 0, (
        select case when has_column_privilege('authenticated', 'public.profiles', 'is_organiser', 'update') then 1 else 0 end
    )

    union all
    select 3, 'anon cannot UPDATE profiles.is_organiser', 0, (
        select case when has_column_privilege('anon', 'public.profiles', 'is_organiser', 'update') then 1 else 0 end
    )

    union all
    select 4, 'authenticated cannot INSERT into profiles', 0, (
        select case when has_table_privilege('authenticated', 'public.profiles', 'insert') then 1 else 0 end
    )

    union all
    select 5, 'authenticated CAN still UPDATE profiles.display_name', 1, (
        select case when has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update') then 1 else 0 end
    )
)
select seq, label, expected_count, actual_count,
       case when expected_count = actual_count then 'PASS' else 'FAIL' end as result
from expected
order by seq;
