-- =============================================================================
-- 0001_init.sql
-- AI-Powered Skill-Based Multiplayer Team Matching & Squad Recommendation
-- Phase 1 initial schema.
--
-- STATUS: written, NOT executed. Do not run this against a live project until
--         the schema in docs/database.md has been reviewed and signed off.
--
-- Contains: 4 enum types, 8 tables, FK indexes, CHECK constraints.
-- Contains no RLS policies, no triggers, no functions, no seed data --
-- behaviour is out of scope for Phase 1 and would need its own migration.
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on PG13 and is built in from PG14.
-- The extension is requested explicitly so the migration is portable across
-- both, and IF NOT EXISTS keeps it a no-op on Supabase where it is preinstalled.
create extension if not exists "pgcrypto";


-- =============================================================================
-- SECTION 1: ENUM TYPES
--
-- These are modelled as enums rather than text + CHECK because all four are
-- closed vocabularies owned by the application, not user data. An enum gives a
-- single definition point, and adding a value later is a one-line ALTER TYPE.
-- The trade-off accepted here: values cannot be removed or reordered without a
-- type rewrite. That is acceptable for sets this stable.
-- =============================================================================

-- BGMI squad roles. 'flex' is not "unassigned" -- it is a distinct competence
-- (a player who can fill whatever the squad is missing) and the scorer treats
-- it as such. Absence of a role is expressed by NULL, never by 'flex'.
create type player_role as enum (
    'igl',        -- in-game leader: shotcalling, rotations
    'assaulter',  -- entry fragger
    'sniper',     -- long-range / DMR
    'support',    -- utility, revives, resupply
    'flex'        -- fills whichever slot the squad lacks
);

-- Lifecycle of one matchmaking_queue row.
--   waiting   -> entered the pool, not yet under consideration
--   matching  -> claimed by a matcher pass, provisionally being grouped
--   matched   -> a match was formed; matched_match_id is now set
--   cancelled -> the player withdrew
--   expired   -> expires_at passed before a squad could be formed
-- 'matching' exists as a distinct state so two concurrent matcher passes cannot
-- both claim the same player.
create type queue_state as enum (
    'waiting',
    'matching',
    'matched',
    'cancelled',
    'expired'
);

-- Lifecycle of one match.
--   forming     -> participants still being added
--   ready       -> squad complete, not yet started
--   in_progress -> started_at is set
--   completed   -> ended_at is set; feedback may now be submitted
--   abandoned   -> dissolved before completion
create type match_status as enum (
    'forming',
    'ready',
    'in_progress',
    'completed',
    'abandoned'
);

-- How a player is willing to communicate in-squad. This is a hard compatibility
-- filter, not a soft score: a 'silent' player and a 'voice_required' player
-- should not be grouped regardless of how well their skill vectors match.
create type comm_preference as enum (
    'voice_required',
    'voice_optional',
    'text_only',
    'silent'
);


-- =============================================================================
-- SECTION 2: TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles -- identity anchor. One row per person. Every other table points here.
-- -----------------------------------------------------------------------------
create table profiles (
    id                uuid primary key default gen_random_uuid(),

    -- Pointer to Supabase auth.users.
    --   NULL     = synthetic seed profile (ML training data, no human behind it)
    --   NOT NULL = real authenticated user
    --   UNIQUE   = prevents two profiles being attached to one account
    -- CASCADE because a profile whose account is deleted has no owner and must
    -- not survive as an orphan holding match history.
    auth_user_id      uuid unique references auth.users(id) on delete cascade,

    display_name      text not null,

    -- The in-game name. Kept distinct from display_name because players rename
    -- in-game freely; UNIQUE because it is the key used to reconcile external
    -- match records back to a profile.
    bgmi_ign          text not null unique,

    -- Coarse server region, applied as a hard filter before any scoring runs.
    -- Free text rather than an enum: BGMI's region list changes far more often
    -- than the four vocabularies above, and a bad value here degrades matching
    -- rather than corrupting it.
    region            text,

    avatar_url        text,
    bio               text,

    -- Soft-delete / suspension flag. A profile is never hard-deleted in normal
    -- operation, because deleting it would CASCADE away match history that other
    -- players' feedback rows depend on for context.
    is_active         boolean not null default true,

    created_at        timestamptz not null default now(),

    -- Column only in Phase 1. The trigger that maintains it is intentionally
    -- deferred to a behaviour migration -- this file installs structure only.
    updated_at        timestamptz not null default now(),

    -- Reject whitespace-only names, which pass NOT NULL but are unusable in UI.
    constraint profiles_display_name_not_blank
        check (length(btrim(display_name)) > 0),
    constraint profiles_bgmi_ign_not_blank
        check (length(btrim(bgmi_ign)) > 0)
);

comment on table  profiles is
    'Identity anchor. Holds only facts true about a person regardless of how, when, or how well they play.';
comment on column profiles.auth_user_id is
    'NULL = synthetic seed profile; NOT NULL = real authenticated user; UNIQUE prevents two profiles per account.';


-- -----------------------------------------------------------------------------
-- player_stats -- measured skill vector. Machine-written, one row per profile.
-- -----------------------------------------------------------------------------
create table player_stats (
    id                uuid primary key default gen_random_uuid(),

    -- UNIQUE enforces the 1:1 with profiles. CASCADE because a stats row has no
    -- meaning without the player it measures.
    profile_id        uuid not null unique
                      references profiles(id) on delete cascade,

    -- Raw performance figures, kept alongside the normalized axes so the
    -- normalization can be recomputed later without re-deriving from matches.
    kd_ratio          numeric(6,3) not null default 0,
    avg_damage        numeric(8,2) not null default 0,
    avg_survival_time numeric(8,2) not null default 0,  -- seconds
    headshot_rate     numeric(5,2) not null default 0,  -- percent
    win_rate          numeric(5,2) not null default 0,  -- percent

    -- Normalized 0-100 skill axes. These are the columns the recommender scores
    -- on, and every one of them is range-checked below: they feed weighted
    -- arithmetic, so an out-of-range value produces a plausible-looking wrong
    -- ranking instead of an error. The database is the only layer that can
    -- guarantee this for both the Next.js writer and the Python writer.
    aim_score         smallint not null default 50,
    game_sense        smallint not null default 50,
    teamwork_score    smallint not null default 50,
    clutch_score      smallint not null default 50,
    consistency_score smallint not null default 50,

    -- Composite of the five axes. Stored rather than computed on read because
    -- the weighting is owned by the ML service and will change between model
    -- versions; a generated column would pin the formula into the schema.
    overall_rating    smallint not null default 50,

    matches_played    integer not null default 0,
    matches_won       integer not null default 0,

    -- When the ML service last rewrote this row. NULL means "never scored" --
    -- distinct from "scored and came out at the defaults".
    last_computed_at  timestamptz,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    -- 0-100 range checks on every normalized axis.
    constraint player_stats_aim_score_range
        check (aim_score between 0 and 100),
    constraint player_stats_game_sense_range
        check (game_sense between 0 and 100),
    constraint player_stats_teamwork_score_range
        check (teamwork_score between 0 and 100),
    constraint player_stats_clutch_score_range
        check (clutch_score between 0 and 100),
    constraint player_stats_consistency_score_range
        check (consistency_score between 0 and 100),
    constraint player_stats_overall_rating_range
        check (overall_rating between 0 and 100),

    -- Percentages share the 0-100 domain for the same reason.
    constraint player_stats_headshot_rate_range
        check (headshot_rate between 0 and 100),
    constraint player_stats_win_rate_range
        check (win_rate between 0 and 100),

    constraint player_stats_non_negative
        check (kd_ratio >= 0 and avg_damage >= 0 and avg_survival_time >= 0),

    -- Wins cannot exceed matches played. Catches a partially-applied stats
    -- recompute, which is otherwise silent and poisons win_rate.
    constraint player_stats_wins_lte_played
        check (matches_played >= 0 and matches_won between 0 and matches_played)
);

comment on table player_stats is
    'ML service output surface. Separated from profiles by write rate and by ownership.';


-- -----------------------------------------------------------------------------
-- player_preferences -- declared intent. User-written, one row per profile.
-- -----------------------------------------------------------------------------
create table player_preferences (
    id                  uuid primary key default gen_random_uuid(),

    profile_id          uuid not null unique
                        references profiles(id) on delete cascade,

    primary_role        player_role not null default 'flex',

    -- NULL means "no second role", which is different from 'flex'.
    secondary_role      player_role,

    comm_preference     comm_preference not null default 'voice_optional',

    -- The skill band this player will accept in teammates, on the same 0-100
    -- scale as player_stats.overall_rating. Defaults span the full range so an
    -- untouched preferences row never narrows the candidate pool.
    min_teammate_skill  smallint not null default 0,
    max_teammate_skill  smallint not null default 100,

    wants_ranked        boolean not null default false,

    -- Spoken languages, as free-text tags. An array rather than a child table
    -- because the values are only ever read as a whole set for an overlap test,
    -- never joined or aggregated across players.
    languages           text[] not null default array['en']::text[],

    -- Upper bound on acceptable ping. NULL means no constraint stated.
    max_ping_ms         integer,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint player_preferences_min_skill_range
        check (min_teammate_skill between 0 and 100),
    constraint player_preferences_max_skill_range
        check (max_teammate_skill between 0 and 100),

    -- An inverted band silently matches nobody, which is indistinguishable from
    -- "no players online" at the application layer. Reject it at write time.
    constraint player_preferences_skill_band_ordered
        check (min_teammate_skill <= max_teammate_skill),

    -- Declaring the same role twice carries no information and would distort
    -- role-coverage scoring by double-counting one competence.
    constraint player_preferences_roles_distinct
        check (secondary_role is null or secondary_role <> primary_role),

    constraint player_preferences_max_ping_positive
        check (max_ping_ms is null or max_ping_ms > 0)
);

comment on table player_preferences is
    'What the player wants. Never written by the ML service -- see docs/database.md 2.3.';


-- -----------------------------------------------------------------------------
-- player_availability -- weekly recurring play windows. 1:N per profile.
-- -----------------------------------------------------------------------------
create table player_availability (
    id                      uuid primary key default gen_random_uuid(),

    profile_id              uuid not null
                            references profiles(id) on delete cascade,

    -- 0 = Sunday ... 6 = Saturday, matching both JS getDay() and Postgres
    -- extract(dow), so no translation is needed on either side of the wire.
    day_of_week             smallint not null,

    -- Minutes from local midnight. Integers rather than `time` values because
    -- window overlap is a plain integer range comparison in both SQL and the
    -- Python scorer, and integers sidestep DST arithmetic entirely.
    start_minute            smallint not null,
    end_minute              smallint not null,

    -- Stored explicitly so a window can be normalized to UTC without a
    -- named-timezone lookup at read time. Range covers UTC-12 to UTC+14.
    timezone_offset_minutes smallint not null default 0,

    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),

    constraint player_availability_day_range
        check (day_of_week between 0 and 6),

    -- 1440 is permitted as an end value so a window can run to local midnight.
    constraint player_availability_start_range
        check (start_minute between 0 and 1440),
    constraint player_availability_end_range
        check (end_minute between 0 and 1440),

    -- Strictly less-than: a zero-length window is never intentional, and it
    -- would contribute nothing but noise to overlap scoring. Windows crossing
    -- midnight are represented as two rows, which keeps every row a simple
    -- interval that overlap logic can treat uniformly.
    constraint player_availability_window_ordered
        check (start_minute < end_minute),

    constraint player_availability_tz_offset_range
        check (timezone_offset_minutes between -720 and 840),

    -- Exact duplicates of the same window add no information and would be
    -- double-counted by overlap scoring. Genuine overlapping-but-distinct
    -- windows are still allowed -- collapsing those is the application's job.
    constraint player_availability_no_duplicate_window
        unique (profile_id, day_of_week, start_minute, end_minute)
);

comment on table player_availability is
    'Weekly windows in minutes-from-local-midnight. One row per contiguous interval.';


-- -----------------------------------------------------------------------------
-- matches -- one formed squad and its outcome.
--
-- Declared before matchmaking_queue because that table's matched_match_id
-- references matches(id), and Postgres has no forward declaration for foreign
-- keys inside CREATE TABLE.
-- -----------------------------------------------------------------------------
create table matches (
    id              uuid primary key default gen_random_uuid(),

    status          match_status not null default 'forming',

    map_name        text,
    mode            text,          -- e.g. 'classic', 'tdm', 'arena'
    is_ranked       boolean not null default false,

    squad_size      smallint not null default 4,

    -- The recommender's confidence that this grouping works, 0-100.
    -- Range-checked for the same reason as the player_stats axes: it is
    -- arithmetic input, and a wrong-but-plausible value is worse than an error.
    synergy_score   smallint,

    -- Which scorer produced synergy_score. This column is the schema-level
    -- expression of the ML-unavailable fallback in docs/architecture.md: when
    -- the FastAPI service is unreachable, Next.js computes a rule-based score
    -- and stamps 'rule_based' here. Without this provenance the model would
    -- eventually be evaluated against outcomes it never generated.
    -- Text + CHECK rather than an enum: this is a temporary Phase 1 marker that
    -- a model-version table will supersede, and it should not outlive its use
    -- as a permanent type in the database.
    scoring_source  text not null default 'rule_based',

    created_at      timestamptz not null default now(),
    started_at      timestamptz,
    ended_at        timestamptz,
    updated_at      timestamptz not null default now(),

    constraint matches_squad_size_range
        check (squad_size between 2 and 4),

    constraint matches_synergy_score_range
        check (synergy_score is null or synergy_score between 0 and 100),

    constraint matches_scoring_source_valid
        check (scoring_source in ('ml', 'rule_based')),

    -- A match cannot end before it starts. Also catches the common bug of
    -- stamping ended_at on a match that was abandoned during 'forming' and
    -- therefore never had a started_at.
    constraint matches_timeline_ordered
        check (
            ended_at is null
            or (started_at is not null and ended_at >= started_at)
        )
);

comment on table  matches is
    'A formed squad. Owned by no single player -- it is the join object between four of them.';
comment on column matches.scoring_source is
    'ml | rule_based. Provenance for the ML-unavailable fallback path.';


-- -----------------------------------------------------------------------------
-- matchmaking_queue -- the live waiting room. The one hot table in the schema.
-- -----------------------------------------------------------------------------
create table matchmaking_queue (
    id                uuid primary key default gen_random_uuid(),

    -- UNIQUE: a player is in the pool at most once. This is the constraint that
    -- makes a double-enqueue from a double-clicked button an error rather than
    -- a duplicate seat in two different squads.
    profile_id        uuid not null unique
                      references profiles(id) on delete cascade,

    state             queue_state not null default 'waiting',

    -- Role this player is queueing as. May differ from their stored preference
    -- for this session; NULL means "no preference for this queue entry".
    desired_role      player_role,

    -- Skill band for this entry, copied from preferences at enqueue time rather
    -- than joined at read time: the matcher must see a stable band even if the
    -- player edits their preferences while waiting.
    min_skill         smallint not null default 0,
    max_skill         smallint not null default 100,

    -- Number of players entering together as a pre-made group. 1 = solo.
    party_size        smallint not null default 1,

    -- Target squad size to fill to. 4 is a standard BGMI squad.
    target_squad_size smallint not null default 4,

    region            text,

    enqueued_at       timestamptz not null default now(),

    -- Hard timeout. A row past this time is swept to 'expired' rather than
    -- being left to widen its search forever.
    expires_at        timestamptz,

    -- Set when state becomes 'matched'. SET NULL rather than CASCADE on purpose:
    -- deleting a match must not delete the player's queue history, which is the
    -- record of what they asked for versus what they were given.
    matched_match_id  uuid references matches(id) on delete set null,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint matchmaking_queue_min_skill_range
        check (min_skill between 0 and 100),
    constraint matchmaking_queue_max_skill_range
        check (max_skill between 0 and 100),
    constraint matchmaking_queue_skill_band_ordered
        check (min_skill <= max_skill),

    constraint matchmaking_queue_target_size_range
        check (target_squad_size between 2 and 4),

    -- A party cannot be larger than the squad it is trying to fill.
    constraint matchmaking_queue_party_fits_squad
        check (party_size >= 1 and party_size <= target_squad_size),

    -- State/data agreement, enforced in the database because it is the one
    -- invariant that both the matcher and any manual correction must respect:
    -- 'matched' requires a match to point at, and every other state requires
    -- the pointer to be empty.
    constraint matchmaking_queue_matched_requires_match
        check (
            (state = 'matched' and matched_match_id is not null)
            or (state <> 'matched' and matched_match_id is null)
        ),

    constraint matchmaking_queue_expiry_after_enqueue
        check (expires_at is null or expires_at > enqueued_at)
);

comment on table matchmaking_queue is
    'Live waiting pool. Rows are retained after matching as a record of intent vs outcome.';
comment on column matchmaking_queue.min_skill is
    'Snapshot of the preference band at enqueue time -- deliberately not a join.';


-- -----------------------------------------------------------------------------
-- match_participants -- who was in which squad, and in what seat.
-- -----------------------------------------------------------------------------
create table match_participants (
    id             uuid primary key default gen_random_uuid(),

    match_id       uuid not null
                   references matches(id) on delete cascade,

    profile_id     uuid not null
                   references profiles(id) on delete cascade,

    -- The role actually given in THIS squad, which routinely differs from the
    -- player's preferred role -- a squad with two snipers means one plays flex.
    -- The gap between preferred and assigned is a training signal, so both are
    -- stored rather than one being inferred from the other.
    assigned_role  player_role,

    is_leader      boolean not null default false,

    joined_at      timestamptz not null default now(),

    -- Set when a player leaves early. NULL means they were present at the end.
    left_at        timestamptz,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    -- Prevents double-seating one player in one squad. This is the core
    -- integrity guarantee of the join table; without it a retried insert
    -- silently creates a five-person "squad of four".
    constraint match_participants_unique_seat
        unique (match_id, profile_id),

    constraint match_participants_left_after_joined
        check (left_at is null or left_at >= joined_at)
);

comment on column match_participants.assigned_role is
    'Role given in this match. Compare against player_preferences.primary_role -- the divergence is a signal.';


-- -----------------------------------------------------------------------------
-- match_feedback -- directional peer rating. The supervised label.
-- -----------------------------------------------------------------------------
create table match_feedback (
    id                uuid primary key default gen_random_uuid(),

    match_id          uuid not null
                      references matches(id) on delete cascade,

    -- Two FKs to the same table. Both CASCADE: if either endpoint of the edge
    -- is gone, the edge is meaningless.
    rater_profile_id  uuid not null
                      references profiles(id) on delete cascade,
    ratee_profile_id  uuid not null
                      references profiles(id) on delete cascade,

    -- Coarse 1-5 satisfaction score. 1-5 rather than 0-100 because it is
    -- collected from a human in a UI, and a five-point scale is what people can
    -- actually discriminate. The 0 value is excluded so "not rated" stays
    -- expressible only as an absent row.
    rating            smallint not null,

    -- Finer-grained 0-100 axis on the same scale as player_stats.teamwork_score,
    -- so the label and the feature it supervises are directly comparable.
    -- Nullable: optional in the UI.
    teamwork_rating   smallint,

    would_play_again  boolean,

    comment           text,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint match_feedback_rating_range
        check (rating between 1 and 5),

    constraint match_feedback_teamwork_rating_range
        check (teamwork_rating is null or teamwork_rating between 0 and 100),

    -- Self-rating is not feedback and would inflate a player's own label.
    constraint match_feedback_no_self_rating
        check (rater_profile_id <> ratee_profile_id),

    -- One rating per rater per ratee per match. Blocks ballot-stuffing and makes
    -- resubmission an UPDATE rather than a second row.
    constraint match_feedback_one_rating_per_pair
        unique (match_id, rater_profile_id, ratee_profile_id)
);

comment on table match_feedback is
    'Directional edge (rater -> ratee) scoped to one match. The recommender''s training target.';


-- =============================================================================
-- SECTION 3: INDEXES
--
-- Postgres automatically indexes a referenced primary key, but never the
-- referencing column. Every FK column below is therefore indexed by hand;
-- without these, cascade deletes and every join degrade to sequential scans.
-- Columns already covered by a UNIQUE constraint are skipped -- UNIQUE creates
-- a usable index and a second one would only cost write throughput.
-- =============================================================================

-- player_stats.profile_id       -- covered by UNIQUE
-- player_preferences.profile_id -- covered by UNIQUE
-- matchmaking_queue.profile_id  -- covered by UNIQUE

create index idx_player_availability_profile_id
    on player_availability (profile_id);

create index idx_matchmaking_queue_matched_match_id
    on matchmaking_queue (matched_match_id);

create index idx_match_participants_match_id
    on match_participants (match_id);

create index idx_match_participants_profile_id
    on match_participants (profile_id);

create index idx_match_feedback_match_id
    on match_feedback (match_id);

create index idx_match_feedback_rater_profile_id
    on match_feedback (rater_profile_id);

create index idx_match_feedback_ratee_profile_id
    on match_feedback (ratee_profile_id);


-- The matcher's hot path. Required explicitly by the Phase 1 spec, and it is
-- the only predicate in the schema known in advance to run continuously:
-- every matcher pass begins with WHERE state = 'waiting'.
create index idx_matchmaking_queue_state
    on matchmaking_queue (state);

-- Supporting composite for the same scan, ordered by wait time so the matcher
-- can serve the longest-waiting players first without a sort step.
create index idx_matchmaking_queue_state_enqueued_at
    on matchmaking_queue (state, enqueued_at);

-- Non-FK lookups the application is known to issue.
create index idx_profiles_region
    on profiles (region);

create index idx_matches_status
    on matches (status);

-- Availability overlap is always scoped to a day first, so the day is the
-- leading column.
create index idx_player_availability_day_of_week
    on player_availability (day_of_week, start_minute, end_minute);


-- =============================================================================
-- END 0001_init.sql
--
-- Not applied. No RLS is enabled by this migration; enabling it before the
-- auth model exists would lock out every client including the seeding scripts.
-- RLS policies and the updated_at triggers both belong to Phase 2.
-- =============================================================================
