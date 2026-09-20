-- =============================================================================
-- 0003_rls.sql
-- AI-Powered Skill-Based Multiplayer Team Matching & Squad Recommendation
-- Phase 2, part 2: access control.
--
-- STATUS: applied. Run against the Supabase project in Phase 2, immediately
-- after 0002_triggers.sql. Verified by supabase/tests/phase2_verify.sql, whose
-- checks 6-14 assert both that the policies exist and that the write paths
-- this file withholds are still absent.
--
-- RLS is live from this migration onward: the anon key can no longer read or
-- write freely, and any process that needs to bypass policy -- the matcher,
-- the ML service -- must authenticate as service_role.
--
-- Depends on: 0001_init.sql (tables), 0002_triggers.sql (handle_new_user owns
-- the profiles INSERT that this file denies to clients).
--
-- Enables RLS on all 8 tables and installs the policy set. Nothing in this file
-- changes structure or behaviour -- it only decides who may see and write what.
--
-- -----------------------------------------------------------------------------
-- THE THREAT MODEL THIS FILE IS WRITTEN AGAINST
--
-- The Supabase anon key ships to the browser. It is not a secret and cannot be
-- treated as one: anyone with the site open has it, and can issue any PostgREST
-- request they like with their own session token attached, from curl, with no
-- involvement from our UI. So every check in the Next.js layer -- every
-- `if (row.profile_id !== me) return` -- is a convenience for honest users and
-- nothing more. RLS is the only enforcement boundary that a hostile client
-- cannot route around, which is why the rules below are stated here and not in
-- the data layer.
--
-- Two roles matter:
--   authenticated -- a signed-in user, holding a JWT. auth.uid() is their
--                    auth.users id. Subject to every policy below.
--   service_role  -- the FastAPI ML service and any server-side job. Holds
--                    BYPASSRLS, so policies do not apply to it at all. "Writes
--                    are service_role only" below therefore means "no write
--                    policy exists for clients", not "a policy names
--                    service_role".
--
-- `anon` (signed out) is given nothing. Matchmaking is a signed-in activity,
-- and a player roster readable without an account is a scraping target.
--
-- FORCE ROW LEVEL SECURITY is deliberately not used. It would apply policies to
-- the table owner as well, which would lock the migration/maintenance role out
-- of its own tables for no security gain -- the owner can disable RLS at will
-- anyway.
-- =============================================================================


-- =============================================================================
-- SECTION 1: HELPER FUNCTIONS
--
-- Policies are re-evaluated per row. Repeating the auth.uid() -> profiles.id
-- lookup inline in twenty policies would mean twenty copies of one rule, and
-- the day that rule changes, nineteen of them get updated and one does not.
-- These three functions are the single definition point.
--
-- All three are SECURITY DEFINER. That is not about convenience -- it is what
-- makes them usable inside policies at all:
--
--   * current_profile_id() reads profiles. Calling it from a policy ON profiles
--     would re-enter that policy, which re-calls the function: infinite
--     recursion, and Postgres raises 42P17 rather than answering. A DEFINER
--     function runs as the owner, who bypasses RLS, so the inner read is not
--     policy-checked and the recursion never starts. The same applies to
--     profile_is_in_match() and match_participants.
--
--   * They also let a policy see rows the caller cannot. is_match_participant()
--     must be able to answer "is this person in that match?" without the caller
--     already having permission to read the match -- which is the very question
--     being asked.
--
-- All three are STABLE (same answer within one statement, so the planner may
-- cache the result instead of calling once per row) and pin search_path, for
-- the reasons given in 0002.
-- =============================================================================

-- The auth.uid() -> profiles.id translation, in one place.
--
-- Returns NULL when signed out, or when a signed-in account somehow has no
-- profile. NULL is the safe answer: every policy below compares a column
-- against this value, and `column = NULL` is NULL, which RLS treats as "deny".
-- A missing profile therefore fails closed rather than opening anything up.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    -- auth.uid() is wrapped in a scalar subquery so the planner evaluates it
    -- once as an InitPlan rather than per row. On a table scan behind a policy
    -- this is the difference between one call and one call per candidate row.
    select p.id
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
    limit 1;
$$;

comment on function public.current_profile_id() is
    'Maps the JWT subject to profiles.id. Returns NULL when signed out, which makes every policy that uses it fail closed.';


-- "Was this profile in that match?" -- the membership primitive.
-- Split out from is_match_participant() because match_feedback needs to ask it
-- about the ratee, not only about the caller.
create or replace function public.profile_is_in_match(
    p_match_id   uuid,
    p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
        from public.match_participants mp
        where mp.match_id   = p_match_id
          and mp.profile_id = p_profile_id
    );
$$;

comment on function public.profile_is_in_match(uuid, uuid) is
    'Membership test against match_participants, RLS-exempt so it can be used to decide RLS.';


-- "Am I in that match?" -- the form used by almost every policy below.
create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select public.profile_is_in_match(p_match_id, public.current_profile_id());
$$;

comment on function public.is_match_participant(uuid) is
    'True when the calling user was seated in the given match. The visibility rule for matches and match_participants.';


-- EXECUTE is granted to PUBLIC by default on every function. These three are
-- SECURITY DEFINER, so that default is revoked and the grant made explicit.
-- They are safe to call -- they leak only booleans and the caller's own profile
-- id -- but a DEFINER function should never be reachable by a role that was not
-- deliberately given it.
revoke execute on function public.current_profile_id()                from public;
revoke execute on function public.profile_is_in_match(uuid, uuid)     from public;
revoke execute on function public.is_match_participant(uuid)          from public;

grant execute on function public.current_profile_id()                 to authenticated, service_role;
grant execute on function public.profile_is_in_match(uuid, uuid)      to authenticated, service_role;
grant execute on function public.is_match_participant(uuid)           to authenticated, service_role;


-- =============================================================================
-- SECTION 2: ENABLE RLS
--
-- Enabled on all 8 tables before any policy is created. With RLS on and no
-- policy, a table denies everything to non-bypassing roles -- so this statement
-- ordering means the database is never briefly open with policies half-applied.
-- Default-deny is the whole point: a table added in a later migration that
-- nobody remembers to write policies for is inaccessible, not public.
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.player_stats        enable row level security;
alter table public.player_preferences  enable row level security;
alter table public.player_availability enable row level security;
alter table public.matches             enable row level security;
alter table public.matchmaking_queue   enable row level security;
alter table public.match_participants  enable row level security;
alter table public.match_feedback      enable row level security;


-- =============================================================================
-- SECTION 3: TABLE-LEVEL PRIVILEGES
--
-- RLS filters rows within a privilege the role already holds; it is not the
-- privilege itself. Supabase grants anon and authenticated broad table
-- privileges in the public schema by default, and relies entirely on RLS to
-- constrain them. That is one layer. This section adds a second: where a role
-- has no business performing an operation at all, the GRANT is removed, so the
-- request fails on privilege before RLS is ever consulted.
--
-- The practical value is failure mode. If a policy below is ever dropped by
-- accident, a table whose INSERT grant was also revoked stays closed instead of
-- silently becoming writable.
-- =============================================================================

-- anon is signed out. It gets nothing anywhere.
revoke all on public.profiles,
              public.player_stats,
              public.player_preferences,
              public.player_availability,
              public.matches,
              public.matchmaking_queue,
              public.match_participants,
              public.match_feedback
    from anon;

-- Machine-owned tables: authenticated may read, never write. The write path for
-- all four is service_role.
revoke insert, update, delete on public.player_stats       from authenticated;
revoke insert, update, delete on public.matches            from authenticated;
revoke insert, update, delete on public.match_participants from authenticated;

-- profiles: the trigger owns INSERT, nobody owns DELETE.
revoke insert, delete on public.profiles from authenticated;

-- Column-level UPDATE on profiles. RLS decides which row you may update;
-- this decides which columns, and there is no way to express that in a policy.
-- Re-granting an explicit list is what keeps three columns out of reach:
--
--   id, created_at, updated_at -- identity and audit fields; updated_at is
--                                 maintained by the 0002 trigger.
--   auth_user_id               -- repointing this at another account is
--                                 account takeover, plainly stated.
--   is_active                  -- the suspension flag. If a user can write it,
--                                 suspension is a suggestion: a banned account
--                                 flips its own is_active back to true and
--                                 rejoins the queue. Only service_role clears
--                                 a suspension.
revoke update on public.profiles from authenticated;
grant  update (display_name, bgmi_ign, region, avatar_url, bio)
    on public.profiles to authenticated;

-- matchmaking_queue: no UPDATE for clients at any column. See the policy
-- comments in section 8 for why.
revoke update on public.matchmaking_queue from authenticated;

-- match_feedback: written once, never edited or withdrawn by the rater.
revoke update, delete on public.match_feedback from authenticated;


-- =============================================================================
-- SECTION 4: profiles
--
-- Public read, own-row update, no client insert, no client delete.
-- =============================================================================

-- Blocks: nothing -- this is the deliberate opening in the model.
-- Matchmaking cannot work without it: to show a recommended squad, the client
-- must read display_name, bgmi_ign, region and avatar_url for four people the
-- user has never met. Scoping this to "profiles you already share a match with"
-- would make recommendation impossible, since the recommendation is what
-- creates the relationship.
--
-- What keeps it safe is what is NOT in this table. 0001 put no email, no phone,
-- no auth credentials here -- those live in auth.users, which is not exposed --
-- so the worst outcome of a full read is a list of public gamer handles.
--
-- "Public" throughout this file means visible to every OTHER AUTHENTICATED
-- USER. It never means anonymous. That distinction is the entire content of the
-- `TO authenticated` clause below: an anon roster read is a scraping surface --
-- the whole player list, handles and regions, harvestable by anyone who can
-- type a URL, with no account behind the request. Requiring a session does not
-- stop a determined scraper, but it makes scraping cost an identity that can be
-- revoked, and it keeps the roster out of reach of anyone who merely found the
-- anon key in the page source.
create policy profiles_select_authenticated
    on public.profiles
    for select
    to authenticated
    using (true);

-- Blocks: editing another player's profile. Without USING, any signed-in user
-- could rewrite anyone's display_name or bgmi_ign -- and since bgmi_ign is the
-- reconciliation key for imported BGMI match records, stealing a rival's IGN
-- would misattribute their match history to the attacker.
--
-- WITH CHECK is not redundant with USING here, and omitting it is the classic
-- mistake. USING selects which rows may be updated; WITH CHECK validates the
-- row that results. With USING alone, a user could update their own row and set
-- auth_user_id to someone else's account -- permitted, because the check runs
-- against the pre-update row. WITH CHECK re-evaluates current_profile_id()
-- against the new row and rejects it. The column-level grant in section 3 is
-- the belt to this policy's braces.
create policy profiles_update_own
    on public.profiles
    for update
    to authenticated
    using      (id = (select public.current_profile_id()))
    with check (id = (select public.current_profile_id()));

-- No INSERT policy. Blocks: self-provisioning a second identity, and
-- provisioning a profile pointed at somebody else's auth_user_id. The 0002
-- trigger is the only writer, and it runs SECURITY DEFINER so it is unaffected
-- by this absence. See the comment block in 0002 for the full argument.

-- No DELETE policy. Blocks: evidence removal. A profile delete CASCADEs to
-- match_participants and to every match_feedback row where this player is the
-- rater or the ratee -- so a player who collected bad peer ratings could erase
-- them, and their squadmates' feedback, by deleting their profile. 0001 chose
-- soft deletion via is_active precisely to avoid this; denying DELETE is the
-- half of that decision that has to live in the policy layer.


-- =============================================================================
-- SECTION 5: player_stats
--
-- Public read, no client write at all. The ML service owns this table.
-- =============================================================================

-- Blocks: nothing. The skill vector has to be readable to render a
-- recommendation -- "this squad is balanced" is unreadable without the numbers
-- behind it. The rating is a competitive fact about a player, not a secret.
-- "Public" here carries the same meaning as on profiles above: every other
-- authenticated user, never an anonymous caller.
create policy player_stats_select_authenticated
    on public.player_stats
    for select
    to authenticated
    using (true);

-- No INSERT, UPDATE or DELETE policy, and the grants are revoked in section 3.
--
-- Blocks: rating forgery, which is the single highest-value attack against a
-- skill-based matchmaker. If a client could write here it could set its own
-- overall_rating to 100 to be matched with top players, or to 20 to be matched
-- with beginners it can farm -- and because 0001 stores overall_rating rather
-- than computing it, nothing downstream would notice. It could also write
-- matches_won > matches_played, which the CHECK constraint catches, or a
-- plausible-but-false kd_ratio, which nothing catches.
--
-- The deeper reason is ownership: player_stats is derived data. Its only
-- correct writer is the process that derives it from match outcomes. A row
-- written by anyone else is not merely wrong, it is unfalsifiable -- there is
-- no input it can be recomputed from. The FastAPI service holds service_role
-- and writes it; the browser never does.


-- =============================================================================
-- SECTION 6: player_preferences
--
-- Full CRUD, own row only.
-- =============================================================================

-- Blocks: reading another player's declared intent. Preferences are the one
-- part of the model that is strategic rather than factual -- min/max teammate
-- skill and comm_preference reveal what a player will accept. Readable, they
-- let someone tune their own declared band to guarantee being matched with a
-- specific person, which is queue manipulation. They are also not needed to
-- render anyone else's profile: the recommender reads them server-side.
create policy player_preferences_select_own
    on public.player_preferences
    for select
    to authenticated
    using (profile_id = (select public.current_profile_id()));

-- Blocks: creating a preferences row that belongs to another player. Without
-- the check, a user could insert preferences under a rival's profile_id and
-- steer who that rival gets matched with -- or, given the UNIQUE constraint on
-- profile_id from 0001, squat the row so the rival can never create their own.
create policy player_preferences_insert_own
    on public.player_preferences
    for insert
    to authenticated
    with check (profile_id = (select public.current_profile_id()));

-- Blocks: rewriting another player's preferences, and reassigning your own row
-- to another profile_id. USING guards which row; WITH CHECK guards the result,
-- so the row cannot be updated out from under its owner into someone else's
-- name.
create policy player_preferences_update_own
    on public.player_preferences
    for update
    to authenticated
    using      (profile_id = (select public.current_profile_id()))
    with check (profile_id = (select public.current_profile_id()));

-- Blocks: deleting another player's preferences. The damage is quiet rather
-- than loud -- the victim's row reverts to absent, the matcher falls back to
-- defaults, and they are silently matched against criteria they never chose.
create policy player_preferences_delete_own
    on public.player_preferences
    for delete
    to authenticated
    using (profile_id = (select public.current_profile_id()));


-- =============================================================================
-- SECTION 7: player_availability
--
-- Full CRUD, own rows only. Same shape as preferences, and for the same
-- reasons; the difference is that this table is 1:N, so a hostile insert adds a
-- row rather than colliding with one.
-- =============================================================================

-- Blocks: harvesting when a specific named player is online. This table is a
-- weekly schedule tied to a real person, which is the closest thing to
-- personal-safety-relevant data in the schema. It is a stalking aid if public,
-- and it is never needed client-side: overlap scoring runs server-side.
create policy player_availability_select_own
    on public.player_availability
    for select
    to authenticated
    using (profile_id = (select public.current_profile_id()));

-- Blocks: writing availability windows into another player's schedule. The
-- attack is queue steering -- inject a window matching your own, and the
-- overlap scorer starts pairing you with a target who never opted in.
create policy player_availability_insert_own
    on public.player_availability
    for insert
    to authenticated
    with check (profile_id = (select public.current_profile_id()));

-- Blocks: editing another player's windows, and moving one of your rows onto
-- another profile.
create policy player_availability_update_own
    on public.player_availability
    for update
    to authenticated
    using      (profile_id = (select public.current_profile_id()))
    with check (profile_id = (select public.current_profile_id()));

-- Blocks: deleting a rival's availability to remove them from the pool during
-- the hours you want to play -- a denial of service against one player,
-- invisible to them because the absence of a row looks exactly like never
-- having set one.
create policy player_availability_delete_own
    on public.player_availability
    for delete
    to authenticated
    using (profile_id = (select public.current_profile_id()));


-- =============================================================================
-- SECTION 8: matchmaking_queue
--
-- SELECT / INSERT / DELETE own rows. No client UPDATE -- the matcher owns every
-- state transition.
-- =============================================================================

-- Blocks: reading the live pool. Visible, the queue is a scouting feed --
-- an attacker watches who is waiting and with what skill band, then enqueues
-- with a band tuned to land in a specific person's squad. Own-row only also
-- keeps pool size private, which is otherwise a free signal about how easy the
-- matcher currently is to game.
create policy matchmaking_queue_select_own
    on public.matchmaking_queue
    for select
    to authenticated
    using (profile_id = (select public.current_profile_id()));

-- Blocks: enqueueing somebody else. Without the check, a user could insert a
-- queue row for a rival and -- because 0001 makes profile_id UNIQUE -- prevent
-- that player from ever joining the queue themselves, or drag them into a
-- squad they never asked for.
--
-- Note what this policy does NOT attempt: min_skill / max_skill are accepted as
-- given. Clients can lie about their own band, and RLS is the wrong tool to
-- stop that -- a policy cannot compare an inserted value against player_stats
-- without leaking, per row, whether the comparison passed. Validating the band
-- against the player's real rating belongs to the enqueue path in the matcher.
create policy matchmaking_queue_insert_own
    on public.matchmaking_queue
    for insert
    to authenticated
    with check (profile_id = (select public.current_profile_id()));

-- Blocks: cancelling another player's queue entry -- a one-click denial of
-- service against a specific person, repeatable every time they re-queue.
--
-- DELETE, not UPDATE-to-'cancelled', is how a client leaves the queue. That
-- costs the "intent vs outcome" history 0001 wanted to retain for cancelled
-- rows; the trade is accepted because granting UPDATE to reach the 'cancelled'
-- state would grant UPDATE to reach every state (see below).
--
-- TODO Phase 8: replace with cancel_queue_entry() RPC owned by the matcher,
-- to retain cancelled-state history.
-- RLS grants per-table, not per-column or per-transition.
create policy matchmaking_queue_delete_own
    on public.matchmaking_queue
    for delete
    to authenticated
    using (profile_id = (select public.current_profile_id()));

-- No UPDATE policy, and the grant is revoked in section 3.
--
-- Blocks: forging a state transition. `state` is the concurrency control for
-- the entire matcher -- 0001 introduced 'matching' specifically so two matcher
-- passes cannot claim the same player. A client that can write `state` can
-- write itself back from 'matching' to 'waiting' mid-pass and be claimed twice,
-- landing in two squads at once; or write 'matched' with a matched_match_id
-- pointing at a squad it was never assigned to, seating itself in someone
-- else's game.
--
-- There is no narrower policy that helps, because RLS cannot constrain which
-- columns an UPDATE touches or which transitions are legal -- it only chooses
-- rows. Any UPDATE grant here is an UPDATE grant on `state`. Everything a
-- client legitimately needs is covered by DELETE plus a fresh INSERT.


-- =============================================================================
-- SECTION 9: matches and match_participants
--
-- SELECT if the requester was a participant. All writes service_role only.
-- =============================================================================

-- Blocks: enumerating every match in the system. A match is a private event
-- between four people; there is no product reason for a fifth to read its
-- synergy_score, its timeline, or its scoring_source. The scoring_source column
-- in particular is internal provenance -- knowing which squads got 'rule_based'
-- instead of 'ml' tells an attacker exactly when the fallback path was live and
-- the matcher was at its most predictable.
create policy matches_select_participant
    on public.matches
    for select
    to authenticated
    using (public.is_match_participant(id));

-- No INSERT / UPDATE / DELETE policy, grants revoked in section 3.
--
-- Blocks: manufacturing match history. A client that could insert matches could
-- fabricate completed games -- which is the input side of the stats pipeline
-- and, through match_feedback, of the training labels. It could also set
-- status = 'completed' on a live match to unlock feedback early, or rewrite
-- synergy_score to poison the model's evaluation against outcomes it never
-- produced. The matcher holds service_role and owns all of it.

-- Blocks: discovering who plays with whom. The participant list is the social
-- graph of the application. Readable in full, it answers "which squads was this
-- person in, and with whom" for every user -- and it is the join that would
-- turn the intentionally-public profiles table into a map of real-world
-- associations. Scoped here to squads the requester was actually in.
--
-- Note this is a self-referential question -- "may I read match_participants?"
-- is answered by reading match_participants -- which is exactly why
-- is_match_participant() is SECURITY DEFINER. A plain subquery here would
-- recurse into this policy and fail with 42P17.
create policy match_participants_select_participant
    on public.match_participants
    for select
    to authenticated
    using (public.is_match_participant(match_id));

-- No INSERT / UPDATE / DELETE policy, grants revoked in section 3.
--
-- Blocks: seating yourself in a squad you were not assigned to, and promoting
-- yourself with is_leader. Insert access here is also a route into the stats
-- pipeline: add yourself to a stranger's completed high-performing match and
-- inherit its outcome. UPDATE would additionally allow rewriting assigned_role
-- after the fact, which 0001 stores specifically because the gap between
-- preferred and assigned role is a training signal -- a rewritable signal is
-- not a signal.


-- =============================================================================
-- SECTION 10: match_feedback
--
-- INSERT only as yourself, only on a completed match you played in. SELECT the
-- ratings you wrote and the ratings you received.
-- =============================================================================

-- Blocks, in three clauses, three different attacks:
--
--   rater_profile_id = current_profile_id()
--       Impersonation. Without it, a user submits feedback under someone
--       else's name -- both to praise themselves through a sock puppet and to
--       make an innocent player appear to have left an abusive rating.
--
--   is_match_participant(match_id)
--       Drive-by rating. Without it, any signed-in user could rate any player
--       in any match they were never part of. Since match_feedback is the
--       supervised training target for the recommender, this is not just
--       harassment -- it is direct write access to the model's labels by
--       anyone with an account.
--
--   matches.status = 'completed'
--       Pre-emptive rating. Without it, feedback could be filed on a 'forming'
--       or 'in_progress' match -- rating a teammate before playing with them,
--       which is by construction not feedback. It also keeps the label aligned
--       with the outcome it is supposed to describe. Read through the DEFINER
--       helper rather than a bare subquery on matches: the requester can see
--       the match under the section 9 policy, but relying on that would couple
--       this policy's correctness to that one's.
--
-- A fourth clause -- the ratee must also have been in the match -- closes the
-- last gap: rating a real player who was never in your squad. 0001's CHECK
-- already blocks self-rating, and the UNIQUE constraint already blocks
-- ballot-stuffing the same pair twice, so neither is restated here.
create policy match_feedback_insert_as_rater
    on public.match_feedback
    for insert
    to authenticated
    with check (
            rater_profile_id = (select public.current_profile_id())
        and public.is_match_participant(match_id)
        and public.profile_is_in_match(match_id, ratee_profile_id)
        and exists (
                select 1
                from public.matches m
                where m.id = match_feedback.match_id
                  and m.status = 'completed'
            )
    );

-- Blocks: reading feedback about other people. Unrestricted, this table is a
-- reputation database -- every rating anyone ever gave anyone, queryable by
-- handle. Scoped to rows the requester wrote or received, so a player can see
-- what they said and what was said about them, and nothing else.
--
-- This deliberately exposes the rater's identity on received ratings: feedback
-- here is not anonymous. That is a product decision with a real cost -- players
-- who know they are identifiable rate more kindly, which biases the training
-- label toward the ceiling. The alternative, hiding rater_profile_id, cannot be
-- done in a policy (RLS filters rows, not columns) and would need a view. Worth
-- revisiting before the model is trained on this data in earnest.
create policy match_feedback_select_own
    on public.match_feedback
    for select
    to authenticated
    using (
           rater_profile_id = (select public.current_profile_id())
        or ratee_profile_id = (select public.current_profile_id())
    );

-- No UPDATE policy, grant revoked in section 3.
--
-- Blocks: retroactive label rewriting. 0001 anticipated resubmission as an
-- UPDATE, but a training label that the subject's peers can revise after the
-- fact is not a label -- a player who is told about a bad rating can pressure
-- the rater into editing it. Correcting a genuinely mis-submitted rating is a
-- support action through service_role, which is rare and auditable.

-- No DELETE policy, grant revoked in section 3.
--
-- Blocks: withdrawing a rating you no longer like the look of, and -- more to
-- the point -- deleting the negative feedback you received. Feedback is
-- immutable once written, which is the only property that makes it evidence.


-- =============================================================================
-- END 0003_rls.sql
--
-- Coverage check -- every table has RLS on, and every operation is accounted
-- for either by a policy or by a deliberate absence:
--
--   table                | select        | insert    | update    | delete
--   ---------------------+---------------+-----------+-----------+----------
--   profiles             | authenticated | trigger   | own row   | denied
--   player_stats         | authenticated | denied    | denied    | denied
--   player_preferences   | own           | own       | own       | own
--   player_availability  | own           | own       | own       | own
--   matchmaking_queue    | own           | own       | denied    | own
--   matches              | participant   | denied    | denied    | denied
--   match_participants   | participant   | denied    | denied    | denied
--   match_feedback       | own edges     | rater+    | denied    | denied
--
-- "denied" means no policy exists, which under RLS is a denial, not an
-- oversight. service_role bypasses all of it and performs every write marked
-- denied above.
--
-- NOT COVERED BY THIS FILE, and worth stating plainly:
--   * Clients may still lie about values within their own rows -- a queue entry
--     can claim any skill band, a profile can claim any region. RLS answers
--     "whose row is this", never "is this value true". Value validation is the
--     matcher's job.
--   * No rate limiting. A user can join and leave the queue in a tight loop.
--   * player_stats has no client write path at all, so the ML service must be
--     reachable for ratings to ever change. That is intended.
-- =============================================================================
