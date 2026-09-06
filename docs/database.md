# Database Design — Squad Recommendation System

Scope: Phase 1. This document defines the persistent data model only.
No auth policies, no queue algorithm, no ML feature store. Those arrive later
and must fit *inside* this schema without requiring a table rename.

Target engine: PostgreSQL 15 (Supabase managed).
Migration file: `supabase/migrations/0001_init.sql` — written, not executed.

---

## 1. ER Diagram

```
                         +----------------------------+
                         |          profiles          |
                         |----------------------------|
                         | id (PK, uuid)              |
                         | auth_user_id (uuid, uniq)  |
                         | display_name               |
                         | bgmi_ign                   |
                         | region                     |
                         | created_at / updated_at    |
                         +-------------+--------------+
                                       |
        +----------------+-------------+--------------+------------------+
        | 1:1            | 1:1                        | 1:N              | 1:1
        v                v                            v                  v
+---------------+ +---------------------+ +-----------------------+ +--------------------+
| player_stats  | | player_preferences  | | player_availability   | | matchmaking_queue  |
|---------------| |---------------------| |-----------------------| |--------------------|
| id (PK)       | | id (PK)             | | id (PK)               | | id (PK)            |
| profile_id FK | | profile_id FK uniq  | | profile_id FK         | | profile_id FK uniq |
| kd_ratio      | | primary_role        | | day_of_week (0-6)     | | state (enum)       |
| avg_damage    | | secondary_role      | | start_minute          | | desired_role       |
| survival_rate | | comm_preference     | | end_minute            | | min_skill/max_skill|
| aim_score     | | min_teammate_skill  | | timezone_offset_min   | | enqueued_at        |
| game_sense    | | max_teammate_skill  | +-----------------------+ | expires_at         |
| teamwork_score| | wants_ranked        |                           | matched_match_id FK|
| clutch_score  | | languages[]         |                           +---------+----------+
| matches_played| +---------------------+                                     |
+---------------+                                                             |
                                                                              |
                         +----------------------------+                       |
                         |          matches           |<----------------------+
                         |----------------------------|
                         | id (PK, uuid)              |
                         | status (enum)              |
                         | map_name                   |
                         | mode                       |
                         | squad_size                 |
                         | synergy_score (0-100)      |
                         | scoring_source             |   <- 'ml' | 'rule_based'
                         | created_at / started_at    |
                         | ended_at / updated_at      |
                         +-------------+--------------+
                                       | 1:N
                                       v
                         +-------------------------------+
                         |      match_participants       |
                         |-------------------------------|
                         | id (PK)                       |
                         | match_id  FK -> matches       |
                         | profile_id FK -> profiles     |
                         | assigned_role (enum)          |
                         | is_leader / joined_at         |
                         | UNIQUE(match_id, profile_id)  |
                         +-------------+-----------------+
                                       | 1:N
                                       v
                         +-------------------------------+
                         |        match_feedback         |
                         |-------------------------------|
                         | id (PK)                       |
                         | match_id  FK -> matches       |
                         | rater_profile_id FK -> profiles|
                         | ratee_profile_id FK -> profiles|
                         | rating (1-5)                  |
                         | teamwork_rating (0-100)       |
                         | would_play_again              |
                         | UNIQUE(match_id, rater, ratee)|
                         +-------------------------------+
```

Cardinality summary:

| Relationship | Cardinality | Delete behaviour |
|---|---|---|
| profiles → player_stats | 1:1 | CASCADE |
| profiles → player_preferences | 1:1 | CASCADE |
| profiles → player_availability | 1:N | CASCADE |
| profiles → matchmaking_queue | 1:1 while queued | CASCADE |
| matchmaking_queue → matches | N:1, nullable | SET NULL |
| matches → match_participants | 1:N | CASCADE |
| profiles → match_participants | 1:N | CASCADE |
| matches → match_feedback | 1:N | CASCADE |
| profiles → match_feedback (rater, ratee) | 1:N each | CASCADE |

---

## 2. Table-by-table rationale

### 2.1 `profiles`

**Purpose.** The identity anchor. One row per human being who uses the system.
Everything else in the schema points here. It holds only facts that are true
about the person regardless of how they play, how they want to play, or when.

**Key columns.**
- `id uuid PK` — the internal identifier every other table references.
- `auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` —
  nullable pointer to the Supabase auth user. **NULL = synthetic seed profile,
  NOT NULL = real authenticated user, UNIQUE prevents two profiles per
  account.** Nullable because ML training data is seeded as profiles with no
  human behind them; CASCADE because a profile whose account is gone has no
  owner and must not survive as an orphan.
- `display_name`, `bgmi_ign` — human-facing labels. The in-game name is kept
  distinct from the display name because players rename in-game freely and the
  two are not interchangeable when reconciling match records.
- `region` — coarse server region. Used as a hard filter before any scoring runs.

**Why not denormalized.** This is the base table, so the question inverts. The
rule applied throughout the rest of the schema is: *a column belongs in
`profiles` only if it changes at the same rate, and for the same reason, as
identity itself.* Skill changes every match. Preferences change weekly.
Availability is many-valued. None of those qualify.

---

### 2.2 `player_stats`

**Purpose.** The measured skill vector — the input the recommender consumes.
Raw performance numbers plus normalized 0–100 skill axes.

**Key columns.** `kd_ratio`, `avg_damage`, `survival_rate` (raw);
`aim_score`, `game_sense`, `teamwork_score`, `clutch_score` (0–100 axes);
`matches_played`, `last_computed_at`.

**Why it is separate from `profiles`.**
1. *Write rate.* Stats are recomputed after every match; identity is written
   once. Merging them means every stat update dirties the identity row,
   inflating row versions and invalidating any cache keyed on the profile.
2. *Ownership.* This table is the ML service's output surface. Keeping it apart
   lets the Python service be granted write access to exactly one table without
   ever touching identity data.
3. *Optionality.* A brand-new player has a profile but no meaningful stats. A
   missing row is a cleaner "unrated" signal than seven NULL columns sitting in
   the middle of the identity record.
4. *Column churn.* Phase 2 will add skill dimensions. Adding columns to a
   narrow, machine-owned table is a low-risk migration; widening `profiles`,
   which every query joins to, is not.

---

### 2.3 `player_preferences`

**Purpose.** What the player *wants*, as opposed to what they *are*. Declared,
self-reported, never inferred by the ML service.

**Key columns.** `primary_role`, `secondary_role` (`player_role` enum),
`comm_preference` (`comm_preference` enum), `min_teammate_skill`,
`max_teammate_skill`, `wants_ranked`, `languages text[]`.

**Why it is separate from `profiles`.**
1. *Different source of truth.* Stats are computed; preferences are asserted.
   Mixing a machine-written column and a user-written column in one row invites
   lost updates when both writers issue a full-row UPDATE.
2. *Different meaning for NULL.* "No preferences set" is a real state the
   matcher must handle by falling back to wide-open defaults. A missing row
   expresses that in one existence check, rather than eight NULL tests.
3. *Separate authorization story.* Later, a player may share preferences with
   teammates while keeping raw stats private. Row-level policies are far simpler
   to write when the privacy boundary is already a table boundary.

`primary_role <> secondary_role` is enforced by CHECK: declaring the same role
twice carries no information and would silently distort role-coverage scoring.

---

### 2.4 `player_availability`

**Purpose.** When the player can actually play, stored as weekly recurring
windows.

**Key columns.** `day_of_week smallint (0–6)`, `start_minute`, `end_minute`
(minutes from local midnight, 0–1440), `timezone_offset_minutes`.

**Why it is separate from `profiles`.** Here the answer is purely structural:
the relationship is one-to-many. A player has several windows — weekday
evenings, Saturday afternoons. Denormalizing forces either a fixed set of slot
columns, which caps expressiveness at whatever number we guess today, or a JSON
blob, which cannot be indexed or range-queried. Finding the overlap between four
candidates' windows is a *query*, and queries want rows.

Minutes-since-midnight rather than `time` values: integer range overlap is
trivially expressible both in SQL and in the Python scorer, and it sidesteps DST
arithmetic. The offset is stored explicitly so a window can be normalized to UTC
without depending on a named-timezone lookup at read time.

---

### 2.5 `matchmaking_queue`

**Purpose.** The live waiting room. One row per player currently seeking a
squad. This is the only genuinely hot table in the schema: high insert rate,
high update rate, short row lifetime.

**Key columns.** `profile_id` (UNIQUE — a player is queued at most once),
`state` (`queue_state` enum), `desired_role`, `min_skill`, `max_skill`,
`party_size`, `enqueued_at`, `expires_at`, `matched_match_id`.

**Why it is separate from `profiles`.**
1. *A boolean `is_queued` column cannot carry a state machine.* Queue entries
   have five states, an entry time, a skill band, and an expiry.
2. *Contention.* The matcher scans and updates this table continuously. Folding
   it into `profiles` would put lock pressure on the row that every other read
   joins against.
3. *Auditability.* Rows are retained after the fact (state `matched`), giving
   the ML service a record of what the player asked for versus what they got.
   Overwriting a flag on `profiles` would destroy that history.

`matched_match_id` uses `ON DELETE SET NULL`, not CASCADE: deleting a match must
not delete the player's queue history.

---

### 2.6 `matches`

**Purpose.** One formed squad, and its outcome. The unit the whole system exists
to produce.

**Key columns.** `status` (`match_status` enum), `map_name`, `mode`,
`squad_size`, `synergy_score` (0–100), `scoring_source` (`ml` | `rule_based`),
`created_at`, `started_at`, `ended_at`.

**Why it is separate from `profiles`.** A match is not a property of any one
player — it is the join object between four of them. Its natural owner is
nobody, so it gets its own table.

`scoring_source` is the schema-level expression of the fallback path described
in `docs/architecture.md`: when the FastAPI service is unreachable, the Next.js
route computes a rule-based synergy score and stamps the row `rule_based`.
Recording *which* scorer produced a squad is what keeps the two paths
comparable afterward — without it, the ML model would eventually be evaluated
against outcomes it never generated.

---

### 2.7 `match_participants`

**Purpose.** The join table resolving the many-to-many between `matches` and
`profiles`, plus the per-player facts that are only true *inside* that match.

**Key columns.** `match_id`, `profile_id`, `assigned_role`, `is_leader`,
`joined_at`, `left_at`, and `UNIQUE(match_id, profile_id)`.

**Why it is separate from `profiles`.** Structurally it cannot be otherwise: a
player is in many matches and a match holds many players. The more interesting
column is `assigned_role`. A player's *preferred* role lives in
`player_preferences`; the role they were actually given in this squad lives
here. The two diverge constantly — a squad with two snipers means one plays flex
— and the gap between preferred and assigned is a first-class training signal.
Storing only the preference would erase it.

The UNIQUE constraint is what prevents double-seating one player in one squad.

---

### 2.8 `match_feedback`

**Purpose.** Post-match peer rating: the supervised label the recommender learns
from. Without this table the ML service has features and no target.

**Key columns.** `match_id`, `rater_profile_id`, `ratee_profile_id`,
`rating smallint (1–5)`, `teamwork_rating (0–100)`, `would_play_again`,
`comment`, and `UNIQUE(match_id, rater_profile_id, ratee_profile_id)`.

**Why it is separate from `profiles`.** Feedback is directional and
match-scoped: it is an edge (rater → ratee, within one match), not an attribute
of either endpoint. A `reputation` column on `profiles` would be the *aggregate*
of these rows — a derived value. Storing only the aggregate discards who said
what, when, and in which squad, which makes it impossible to detect retaliatory
ratings, weight recent feedback more heavily, or recompute after a scoring
change.

`CHECK (rater_profile_id <> ratee_profile_id)` blocks self-rating. The UNIQUE
triple blocks one rater stuffing the ballot on one teammate.

---

## 3. Deliberate exclusions

Eight tables and no more. Recorded here so the boundary reads as a decision
rather than an oversight:

- **No `teams` / `clans` table.** Persistent named groups are a different
  product from ad-hoc squad recommendation. `matches` *is* a formed squad;
  nothing in Phase 1 requires it to outlive the session.
- **No `notifications` table.** Delivery concern, not a domain concern.
- **No `ml_model_versions` table.** Phase 3. `matches.scoring_source` carries
  enough provenance for the Phase 1 fallback comparison.
- **No separate `skill_history`.** `player_stats` holds the current vector;
  `match_participants` joined to `match_feedback` already reconstructs the
  trajectory.
- **No `users` / `sessions` table.** Supabase `auth.users` owns that.
  `profiles` references it and does not duplicate it.

---

## 4. Constraint conventions

| Convention | Rationale |
|---|---|
| `uuid` PKs with `gen_random_uuid()` default | IDs are generable client-side and by the ML service without a round trip, and there is no sequence to contend on. |
| `created_at` / `updated_at` default `now()` | `updated_at` is column-only in Phase 1. The trigger that maintains it is deliberately deferred — no behaviour ships in the init migration. |
| Tables declared in dependency order | `matches` is created before `matchmaking_queue` because the queue references it. Postgres has no forward declaration for foreign keys inside `CREATE TABLE`, so every FK is inline on its column and nothing is patched in afterwards. |
| Every FK names its `ON DELETE` explicitly | Postgres defaults to `NO ACTION`; relying on that default hides intent. Ownership edges CASCADE, reference edges SET NULL. |
| Every 0–100 column carries a CHECK | These columns feed arithmetic in the scorer. An out-of-range value yields a plausible-looking wrong answer rather than an error, so the database is the right place to stop it. |
| Every FK column is indexed | Postgres indexes the referenced PK automatically, never the referencing column. Without these, cascade deletes and every join fall back to sequential scans. |
| `matchmaking_queue(state)` indexed | The matcher's hot path is `WHERE state = 'waiting'`. It is the only predicate in the schema known in advance to run continuously. |
