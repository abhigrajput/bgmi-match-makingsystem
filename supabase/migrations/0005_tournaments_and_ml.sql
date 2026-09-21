-- =============================================================================
-- 0005_tournaments_and_ml.sql
--
-- Everything the tournament, squad-formation and ML features need, in ONE
-- migration. Production has no CLI path (see docs/deployment.md): this file is
-- applied locally, verified by supabase/tests/phase_b_verify.sql, and then
-- pasted into the hosted SQL Editor by hand. A second migration would mean a
-- second manual handoff, so this one is designed to be complete up front --
-- including the columns and functions later phases read.
--
-- Contents:
--   1. tournament_status enum
--   2. tournaments, tournament_registrations
--   3. matches: tournament_id, squad_score_components, reasons
--   4. is_seed on seven existing tables + the guard that keeps clients off it
--   5. model_versions
--   6. leaderboard_v (definer view) and public_stats() / analytics_overview()
--   7. RLS, grants, and a comment on every policy naming the attack it blocks
--
-- Idempotent where Postgres allows it (IF NOT EXISTS / OR REPLACE / DROP ...
-- IF EXISTS before CREATE POLICY), so pasting it twice into the SQL Editor is
-- harmless rather than a half-applied error.
-- =============================================================================


-- =============================================================================
-- 1. ENUM
-- =============================================================================

-- draft     -> being set up, invisible to registration
-- open      -> accepting registrations
-- matched   -> squads formed; registration closed by status
-- completed -> tournament over
do $$
begin
    if not exists (select 1 from pg_type where typname = 'tournament_status') then
        create type public.tournament_status as enum ('draft', 'open', 'matched', 'completed');
    end if;
end
$$;


-- =============================================================================
-- 2. TOURNAMENTS
-- =============================================================================

create table if not exists public.tournaments (
    id                      uuid primary key default gen_random_uuid(),
    name                    text not null,
    -- URL key. Constrained to what can sit in a path segment unescaped, so a
    -- slug never needs encoding and two spellings of one URL cannot exist.
    slug                    text not null unique,
    description             text,
    squad_size              smallint not null default 4,
    region                  text,
    starts_at               timestamptz not null,
    registration_closes_at  timestamptz,
    status                  public.tournament_status not null default 'open',

    -- Result of the most recent squad formation: optimizer-vs-baseline
    -- comparison, unmatched players with their blocking rule, scoring source.
    -- Persisted because the Comparison tab and /analytics must show it after
    -- a reload, and recomputing it would re-run formation on today's data
    -- rather than report what actually happened.
    formation_summary       jsonb,
    formed_at               timestamptz,

    is_seed                 boolean not null default false,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),

    constraint tournaments_name_not_blank check (length(btrim(name)) > 0),
    constraint tournaments_slug_format check (slug ~ '^[a-z0-9-]{3,60}$'),
    constraint tournaments_squad_size_range check (squad_size between 2 and 4),
    -- Registration closing after the start would let players join a
    -- tournament already in progress, after squads are formed.
    constraint tournaments_registration_before_start
        check (registration_closes_at is null or registration_closes_at <= starts_at)
);

comment on table public.tournaments is
    'An event players register for. Squads are formed per tournament by /api/tournaments/[slug]/match.';
comment on column public.tournaments.formation_summary is
    'Last formation result (comparison, unmatched + reasons, scoring source). Written by the match route only.';

drop trigger if exists trg_tournaments_set_updated_at on public.tournaments;
create trigger trg_tournaments_set_updated_at
    before update on public.tournaments
    for each row when (old.* is distinct from new.*)
    execute function public.set_updated_at();

create index if not exists idx_tournaments_status on public.tournaments (status);


create table if not exists public.tournament_registrations (
    id              uuid primary key default gen_random_uuid(),
    tournament_id   uuid not null references public.tournaments (id) on delete cascade,
    profile_id      uuid not null references public.profiles (id) on delete cascade,
    -- Role the player wants in THIS tournament; NULL = use their preference.
    desired_role    public.player_role,
    registered_at   timestamptz not null default now(),
    is_seed         boolean not null default false,

    -- One seat per player per tournament. This is what turns a double-clicked
    -- Register button into a 23505 ("You're already registered") instead of
    -- the same player appearing twice in the formation pool.
    constraint tournament_registrations_one_per_player
        unique (tournament_id, profile_id)
);

comment on table public.tournament_registrations is
    'Who entered which tournament. The input pool for squad formation.';

-- The UNIQUE above already gives an index led by tournament_id; this second
-- one exists because the spec asks for both explicitly, and a single-column
-- index is what the planner reaches for on the registration-count query.
create index if not exists idx_tournament_registrations_tournament_id
    on public.tournament_registrations (tournament_id);
create index if not exists idx_tournament_registrations_profile_id
    on public.tournament_registrations (profile_id);


-- =============================================================================
-- 3. MATCHES: link to tournaments, keep the explanation
-- =============================================================================

alter table public.matches
    add column if not exists tournament_id uuid
        references public.tournaments (id) on delete set null;
-- Per-component scores (skill, role, availability ...) behind synergy_score.
alter table public.matches
    add column if not exists squad_score_components jsonb;
-- Human-readable "why this squad" lines, stored as produced at formation time.
alter table public.matches
    add column if not exists reasons text[];

create index if not exists idx_matches_tournament_id on public.matches (tournament_id);


-- =============================================================================
-- 4. is_seed: mark synthetic rows so they can be removed without touching
--    anything a real person created
-- =============================================================================

alter table public.profiles            add column if not exists is_seed boolean not null default false;
alter table public.player_stats        add column if not exists is_seed boolean not null default false;
alter table public.player_preferences  add column if not exists is_seed boolean not null default false;
alter table public.player_availability add column if not exists is_seed boolean not null default false;
alter table public.matches             add column if not exists is_seed boolean not null default false;
alter table public.match_participants  add column if not exists is_seed boolean not null default false;
alter table public.match_feedback      add column if not exists is_seed boolean not null default false;

-- Clients must never be able to set is_seed. scripts/seed.ts deletes seed rows
-- on every run, so a player who flagged their own preferences row is_seed=true
-- would have it wiped by the next reseed -- and so, by extension, could any
-- user who found the column. Four tables accept client writes (preferences,
-- availability, feedback, registrations); on those, a trigger pins the value
-- for the two client roles. A column-level REVOKE cannot do this: those tables
-- carry table-level INSERT/UPDATE grants, and column revokes do not subtract
-- from a table grant. The service role is untouched, which is the seeder.
create or replace function public.guard_is_seed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            new.is_seed := false;
        else
            new.is_seed := old.is_seed;
        end if;
    end if;
    return new;
end;
$$;

comment on function public.guard_is_seed() is
    'BEFORE INSERT/UPDATE trigger. Stops client roles from setting is_seed, which would expose their rows to the seed reset.';

drop trigger if exists trg_player_preferences_guard_is_seed on public.player_preferences;
create trigger trg_player_preferences_guard_is_seed
    before insert or update on public.player_preferences
    for each row execute function public.guard_is_seed();

drop trigger if exists trg_player_availability_guard_is_seed on public.player_availability;
create trigger trg_player_availability_guard_is_seed
    before insert or update on public.player_availability
    for each row execute function public.guard_is_seed();

drop trigger if exists trg_match_feedback_guard_is_seed on public.match_feedback;
create trigger trg_match_feedback_guard_is_seed
    before insert or update on public.match_feedback
    for each row execute function public.guard_is_seed();

drop trigger if exists trg_tournament_registrations_guard_is_seed on public.tournament_registrations;
create trigger trg_tournament_registrations_guard_is_seed
    before insert or update on public.tournament_registrations
    for each row execute function public.guard_is_seed();


-- =============================================================================
-- 5. MODEL VERSIONS
-- =============================================================================

create table if not exists public.model_versions (
    id                  uuid primary key default gen_random_uuid(),
    version             text not null unique,
    algorithm           text not null,
    trained_at          timestamptz not null default now(),
    n_train             integer,
    n_test              integer,
    -- Test-set metrics, baseline metrics and |standardised coefficient| per
    -- feature, exactly as scripts/train.ts computed them. jsonb because the
    -- metric set is owned by the training script, not by the schema.
    metrics             jsonb,
    baselines           jsonb,
    feature_importance  jsonb,
    is_active           boolean not null default false,
    created_at          timestamptz not null default now()
);

comment on table public.model_versions is
    'One row per training run. is_active marks the model the app scores with. Written only by scripts/train.ts.';

-- At most one active model. Without this, a crash between "activate new" and
-- "deactivate old" leaves two, and "the active model's metrics" is ambiguous.
create unique index if not exists uq_model_versions_single_active
    on public.model_versions (is_active) where is_active;


-- =============================================================================
-- 6. READ SURFACES
-- =============================================================================

-- leaderboard_v
--
-- Why a view: the leaderboard needs every player's primary role, and 0003
-- scopes player_preferences SELECT to the owner -- deliberately, because the
-- skill band and comms settings are strategic. primary_role on its own is not:
-- it is what a squad-mate sees in game anyway. A definer view (owner postgres,
-- security_invoker off) lets the leaderboard read exactly that one column
-- through the owner's privileges while the table's policy stays closed.
-- Nothing else from preferences, and nothing from availability, is selected.
create or replace view public.leaderboard_v
with (security_invoker = false)
as
select
    p.id               as profile_id,
    p.display_name,
    p.bgmi_ign,
    p.region,
    pp.primary_role,
    s.overall_rating,
    s.kd_ratio,
    s.win_rate,
    s.matches_played
from public.profiles p
left join public.player_stats s        on s.profile_id = p.id
left join public.player_preferences pp on pp.profile_id = p.id
where p.is_active;

alter view public.leaderboard_v owner to postgres;

comment on view public.leaderboard_v is
    'Public-to-authenticated leaderboard. Exposes primary_role and nothing else from player_preferences.';


-- public_stats(): three counts for the anonymous landing page.
--
-- SECURITY DEFINER because anon has no SELECT on profiles or matches and must
-- not get one. The function returns aggregate integers only, so granting it to
-- anon publishes "how many" and nothing about "who".
create or replace function public.public_stats()
returns table (players bigint, tournaments bigint, squads_formed bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        (select count(*) from public.profiles where is_active),
        (select count(*) from public.tournaments where status <> 'draft'),
        (select count(*) from public.matches);
$$;

comment on function public.public_stats() is
    'Landing-page counts. Definer, aggregate-only, granted to anon.';


-- analytics_overview(): everything /analytics charts, aggregated in SQL.
--
-- The page runs under the user's JWT, and matches/match_feedback are visible
-- only to their participants -- so a client-side aggregate would chart one
-- player's own matches and call it "the platform". The service role is not
-- allowed in pages (only scripts/ and API routes), so the aggregate is done
-- here, as definer, returning counts and averages only: no ids, no names, no
-- per-player rows.
create or replace function public.analytics_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'players',          (select count(*) from public.profiles where is_active),
        'tournaments',      (select count(*) from public.tournaments),
        'squads',           (select count(*) from public.matches),
        'tournament_squads',(select count(*) from public.matches where tournament_id is not null),
        'feedback',         (select count(*) from public.match_feedback),
        'avg_synergy',      (select round(avg(synergy_score)::numeric, 1) from public.matches where synergy_score is not null),
        'ml_share',         (select round(avg(case when scoring_source = 'ml' then 1.0 else 0.0 end), 3)
                               from public.matches where tournament_id is not null),
        'rating_histogram', (
            select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) order by bucket), '[]'::jsonb)
            from (
                select least(width_bucket(overall_rating, 0, 100, 10), 10) as bucket, count(*) as n
                from public.player_stats
                where last_computed_at is not null
                group by 1
            ) h
        ),
        'role_distribution', (
            select coalesce(jsonb_agg(jsonb_build_object('role', primary_role, 'count', n) order by primary_role), '[]'::jsonb)
            from (
                select primary_role, count(*) as n
                from public.player_preferences
                group by 1
            ) r
        ),
        'feedback_distribution', (
            select coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'count', n) order by rating), '[]'::jsonb)
            from (
                select rating, count(*) as n
                from public.match_feedback
                group by 1
            ) f
        ),
        'formations', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'name', name,
                       'slug', slug,
                       'formed_at', formed_at,
                       'comparison', formation_summary -> 'comparison'
                   ) order by formed_at desc), '[]'::jsonb)
            from public.tournaments
            where formation_summary is not null
        )
    );
$$;

comment on function public.analytics_overview() is
    'Aggregate-only analytics for /analytics. Definer so it can count across matches the caller did not play in.';


-- =============================================================================
-- 7. ROW-LEVEL SECURITY AND GRANTS
--
-- Same model as 0003: grants decide which statements a role may attempt at
-- all; policies decide which rows those statements may touch. Supabase's
-- default privileges hand ALL on every new public object to anon and
-- authenticated, so each new object below is narrowed explicitly.
-- =============================================================================

alter table public.tournaments              enable row level security;
alter table public.tournament_registrations enable row level security;
alter table public.model_versions           enable row level security;

revoke all on public.tournaments, public.tournament_registrations, public.model_versions
    from anon;
-- Tournaments and model versions are written only by the service role (the
-- match route, the seeder, the trainer). Registrations accept INSERT and
-- DELETE from their owner; never UPDATE, so a registration cannot be moved to
-- a different tournament or player after the policies have checked it.
revoke insert, update, delete on public.tournaments    from authenticated;
revoke insert, update, delete on public.model_versions from authenticated;
revoke update on public.tournament_registrations        from authenticated;

grant select on public.tournaments, public.tournament_registrations, public.model_versions
    to authenticated;
grant insert, delete on public.tournament_registrations to authenticated;


-- ---- tournaments -----------------------------------------------------------

-- Blocks: anonymous enumeration of events. Tournaments are visible to signed-in
-- players only; anon holds the public key, so "readable by anon" would mean
-- readable by any script on the internet.
drop policy if exists tournaments_select_authenticated on public.tournaments;
create policy tournaments_select_authenticated
    on public.tournaments
    for select
    to authenticated
    using (true);


-- ---- tournament_registrations ---------------------------------------------

-- Blocks: nothing sensitive leaks -- a registration is (tournament, player,
-- desired role), and the whole point of a tournament page is showing who has
-- entered. Anonymous reads are still refused (no policy for anon).
drop policy if exists tournament_registrations_select_authenticated on public.tournament_registrations;
create policy tournament_registrations_select_authenticated
    on public.tournament_registrations
    for select
    to authenticated
    using (true);

-- Blocks: (a) registering SOMEONE ELSE -- profile_id must be the caller's own
-- profile, so a player cannot enrol a rival into a tournament they did not
-- choose; (b) registering into a closed, matched or draft tournament by calling
-- PostgREST directly and skipping the UI's disabled button; (c) registering
-- after the deadline, checked against the database clock rather than the
-- client's.
drop policy if exists tournament_registrations_insert_own_open on public.tournament_registrations;
create policy tournament_registrations_insert_own_open
    on public.tournament_registrations
    for insert
    to authenticated
    with check (
            profile_id = (select public.current_profile_id())
        and exists (
                select 1
                from public.tournaments t
                where t.id = tournament_registrations.tournament_id
                  and t.status = 'open'
                  and now() < coalesce(t.registration_closes_at, t.starts_at)
            )
    );

-- Blocks: (a) deleting another player's registration to knock them out of a
-- tournament; (b) withdrawing after squads were formed, which would leave a
-- formed squad pointing at a player who is no longer registered.
drop policy if exists tournament_registrations_delete_own_open on public.tournament_registrations;
create policy tournament_registrations_delete_own_open
    on public.tournament_registrations
    for delete
    to authenticated
    using (
            profile_id = (select public.current_profile_id())
        and exists (
                select 1
                from public.tournaments t
                where t.id = tournament_registrations.tournament_id
                  and t.status = 'open'
            )
    );


-- ---- model_versions --------------------------------------------------------

-- Blocks: anonymous scraping of model internals. Signed-in players may read
-- metrics (the analytics page shows them); writes have no policy and no grant,
-- so only the service role -- which bypasses RLS -- can insert or activate a
-- model. A client that could flip is_active could pin the app to a model of
-- its choosing.
drop policy if exists model_versions_select_authenticated on public.model_versions;
create policy model_versions_select_authenticated
    on public.model_versions
    for select
    to authenticated
    using (true);


-- ---- view and functions ----------------------------------------------------

-- The view runs with its owner's privileges, so its grant IS its access
-- control: authenticated only, read only. Revoking from anon is not optional
-- here -- a definer view granted to anon would publish every player's role to
-- the internet, around the policies entirely.
revoke all on public.leaderboard_v from anon, public;
revoke insert, update, delete on public.leaderboard_v from authenticated;
grant select on public.leaderboard_v to authenticated, service_role;

-- Functions are executable by PUBLIC by default in Postgres, and Supabase's
-- default privileges ALSO grant EXECUTE to anon and authenticated directly --
-- so revoking from PUBLIC alone leaves anon able to call a definer function.
-- Each is revoked from all three and then granted back to exactly the roles
-- that need it.
revoke execute on function public.public_stats()       from public, anon, authenticated;
revoke execute on function public.analytics_overview() from public, anon, authenticated;
revoke execute on function public.guard_is_seed()      from public, anon, authenticated;

grant execute on function public.public_stats()       to anon, authenticated, service_role;
grant execute on function public.analytics_overview() to authenticated, service_role;


-- =============================================================================
-- END 0005_tournaments_and_ml.sql
-- =============================================================================
