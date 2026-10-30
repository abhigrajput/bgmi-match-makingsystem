-- 0007_signup_region.sql
--
-- The signup form now asks for a region (launch hardening, 2026-10-30). This
-- redefines handle_new_user() to copy it from raw_user_meta_data into
-- profiles.region. Nothing else about the function changes; read 0002 for the
-- reasoning behind every other line, and 0004 for why SECURITY DEFINER is here.
--
-- CREATE OR REPLACE resets a function's attributes to what the new definition
-- says, so SECURITY DEFINER and the pinned search_path are restated below. If
-- either were left out, signups would fail again exactly as they did before
-- 0004 (42501), or the function would become hijackable through search_path.
-- Grants survive CREATE OR REPLACE; the revoke at the end is restated anyway.
--
-- The role picked at signup is deliberately NOT written here. A
-- player_preferences row is what marks a player matchmaking-ready
-- (lib/player/completeness.ts); creating one at signup would enrol them on
-- defaults they never chose. The role stays in metadata and pre-fills the
-- preferences form instead.
--
-- Safe to run twice. Before it runs, the extra metadata key is ignored.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_display_name text;
    v_bgmi_ign     text;
    v_region       text;
    v_constraint   text;
begin
    v_display_name := btrim(coalesce(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        ''
    ));

    if v_display_name = '' then
        v_display_name := btrim(split_part(coalesce(new.email, ''), '@', 1));
    end if;

    if v_display_name = '' then
        v_display_name := 'Player ' || left(replace(new.id::text, '-', ''), 6);
    end if;

    v_bgmi_ign := btrim(coalesce(new.raw_user_meta_data ->> 'bgmi_ign', ''));

    if v_bgmi_ign = '' then
        v_bgmi_ign := 'player_' || left(replace(new.id::text, '-', ''), 12);
    end if;

    -- New in 0007. Untrusted like every other metadata key: blank becomes
    -- NULL (the column's "not set"), and anything over 40 characters is
    -- dropped rather than truncated, matching the profile form's limit. A bad
    -- region must never abort a signup; the player can set it later.
    v_region := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'region', '')), '');
    if length(v_region) > 40 then
        v_region := null;
    end if;

    begin
        insert into public.profiles (auth_user_id, display_name, bgmi_ign, region)
        values (new.id, v_display_name, v_bgmi_ign, v_region)
        on conflict (auth_user_id) do nothing;

    exception
        when unique_violation then
            get stacked diagnostics v_constraint = constraint_name;

            if v_constraint = 'profiles_bgmi_ign_key' then
                -- Abort the signup (and the auth.users insert with it) with a
                -- specific error. See 0002 for why not swallow or auto-rename.
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

            raise;
    end;

    return new;
end;
$$;

comment on function public.handle_new_user() is
    'AFTER INSERT trigger on auth.users. Provisions the profiles row (display_name, bgmi_ign, region) inside the signup transaction. 0002 explains the design, 0004 the SECURITY DEFINER, 0007 the region.';

revoke execute on function public.handle_new_user() from public;
