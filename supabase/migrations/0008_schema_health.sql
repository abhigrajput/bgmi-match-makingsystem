-- 0008_schema_health.sql
--
-- schema_health(): the catalog facts the auth path depends on, readable over
-- REST by the service role.
--
-- Production has no SQL access from this project's tooling (no CLI, psql or
-- pooler; docs/deployment.md), so catalog checks used to mean pasting
-- supabase/tests/phase_b_verify.sql into the SQL Editor by hand. This function
-- returns the few facts that, when wrong, break every signup or open every
-- table, so scripts/verify-prod.ts and scripts/auth-health.ts can check them
-- on every run:
--
--   - handle_new_user() exists, is SECURITY DEFINER, has search_path pinned
--   - the on_auth_user_created trigger exists on auth.users and is enabled
--     (0002 warns it may not survive a restore from backup; on 2026-10-30
--     production was restored from a pause)
--   - every public table has RLS enabled
--   - how many RLS policies exist on public tables
--   - any SECURITY DEFINER function in public without a pinned search_path
--
-- Read-only. Returns catalog metadata, no row data. EXECUTE is revoked from
-- everyone and granted to service_role only, so neither anon nor signed-in
-- users can map the schema through it.
--
-- Safe to run twice.

create or replace function public.schema_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
    select jsonb_build_object(
        'handle_new_user', (
            select jsonb_build_object(
                'exists', true,
                'security_definer', p.prosecdef,
                'search_path_pinned', coalesce(
                    exists (
                        select 1 from unnest(p.proconfig) as c
                        where c like 'search_path=%'
                    ),
                    false
                )
            )
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'handle_new_user'
        ),
        'on_auth_user_created', (
            select jsonb_build_object('exists', true, 'enabled', t.tgenabled <> 'D')
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'auth' and c.relname = 'users'
              and t.tgname = 'on_auth_user_created' and not t.tgisinternal
        ),
        'public_tables', (
            select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
        ),
        'tables_without_rls', (
            select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        ),
        'policy_count', (
            select count(*) from pg_policies where schemaname = 'public'
        ),
        'definer_functions_without_search_path', (
            select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and not coalesce(
                  exists (select 1 from unnest(p.proconfig) as c where c like 'search_path=%'),
                  false
              )
        )
    );
$$;

comment on function public.schema_health() is
    'Catalog facts for health checks (trigger, definer settings, RLS, policy count). Service role only. See 0008.';

revoke execute on function public.schema_health() from public, anon, authenticated;
grant execute on function public.schema_health() to service_role;
