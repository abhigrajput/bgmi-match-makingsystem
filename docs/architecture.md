# System Architecture

AI-Powered Skill-Based Multiplayer Team Matching & Squad Recommendation System
(BGMI-oriented prototype).

Scope of this document: Phase 1 — structure and boundaries only. No auth flow,
no matchmaking algorithm, no model. Everything below describes where things will
go and why the seams sit where they do.

---

## 1. Folder boundaries

```
/*
 * ---------------------------------------------------------------------------
 * FOLDER BOUNDARIES AND THE REASONING BEHIND THEM
 * ---------------------------------------------------------------------------
 *
 * app/
 *   Next.js App Router. Routes, layouts, and server actions ONLY.
 *   Rule: a file in app/ may orchestrate, but must not implement. It decides
 *   what to call and what to render; the how lives in lib/. This is enforced by
 *   convention rather than tooling, and the test is simple -- if a function in
 *   app/ would still make sense with no HTTP request in flight, it is in the
 *   wrong folder. Keeping app/ thin is what makes the matching logic testable
 *   without booting Next.js, and what will make it portable if any route later
 *   moves to an edge runtime.
 *
 * components/
 *   React components with no data-fetching of their own. They take props and
 *   return markup. The boundary exists so that a component never becomes the
 *   place a Supabase client gets instantiated -- once that happens, components
 *   stop being renderable in isolation and every UI change needs a database.
 *
 * lib/
 *   The application's actual behaviour: the Supabase client factory, the
 *   ML-service HTTP client, the rule-based fallback scorer, validation, and
 *   pure helpers. Framework-agnostic on purpose. This is the folder that gets
 *   unit-tested, and the folder that both a route handler and a future CLI
 *   script can import without either one knowing about the other.
 *
 * types/
 *   Hand-written TypeScript types, database types first among them. Separate
 *   from lib/ because types are a contract shared across every other folder,
 *   including ones that must not import runtime code. A type-only folder can be
 *   imported from anywhere without creating a dependency cycle or pulling a
 *   client bundle into a server module.
 *
 * supabase/migrations/
 *   Ordered, append-only SQL. The schema's single source of truth. It lives
 *   outside lib/ because it is not TypeScript and is not executed by the app --
 *   it is executed by the Supabase CLI against a database. Mixing it into the
 *   application tree would blur which artifacts ship to the browser, which run
 *   on the server, and which run exactly once at deploy time.
 *
 * docs/
 *   Design decisions and their rationale. Kept in the repository rather than a
 *   wiki so a decision and the code it constrains move together in the same
 *   commit and are reviewable in the same diff.
 *
 * scripts/
 *   One-off and maintenance tasks: seeding synthetic players, exporting
 *   training data, local checks. Isolated because these run with elevated
 *   credentials and outside the request lifecycle. Nothing in app/ or lib/ may
 *   import from scripts/; the dependency only ever points inward.
 *
 * ml-service/
 *   The Python FastAPI service. A sibling directory, not a subdirectory of the
 *   Next.js app, because it is a separate deployable with its own dependency
 *   manifest, its own lifecycle, and its own language toolchain. Placing it at
 *   the top level makes the process boundary visible in the file tree -- you
 *   cannot accidentally import across it, because the import would not resolve.
 *   Empty in Phase 1.
 * ---------------------------------------------------------------------------
 */
```

The through-line: **each folder is defined by what may import it, not by what it
contains.** `types/` can be imported by everything. `lib/` can be imported by
`app/` and `scripts/`. `app/` is imported by nothing. `ml-service/` cannot be
imported at all — only called over HTTP.

---

## 2. System context

Four participants, three network hops.

1. **Browser.** Renders the UI. Holds no service credentials. Talks only to the
   Next.js origin.
2. **Next.js (App Router).** Serves the UI and owns every server-side decision:
   authentication, validation, reading and writing Supabase, and calling the ML
   service. It is the only component that talks to more than one other
   component, which makes it the only place a fallback decision can be made.
3. **Supabase (Postgres + Auth).** Durable state. The schema in
   `supabase/migrations/0001_init.sql` is the contract; see `docs/database.md`.
4. **ML service (Python / FastAPI).** Stateless scoring. Given a set of
   candidate players it returns synergy scores and role assignments. It reads
   from Supabase directly for batch stat recomputation, but during a live
   matchmaking request it is called by Next.js and receives its inputs in the
   request body.

The browser never reaches Supabase or the ML service directly. That is a
deliberate constraint, not an accident of Phase 1: routing every call through
Next.js means the ML service can be deployed on a private network with no public
ingress, and it means the fallback in §4 has exactly one place to live.

---

## 3. Why two runtimes instead of one

The obvious alternative — implement scoring in TypeScript inside Next.js and
ship a single deployable — is simpler, and it is genuinely the right call for a
system whose matching rule is a weighted average. It is the wrong call here, for
four reasons.

**1. The libraries are not portable.** The recommender's real form is a learned
model: gradient boosting over a player-feature matrix, or embedding similarity
over squad-composition vectors. `scikit-learn`, `pandas`, `numpy`, and whatever
comes after them exist in Python and do not have equivalents in the Node
ecosystem that a student project can lean on. Reimplementing a scorer in
TypeScript would mean reimplementing the training pipeline too — and then the
thing that trains the model and the thing that serves it would be two different
programs that must agree exactly. That divergence is the classic source of
training/serving skew.

**2. The workloads have opposite shapes.** A page render is milliseconds of I/O
wait and almost no CPU. A batch stat recompute across every player is minutes of
saturated CPU and almost no I/O. Putting both in one Node process means the
recompute blocks the event loop and the site stops responding. Two runtimes let
each scale on its own axis: the web tier scales on concurrent requests, the ML
tier on CPU.

**3. Independent release cadence.** Retraining and redeploying a model is a
weekly operation. Shipping a UI fix is a daily one. Coupled, every model update
is a full site deploy, and every UI typo redeploys the model. The seam makes
each cheap.

**4. A narrow, inspectable contract.** Because the boundary is HTTP with a
JSON body, the exact input to the recommender is a thing you can log, replay,
and diff. If squad quality regresses, the request payload is the evidence. A
function call inside one process leaves no such trace.

The cost is real and worth naming: two deployments, two dependency manifests,
one more failure mode, and network latency on the hot path. §4 addresses the
failure mode; the latency is bounded by a timeout.

---

## 4. ML-unavailable fallback

The ML service is treated as an **optimization, never a dependency.** If it is
down, slow, or returning malformed output, matchmaking degrades — it does not
stop. A prototype that shows a spinner because a Python process crashed has
failed at the only thing it was asked to demonstrate.

**Trigger conditions.** Any of: connection refused, response slower than the
timeout, non-2xx status, or a body that fails schema validation. All four are
handled identically — there is no partial-trust path where a malformed ML
response is used anyway.

**Fallback path.** `lib/` contains a rule-based scorer implementing the same
interface as the ML client:

```
scoreSquad(candidates: PlayerVector[]) -> { synergyScore: number,
                                            assignments: RoleAssignment[] }
```

The rule-based implementation is a deterministic weighted function over data
already in Postgres:

| Signal | Source | Contribution |
|---|---|---|
| Skill proximity | `player_stats.overall_rating` spread across the squad | Tight spread scores higher |
| Role coverage | `player_preferences.primary_role` / `secondary_role` | One IGL, no duplicate specialists |
| Availability overlap | `player_availability` window intersection | Minutes of shared time |
| Communication fit | `player_preferences.comm_preference` | Hard filter, not a weight |
| Region | `profiles.region` | Hard filter, not a weight |

No training data, no model file, no Python. It runs in-process in Next.js and
always terminates.

**Provenance.** Every match records which scorer produced it, in
`matches.scoring_source` (`'ml'` or `'rule_based'`). This is what keeps the two
paths honest: without it, matches formed during an outage would silently enter
the ML model's evaluation set as if the model had produced them, and the model
would be graded on outcomes it had nothing to do with. With it, the two
populations can be compared — which also answers, empirically, whether the ML
path is earning its complexity.

**What the fallback is not.** It is not a cache of the last ML response, and it
is not a retry loop that eventually gives up. It is a second, weaker, always-available
implementation. The user sees a squad either way; the only visible difference is
in the provenance field.

---

## 5. Architecture diagram

```
   +-------------------------------------------------------------------+
   |                             BROWSER                               |
   |                                                                   |
   |   React Server Components + Client Components                     |
   |   Holds: session cookie.   Holds no service credentials.          |
   +---------------------------------+---------------------------------+
                                     |
                                     |  HTTPS
                                     |  (the only hop the browser makes)
                                     v
   +-------------------------------------------------------------------+
   |                    NEXT.JS 14  --  App Router                     |
   |                                                                   |
   |   app/          routes, layouts, server actions   (orchestrate)   |
   |   components/   presentational React             (no fetching)    |
   |   lib/          supabase client | ml client | rule-based scorer   |
   |   types/        shared contracts                                  |
   |                                                                   |
   |   Decision point: call ML, or fall back?  --  see section 4       |
   +------------+--------------------------------------+---------------+
                |                                      |
                | postgres / PostgREST                 | HTTP + JSON
                | (server-side only)                   | timeout-bounded
                v                                      v
   +----------------------------+        +-----------------------------+
   |         SUPABASE           |        |    ML SERVICE (FastAPI)     |
   |                            |        |                             |
   |  Postgres  -- 8 tables     |<-------+  POST /score-squad          |
   |  Auth      -- auth.users   | batch  |  POST /recommend            |
   |  RLS       -- Phase 2      | reads  |  GET  /health               |
   |                            |        |                             |
   |  Source of truth for all   |        |  Stateless. Owns no state.  |
   |  durable state.            |        |  Writes only player_stats.  |
   +----------------------------+        +--------------+--------------+
                                                        |
                                                UNREACHABLE?
                                                        |
                                                        v
                                       +--------------------------------+
                                       |  lib/  rule-based scorer       |
                                       |  In-process. Deterministic.    |
                                       |  Always terminates.            |
                                       |  Stamps scoring_source =       |
                                       |         'rule_based'           |
                                       +--------------------------------+
```

Request path for a matchmaking call, end to end:

```
browser --> app/ route handler
              |
              +--> lib/supabase   : load candidate players + stats + prefs
              |
              +--> lib/ml-client  : POST /score-squad ------------+
              |                                                   |
              |     on timeout / 5xx / invalid body               | ok
              |                                                   |
              +--> lib/rule-scorer : compute locally              |
                        |                                         |
                        v                                         v
                   scoring_source = 'rule_based'          scoring_source = 'ml'
                        |                                         |
                        +--------------------+--------------------+
                                             |
                                             v
                        lib/supabase : INSERT matches
                                              + match_participants
                                             |
                                             v
                                         browser
```

---

## 6. Phase boundaries

| Phase | Delivered | Explicitly not delivered |
|---|---|---|
| **1 (this one)** | Folder structure, architecture and schema documents, `0001_init.sql` (unapplied), TypeScript types, landing page | Auth, database connection, queue logic, ML code, any UI beyond `/` |
| 2 | Auth, RLS policies, `updated_at` triggers, profile and preference CRUD | Model training |
| 3 | Matchmaking queue, rule-based scorer, match lifecycle | Learned model |
| 4 | FastAPI service, feature extraction, training pipeline, ML path with the §4 fallback live | — |

The ordering is deliberate: **the rule-based scorer ships in Phase 3, before the
ML service exists in Phase 4.** The fallback is therefore not written under
outage pressure as an afterthought — it is the first working implementation, and
the ML path is added beside a path already proven to work.
