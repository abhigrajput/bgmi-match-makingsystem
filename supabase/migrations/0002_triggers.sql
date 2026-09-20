-- =============================================================================
-- 0002_triggers.sql
-- AI-Powered Skill-Based Multiplayer Team Matching & Squad Recommendation
-- Phase 2, part 1: behaviour. Functions and triggers only.
--
-- STATUS: applied. Run against the Supabase project in Phase 2, together with
-- 0003_rls.sql. Verified by supabase/tests/phase2_verify.sql (object counts)
-- and supabase/tests/0002_ign_collision_test.sql (the bgmi_ign rollback,
-- confirmed against the project's own GoTrue version).
--
-- Depends on: 0001_init.sql (8 tables, 4 enums).
--
-- Contains: set_updated_at() + 8 triggers, handle_new_user() + 1 trigger on
-- auth.users. Contains no RLS -- policies are 0003_rls.sql, and the two are
-- kept apart so a policy mistake can be rolled back without also reverting the
-- updated_at maintenance the whole application depends on.
-- =============================================================================


-- =============================================================================
-- SECTION 1: updated_at MAINTENANCE
--
-- 0001 created updated_at as a plain column with a default. A default only
-- fires on INSERT, so every one of those columns has been frozen at creation
-- time since Phase 1. This section is what makes the column mean what its name
-- says.
--
-- This is done in the database rather than in the Next.js data layer for the
-- same reason the CHECK constraints are: there are two writers. Next.js writes
-- profiles/preferences/queue, the Python ML service writes player_stats, and a
-- third writer (psql, the Supabase table editor, a repair script) shows up the
-- first time something goes wrong. A trigger is the only place that covers all
-- three.
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- Not SECURITY DEFINER: this function needs no privilege the writer does not
-- already hold -- it only rewrites a field of the row being written.
-- search_path is still pinned, because an unpinned search_path in any function
-- is a name-resolution hazard, and now() must resolve to pg_catalog.now().
set search_path = pg_catalog, pg_temp
as $$
begin
    -- Assigned unconditionally rather than coalesced: a client that sends its
    -- own updated_at is overridden on purpose. The column records when the
    -- database accepted the change, not when a caller claims it happened.
    new.updated_at := now();
    return new;
end;
$$;

comment on function public.set_updated_at() is
    'BEFORE UPDATE trigger. Stamps updated_at with server time, overriding any client-supplied value.';


-- Attached to all 8 tables.
--
-- The WHEN clause is the point of interest. Without it, an UPDATE that changes
-- nothing -- a form resubmitted unchanged, an idempotent retry, the matcher
-- re-writing a queue row to the state it already held -- would still move
-- updated_at. That matters because updated_at is the natural cursor for "what
-- changed since I last looked", so a no-op write would manufacture work for the
-- ML service. `old.* is distinct from new.*` compares the whole row, NULL-safe.

create trigger trg_profiles_set_updated_at
    before update on public.profiles
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_player_stats_set_updated_at
    before update on public.player_stats
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_player_preferences_set_updated_at
    before update on public.player_preferences
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_player_availability_set_updated_at
    before update on public.player_availability
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_matches_set_updated_at
    before update on public.matches
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_matchmaking_queue_set_updated_at
    before update on public.matchmaking_queue
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_match_participants_set_updated_at
    before update on public.match_participants
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create trigger trg_match_feedback_set_updated_at
    before update on public.match_feedback
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();


-- =============================================================================
-- SECTION 2: PROFILE PROVISIONING ON SIGNUP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- WHY THIS MUST BE A TRIGGER AND NOT AN API CALL FROM THE CLIENT
--
-- The obvious alternative is: the client calls supabase.auth.signUp(), waits
-- for it to resolve, then calls supabase.from('profiles').insert(...). That
-- design is wrong here for four separate reasons, any one of which is
-- sufficient on its own.
--
-- 1. It is not atomic. signUp() and the insert are two round trips over an
--    unreliable network from a device the server does not control. The user
--    closes the tab, loses signal, or the second request is dropped -- and the
--    account now exists in auth.users with no profiles row. Every query in this
--    application starts from profiles, so that account is a ghost: it can
--    authenticate, and then nothing works. No client-side retry fixes it,
--    because the client may never run again. A trigger runs inside the same
--    transaction as the auth.users insert: either both rows exist or neither
--    does, and a failure rolls the account back rather than stranding it.
--
-- 2. It requires trusting the client with auth_user_id. For the client to
--    insert its own profile, RLS on profiles would need an INSERT policy, and
--    that policy is the entire attack surface: a caller who can insert a
--    profiles row can try to insert one pointing at somebody else's
--    auth_user_id, or insert a second profile for themselves and hold two
--    identities in the matchmaking pool at once. 0003 grants clients no INSERT
--    on profiles at all, which is only possible because this trigger owns the
--    write.
--
-- 3. Email-confirmation signups have no authenticated client at profile
--    creation time. With confirmations enabled, signUp() returns a user with no
--    session. The follow-up insert would run as `anon` and be rejected by any
--    correctly-written policy. The trigger does not care: it runs server-side
--    as the function owner, before any session exists.
--
-- 4. Not every account is created by our client. OAuth callbacks, the Supabase
--    dashboard "Add user" button, an admin API call from a support script --
--    none of them go near our signup form. Only a trigger on auth.users covers
--    every path into the table.
--
-- The cost of this choice is that signup failures surface as database errors
-- from GoTrue rather than as clean field-level validation errors, which is
-- exactly why the bgmi_ign collision below is handled explicitly instead of
-- being left to bubble up as a raw constraint violation.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
-- DEFECT, FIXED IN 0004: the clause the comment below calls mandatory is not
-- in this definition. It was never written, so the function was created
-- SECURITY INVOKER and every signup failed with 42501 (permission denied for
-- table profiles) -- surfacing to the user as "That in-game name is already
-- taken", because GoTrue wraps any exception from this trigger in a generic
-- message the signup action attributes to an IGN collision.
--
-- 0004_handle_new_user_security_definer.sql repairs it with ALTER FUNCTION.
-- This file is left as applied rather than edited, so it continues to match
-- the databases that already ran it; read the two together.
--
-- SECURITY DEFINER is mandatory here, not a convenience. This function is
-- invoked in the transaction that creates the account, at which point the
-- caller is `supabase_auth_admin` -- a role that has no business holding write
-- privileges on public.profiles. Running as the function owner lets the insert
-- succeed without granting the auth subsystem standing access to application
-- tables, and lets it bypass the RLS policies in 0003 that deny INSERT to
-- everyone.
--
-- An explicit search_path is what makes SECURITY DEFINER safe. Without it the
-- caller controls name resolution inside a function running with owner
-- privileges: they create their own `profiles` in a schema earlier on the
-- search_path and this function writes there instead. pg_temp is pinned last so
-- a temp-table shadow cannot win either.
set search_path = public, pg_temp
as $$
declare
    v_display_name text;
    v_bgmi_ign     text;
    v_constraint   text;
begin
    -- ---------------------------------------------------------------------
    -- Metadata extraction.
    --
    -- raw_user_meta_data is whatever the client passed to signUp() in
    -- options.data. It is user-controlled and entirely untrusted: keys may be
    -- missing, may be JSON null, may be empty strings, may be whitespace. Every
    -- read below is defensive, because profiles has NOT NULL plus
    -- length(btrim(...)) > 0 constraints on both columns, and a constraint
    -- violation here aborts the signup.
    -- ---------------------------------------------------------------------

    v_display_name := btrim(coalesce(
        new.raw_user_meta_data ->> 'display_name',
        -- OAuth providers and the Supabase dashboard use these two instead.
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        ''
    ));

    if v_display_name = '' then
        -- Fall back to the local part of the email, then to a generated name.
        -- A weak display name is cosmetic and the user can fix it later; a
        -- failed signup is not.
        v_display_name := btrim(split_part(coalesce(new.email, ''), '@', 1));
    end if;

    if v_display_name = '' then
        v_display_name := 'Player ' || left(replace(new.id::text, '-', ''), 6);
    end if;

    v_bgmi_ign := btrim(coalesce(new.raw_user_meta_data ->> 'bgmi_ign', ''));

    if v_bgmi_ign = '' then
        -- No IGN supplied. This is the admin-created / OAuth path, not our
        -- signup form, which requires the field. A UUID-derived placeholder is
        -- used rather than rejecting the account, because bgmi_ign is UNIQUE
        -- NOT NULL and the profile must exist for the account to be usable at
        -- all. 12 hex characters of a v4 UUID is not a collision risk, and the
        -- `player_` prefix makes these rows trivial to find later.
        v_bgmi_ign := 'player_' || left(replace(new.id::text, '-', ''), 12);
    end if;

    -- ---------------------------------------------------------------------
    -- The insert.
    --
    -- ON CONFLICT (auth_user_id) DO NOTHING makes the trigger idempotent
    -- against the one collision that is never the user's fault: a profile
    -- already attached to this account. That happens if profiles were
    -- backfilled by hand, or if a future auth flow inserts the same user twice.
    -- Doing nothing is correct there -- the desired end state already holds.
    --
    -- It deliberately does NOT swallow the bgmi_ign conflict, handled below.
    -- Those two UNIQUE constraints mean opposite things and must not share an
    -- error path.
    -- ---------------------------------------------------------------------
    begin
        insert into public.profiles (auth_user_id, display_name, bgmi_ign)
        values (new.id, v_display_name, v_bgmi_ign)
        on conflict (auth_user_id) do nothing;

    exception
        when unique_violation then
            get stacked diagnostics v_constraint = constraint_name;

            if v_constraint = 'profiles_bgmi_ign_key' then
                -- -----------------------------------------------------------
                -- THE bgmi_ign COLLISION CASE.
                --
                -- Two players picked the same in-game name. 0001 made bgmi_ign
                -- UNIQUE because it is the key used to reconcile external BGMI
                -- match records back to a profile; a duplicate there does not
                -- merely look untidy, it makes attribution ambiguous. The
                -- constraint is not negotiable.
                --
                -- Three ways to handle it, and the choice matters:
                --
                --   (a) Swallow the error and skip the profile insert.
                --       Rejected: this is precisely the silent failure to
                --       avoid. The account would be created, the user would be
                --       logged in, and every page would break on a missing
                --       profile -- with nothing anywhere saying why.
                --
                --   (b) Auto-rename: append a suffix until the name is free.
                --       Rejected: the user typed a name and would silently be
                --       given a different one. Since bgmi_ign is the key that
                --       matches them to their real in-game identity, a renamed
                --       IGN is a wrong IGN, and they would not find out until
                --       their match imports stopped attributing to them.
                --
                --   (c) Abort the signup with a specific, actionable error.
                --       Chosen. Because this runs inside the auth.users
                --       transaction, RAISE rolls back the account creation too,
                --       so no orphaned auth user is left behind to block a
                --       retry with the same email. The user sees a failure,
                --       picks another IGN, and signs up again.
                --
                -- The signup form should pre-check availability against
                -- profiles -- 0003 grants SELECT on that table to every signed
                -- in user, so the check costs one query -- which turns this
                -- branch from the common case into what it actually is: the
                -- backstop for the race between two people checking the same
                -- free name at the same moment.
                --
                -- errcode 23505 is preserved rather than replaced with a custom
                -- SQLSTATE so the API layer can branch on a standard
                -- unique-violation code instead of matching on message text.
                --
                -- KNOWN GAP: the UNIQUE index from 0001 is case-sensitive, so
                -- 'Sniper' and 'sniper' are distinct IGNs today. Making that
                -- case-insensitive means replacing the constraint with a unique
                -- index on lower(bgmi_ign), which is a schema change and
                -- belongs in its own migration, not in a behaviour migration.
                -- -----------------------------------------------------------
                raise exception
                    'bgmi_ign "%" is already taken', v_bgmi_ign
                    using
                        errcode = '23505',
                        detail  = format(
                            'profiles.bgmi_ign is UNIQUE; signup for auth user %s was rolled back.',
                            new.id
                        ),
                        hint    = 'Choose a different in-game name and sign up again.';
            end if;

            -- Any other unique violation is a bug in this function or an
            -- unexpected constraint, and must not be disguised as an IGN
            -- problem. Re-raise it intact, with its original context.
            raise;
    end;

    return new;
end;
$$;

comment on function public.handle_new_user() is
    'AFTER INSERT trigger on auth.users. Provisions the profiles row inside the signup transaction. See the comment block above the definition for why this is not a client API call.';

-- SECURITY DEFINER functions must never be callable by whoever can reach the
-- database directly. EXECUTE is granted to PUBLIC by default on every new
-- function, so this revoke is load-bearing: without it any authenticated user
-- could call handle_new_user() with a hand-built record and insert a profile
-- attached to an arbitrary auth_user_id -- the exact attack that denying client
-- INSERT on profiles is meant to prevent.
revoke execute on function public.handle_new_user() from public;


-- AFTER INSERT rather than BEFORE: the profiles row carries an FK to
-- auth.users(id), so the auth row must already exist when the insert runs.
-- FOR EACH ROW because provisioning is per-account.
--
-- This trigger lives in the `auth` schema, which is owned by Supabase. It
-- survives normal operation, but it is not guaranteed to survive a project
-- restore from backup -- if signups ever start producing profile-less accounts,
-- check that this trigger still exists before looking anywhere else.
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();


-- =============================================================================
-- END 0002_triggers.sql
--
-- After this migration the database has behaviour but still no access control:
-- RLS is disabled on all 8 tables, so anon and authenticated can read and write
-- everything. 0003_rls.sql closes that. The two are written to be applied
-- together and in order.
-- =============================================================================
