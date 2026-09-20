-- =============================================================================
-- 0002_ign_collision_test.sql
--
-- Verifies the one claim in 0002_triggers.sql that is load-bearing and not
-- self-evident: when handle_new_user() rejects a duplicate bgmi_ign, the
-- auth.users row that triggered it is rolled back too.
--
-- That claim is the difference between the chosen design and a bug. If the
-- auth row survives the failed profile insert, the outcome is worse than
-- letting the signup through: the email is now taken by an account that has no
-- profile, so the user cannot retry with that address AND cannot use the one
-- they got. Every argument in 0002 for raising instead of auto-renaming
-- depends on this rollback actually happening.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL Editor and run it.
--   Read the result grid at the bottom. Every row must say PASS.
--
-- The script is wrapped in BEGIN ... ROLLBACK, so it writes nothing permanent
-- to your project. It can be run repeatedly and in any environment, including
-- production, without leaving residue.
--
-- WHY THE ASSERTIONS LIVE IN A plpgsql BLOCK
--   The failing INSERT aborts the transaction it runs in. To observe the
--   database state *after* that abort, the failure has to be caught -- and a
--   BEGIN ... EXCEPTION block in plpgsql is a subtransaction, so catching the
--   error rolls back exactly the statement effects under test and leaves the
--   surrounding script alive to inspect them. This is the same rollback
--   machinery that unwinds GoTrue's signup transaction; the only difference is
--   that here something is still standing afterwards to count the rows.
-- =============================================================================

begin;

create temporary table test_results (
    seq      smallint,
    test     text,
    expected text,
    actual   text,
    status   text
) on commit drop;


do $test$
declare
    -- .invalid is reserved by RFC 2606 and can never be a real address, so
    -- this cannot collide with a live account even if the rollback is skipped.
    k_email_taken   constant text := 'ign-collision-taken@example.invalid';
    k_email_free    constant text := 'ign-collision-free@example.invalid';

    -- Suffixed so the arrange step cannot collide with a real player's IGN.
    k_ign_contested constant text := 'CollisionTestIGN_9f3a';
    k_ign_free      constant text := 'CollisionTestIGN_free_9f3a';

    v_uid_collide   constant uuid := '00000000-0000-4000-8000-0000000000c1';
    v_uid_ok        constant uuid := '00000000-0000-4000-8000-0000000000c2';

    v_auth_rows     integer;
    v_profile_rows  integer;
    v_raised        boolean := false;
    v_sqlstate      text    := '(none)';
    v_message       text    := '(none)';
begin

    -- =====================================================================
    -- ARRANGE
    --
    -- A profile already holding the contested IGN. auth_user_id is left NULL,
    -- which 0001 defines as a synthetic seed profile -- the cheapest way to
    -- occupy an IGN without manufacturing a second auth account, and a real
    -- case besides: ML seed profiles hold IGNs that a human may later type.
    -- =====================================================================
    insert into public.profiles (display_name, bgmi_ign)
    values ('Collision Test Holder', k_ign_contested);


    -- =====================================================================
    -- TEST 1 -- POSITIVE CONTROL: the trigger fires at all.
    --
    -- Without this, test 2 passing would be ambiguous: a trigger that was
    -- never installed also creates no profile and also leaves... no, it would
    -- leave the auth row behind and fail test 2. But a trigger that silently
    -- does nothing on every path would still need ruling out, and a signup
    -- that succeeds without provisioning a profile is its own bug.
    -- =====================================================================
    -- The column list is deliberately the minimum that exists in every version
    -- of the auth schema. GoTrue adds columns over time (email_confirmed_at,
    -- phone, banned_until, and more) through its own migrations, so naming any
    -- of them couples this test to a GoTrue version and makes it fail against
    -- a bare Postgres image for a reason that has nothing to do with the
    -- trigger under test. Everything below is load-bearing: the trigger reads
    -- id, email and raw_user_meta_data, and the rest are what make the row a
    -- plausible account.
    insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
    )
    values (
        v_uid_ok, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', k_email_free, 'not-a-real-hash',
        now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', 'Free Name', 'bgmi_ign', k_ign_free)
    );

    select count(*) into v_profile_rows
    from public.profiles
    where auth_user_id = v_uid_ok
      and bgmi_ign     = k_ign_free
      and display_name = 'Free Name';

    insert into test_results values (
        1,
        'Signup with a free IGN provisions exactly one profile, with metadata applied',
        '1',
        v_profile_rows::text,
        case when v_profile_rows = 1 then 'PASS' else 'FAIL' end
    );


    -- =====================================================================
    -- TEST 2 -- THE COLLISION PATH.
    --
    -- Attempt a signup whose bgmi_ign is already held by the arrange row.
    -- Expected: handle_new_user() raises 23505, and the auth.users insert is
    -- undone with it.
    -- =====================================================================
    begin
        insert into auth.users (
            id, instance_id, aud, role, email, encrypted_password,
            created_at, updated_at,
            raw_app_meta_data, raw_user_meta_data
        )
        values (
            v_uid_collide, '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', k_email_taken, 'not-a-real-hash',
            now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', 'Latecomer', 'bgmi_ign', k_ign_contested)
        );
    exception
        when unique_violation then
            v_raised   := true;
            v_sqlstate := sqlstate;
            v_message  := sqlerrm;
    end;

    -- 2a. It raised, and raised the code the API layer is told to branch on.
    insert into test_results values (
        2,
        'Duplicate bgmi_ign raises unique_violation (23505)',
        'raised 23505',
        case when v_raised then 'raised ' || v_sqlstate else 'no exception raised' end,
        case when v_raised and v_sqlstate = '23505' then 'PASS' else 'FAIL' end
    );

    -- 2b. The message identifies the offending IGN rather than leaking a raw
    --     constraint name at the user.
    insert into test_results values (
        3,
        'Error message names the contested IGN',
        'contains ' || quote_literal(k_ign_contested),
        left(v_message, 120),
        case when position(k_ign_contested in v_message) > 0 then 'PASS' else 'FAIL' end
    );

    -- 2c. THE ASSERTION THIS FILE EXISTS FOR.
    --     Zero auth.users rows for that email. If this reports FAIL, the
    --     rollback is not happening and 0002 must change -- see the note at
    --     the bottom of this file.
    select count(*) into v_auth_rows
    from auth.users
    where email = k_email_taken;

    insert into test_results values (
        4,
        'ROLLBACK CHECK: auth.users holds zero rows for the rejected email',
        '0',
        v_auth_rows::text,
        case when v_auth_rows = 0 then 'PASS' else 'FAIL' end
    );

    -- 2d. And no half-written profile either. A profile pointing at an auth
    --     user that no longer exists would be the mirror-image orphan.
    select count(*) into v_profile_rows
    from public.profiles
    where auth_user_id = v_uid_collide;

    insert into test_results values (
        5,
        'No orphaned profile row for the rejected signup',
        '0',
        v_profile_rows::text,
        case when v_profile_rows = 0 then 'PASS' else 'FAIL' end
    );

    -- 2e. The original holder is untouched -- the failed signup must not have
    --     mutated, renamed, or stolen the IGN it collided with.
    select count(*) into v_profile_rows
    from public.profiles
    where bgmi_ign = k_ign_contested
      and display_name = 'Collision Test Holder'
      and auth_user_id is null;

    insert into test_results values (
        6,
        'Existing IGN holder is unmodified',
        '1',
        v_profile_rows::text,
        case when v_profile_rows = 1 then 'PASS' else 'FAIL' end
    );

end;
$test$;


-- =============================================================================
-- RESULTS
-- =============================================================================
select
    seq        as "#",
    status     as "result",
    test       as "assertion",
    expected   as "expected",
    actual     as "actual"
from test_results
order by seq;


-- Nothing above is kept. Re-runnable, including against production.
rollback;


-- =============================================================================
-- IF ROW 4 REPORTS FAIL
--
-- Then the auth.users row survives a rejected signup, and 0002's approach is
-- unsound as written -- not a trade-off, a bug. The failure mode is an account
-- that can authenticate but has no profile, holding an email address its owner
-- cannot re-register. Do not ship it; the fix is a design change in 0002, and
-- the two candidates are:
--
--   * Move provisioning to BEFORE INSERT on auth.users, so the rejection
--     happens before the auth row is written at all.
--   * Keep the trigger but add a reconciliation sweep that deletes auth.users
--     rows with no corresponding profile -- weaker, because it is eventually
--     consistent and the user hits the broken state in the meantime.
--
-- IF ROWS 1-3, 5, 6 REPORT FAIL
--
-- Row 1 failing means the trigger is not installed or not firing: check that
-- `on_auth_user_created` still exists on auth.users, which a project restore
-- from backup can silently drop.
--
-- Row 3 failing with rows 2 and 4 passing is cosmetic -- the rollback works but
-- the message is not the one 0002 writes, which usually means the constraint
-- name check (`profiles_bgmi_ign_key`) missed and the error re-raised through
-- the `raise;` fallthrough instead.
-- =============================================================================
