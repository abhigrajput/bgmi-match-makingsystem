# Testing

Four layers, from fastest to most realistic. Commands assume the project root.

| Layer | Command | What it proves |
|---|---|---|
| Unit | `npm test` (vitest) | Scoring, optimizer, model and route logic |
| Catalog | paste `supabase/tests/phase_b_verify.sql` | Schema, grants, policies, triggers exist as designed |
| REST schema | `npx tsx scripts/verify-prod.ts --target local\|prod` | Every new table/column/function reachable through PostgREST |
| End to end | `npx tsx scripts/e2e-local.ts` | Real pages, API routes and RLS attacks with a real JWT |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and build on
every push and pull request.

## 1. Unit tests (vitest)

| File | Tests | Covers |
|---|---|---|
| `lib/scoring/__tests__/compatibility.test.ts` | 39 | Skill Gaussian, each veto (both directions, band edges, priority), role matrix symmetry and all 25 pairs, flex, secondary-role upgrade, comms table, Jaccard, 1440 end, IST→UTC midnight shift, Sunday→Saturday wrap, week-boundary split, zero/full/linear overlap, no double counting, weights sum to 1, symmetry and [0,1] ranges over a 40-player pool |
| `lib/scoring/__tests__/squad.test.ts` | 13 | No vetoed pair in any squad, no player twice, every player accounted for, size 4 and 2, determinism under input reordering, reasons incl. weakest link, **optimizer beats rank-only on a fixed 40-player fixture while the baseline seats ≥ 1 vetoed pair**, blocking reasons (pool exhausted / comms veto), role assignment |
| `lib/scoring/__tests__/model.test.ts` | 10 | AUC and confusion metrics, learning a separable rule, threshold tuning, probabilities in [0,1], 0.7/0.3 blend, vetoes beat an "always yes" model, optimizer never seats vetoed pairs with the ML scorer, malformed model rejected → rule-based fallback |
| `app/api/__tests__/routes.test.ts` | 18 | Match route 401/403 (not an organiser)/404/409 (closed, too few, lost claim)/200 and rollback on failure; squads 401/200; reset 403 for non-organisers and real tournaments; complete 404 for non-participants, 409 abandoned, idempotent, timestamps |
| `lib/__tests__/ui-helpers.test.ts` | 4 | `cn` merge, score bands, role vocabulary completeness |

Total: **84 tests**. Fixtures are seeded (`seedrandom`), so every run uses the
same pools.

## 2. End to end (`scripts/e2e-local.ts`)

Needs the local Supabase stack, `scripts/seed.ts --target local`,
`scripts/demo-user.ts --target local`, and `npm run dev`. Signs in through
`@supabase/ssr` exactly as the browser does and drives 36 checks: six pages,
signed-out redirect, registration through PostgREST under RLS, the attack
attempts (register someone else, anon reads, changing tournament status,
deactivating the model, anon analytics, client-set `is_seed`, duplicate
registration, withdrawing after formation, forged feedback), squad formation,
409 on a second formation, squads read-back, optimizer vs baseline, match
completion, feedback, the Phase H pages and demo reset.

Latest result: see [`verification.md`](verification.md).

## 3. What is not automated

- Visual review: `scripts/screenshots.ts` renders every page into
  `docs/screenshots/` for inspection; layout was checked by eye.
- Screen-reader behaviour was reasoned about (roles, live regions, labels), not
  tested with a screen reader.
