-- =============================================================================
-- 0006_organiser_role.sql
--
-- Adds an organiser role. Only organisers may form squads for a tournament or
-- reset a demo tournament; before this, any signed-in player could, which
-- docs/security.md listed as the main known limitation.
--
-- The role is a column on profiles rather than a separate table because it is
-- one boolean fact about a person and every check that needs it already has
-- the caller's profile row in hand.
--
-- Idempotent, like 0005: safe to paste into the SQL Editor twice.
-- =============================================================================

alter table public.profiles
    add column if not exists is_organiser boolean not null default false;

comment on column public.profiles.is_organiser is
    'May form squads and reset demo tournaments. Granted only by the service role (scripts/set-organiser.ts).';

-- Who can make someone an organiser: nobody but the service role.
--
-- 0003 revoked table-level UPDATE on profiles from `authenticated` and granted
-- UPDATE on five named columns only (display_name, bgmi_ign, region,
-- avatar_url, bio). A column added later is therefore NOT client-writable, and
-- INSERT on profiles is revoked entirely -- so a player cannot promote
-- themselves either by editing their row or by creating a second one. The
-- revoke below restates that for this column explicitly, so a future broad
-- GRANT UPDATE on profiles cannot quietly re-open it without also touching
-- this line. supabase/tests/0006_verify.sql checks it from the catalog.
revoke update (is_organiser) on public.profiles from authenticated, anon;

-- The flag is readable like every other profiles column (0003: SELECT to
-- authenticated), which is intended: players can see who runs a tournament.

-- =============================================================================
-- END 0006_organiser_role.sql
-- =============================================================================
