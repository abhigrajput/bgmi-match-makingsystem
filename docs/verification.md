# Verification results

Outputs of the verification scripts, copied from their runs. Nothing on this
page is estimated.

## Local (Docker Supabase stack), 2026-09-21

### Catalog: `supabase/tests/phase_b_verify.sql`

24/24 PASS. Two checks failed on the first apply and were fixed in the
migration, not in the test:

- #3 expected 15 `tournaments` columns; the table has 14 (the expectation was
  miscounted).
- #22 `analytics_overview()` was executable by `anon`: Supabase grants EXECUTE
  to `anon` directly, so `REVOKE … FROM public` was not enough. Fixed by
  revoking from `public, anon, authenticated` and re-granting. Re-applying the
  migration over itself also confirmed it is idempotent.

### REST: `scripts/verify-prod.ts --target local`

14/14 checks passed: three new tables with every column, the four new `matches`
columns, `is_seed` on six more tables, `leaderboard_v` with 9 columns,
`public_stats()`, `analytics_overview()`, and the enum rejecting an unknown
status (`22P02`).

### End to end: `scripts/e2e-local.ts`

36/36 passed. Selected lines:

```
PASS  Signed-out /tournaments redirects to /login
PASS  Cannot register another player  (42501)
PASS  Anon cannot read leaderboard_v  (42501)
PASS  Anon cannot read tournaments  (42501)
PASS  Cannot change tournament status  (42501)
PASS  Cannot deactivate the model  (42501)
PASS  Anon CAN call public_stats()
PASS  Anon cannot call analytics_overview()  (42501)
PASS  Client-set is_seed is forced to false
PASS  Duplicate registration is 23505  (23505)
PASS  Second formation is refused with 409
PASS  Cannot withdraw after squads are formed  (no error, row kept)
PASS  Optimizer seats zero vetoed pairs
PASS  Cannot submit feedback as someone else  (42501)
PASS  Reset demo reopens the tournament
```

### Squad formation, Hubballi Weekend Cup (local, 58 registered)

From the tournament's stored `formation_summary` (screenshot
`docs/screenshots/09-comparison.png`):

| Metric | Optimizer | Rank-only |
|---|---|---|
| Squads formed | 13 | 14 |
| Mean squad score (×100) | 95.1 | 76.9 |
| Vetoed pairs seated together | 0 | 17 |
| Role coverage | 96% | 89% |
| Mean rating spread | 10.0 | 3.9 |

Rank-only places every player and has a tighter rating spread by
construction; it does so by seating 17 vetoed pairs together.

### Unit tests

81/81 passed (`npx vitest run`).

## Production (hosted Supabase), 2026-09-21

Migration 0005 was pasted into the hosted SQL Editor by the project owner, then
verified from this machine through the REST API only.

### REST: `scripts/verify-prod.ts --target prod`

14/14 checks passed (same checks as local). Row counts before seeding:
1 profile (the owner's real account), every other table 0.

### Seed: `scripts/seed.ts --target prod`

| Table | Total | is_seed |
|---|---|---|
| profiles | 201 | 200 |
| player_stats | 200 | 200 |
| player_preferences | 200 | 200 |
| player_availability | 648 | 648 |
| tournaments | 3 | 3 |
| tournament_registrations | 181 | 181 |
| matches | 600 | 600 |
| match_participants | 2400 | 2400 |
| match_feedback | 7200 | 7200 |

The one non-seed profile is the owner's account, untouched.

### Train: `scripts/train.ts --target prod`

Model `lr-20260921T0926`, active in `model_versions`. Test AUC 0.783 (rule-based
0.723, rank-only 0.739, majority 0.500); 5-fold CV AUC 0.804 ± 0.014. Identical
to the local run, as expected: seed and split are deterministic. Full tables in
[`ml-results.md`](ml-results.md).

### Live walkthrough: `scripts/walkthrough-prod.ts`

19/19 steps passed against https://bgmi-match-makingsystem.vercel.app with a
temporary account (random password, never printed, deleted at the end):
sign-in, landing stats, dashboard, tournament page, register under RLS, form
squads (13, all ML scored, reasons present), tournament page shows squads
formed, match page, mark completed, feedback saved and shown, leaderboard,
analytics with model metrics, reset demo, account deleted.

Formation on production (Hubballi Weekend Cup, 58 registered, 6 unplaced):

| Metric | Optimizer | Rank-only |
|---|---|---|
| Squads formed | 13 | 14 |
| Mean squad score (×100) | 95.2 | 75.5 |
| Vetoed pairs seated together | 0 | 18 |
| Role coverage | 96% | 88% |
| Mean rating spread | 9.8 | 3.6 |

`npx vercel logs` for the deployment during the walkthrough: 12 requests, all
info level, no errors. The demo tournament was reset afterwards and is open.

## Production: organiser role (0006), 2026-09-21

- `supabase/migrations/0006_organiser_role.sql` pasted into the hosted SQL
  Editor by the project owner. `scripts/verify-prod.ts --target prod`: 15/15,
  including `profiles.is_organiser` (0 organisers at that point).
- Locally, `supabase/tests/0006_verify.sql` 5/5: the column exists with default
  false, `authenticated` and `anon` cannot UPDATE it, profile INSERT stays
  revoked, and `display_name` is still editable.
- Live walkthrough rerun: 20/20. The new step: the temporary account got
  **403** from `POST /api/tournaments/hubballi-weekend-cup/match` while not an
  organiser, then formed 13 ML-scored squads after being promoted with the
  service role. Formation metrics were identical to the previous run. Account
  deleted, demo tournament reset.

## Production: organiser assignment and auth settings, 2026-09-21

Getting the project owner signed in as organiser exposed two problems, both
now fixed:

- **Invite links could not complete.** Supabase invite and recovery emails use
  the implicit flow (session in the URL fragment), which `/auth/callback`
  cannot read, and the app had no way to set a password. Fixed by
  `/accept-invite` (commit `8d1e450`): the callback forwards code-less links
  there, the page reads the fragment in the browser, calls `setSession`,
  clears the tokens from the address bar and asks for a password.
- **Auth emails pointed at localhost.** The project's Site URL was
  `http://localhost:3000` with an empty redirect allow list, so Supabase
  ignored the live `redirectTo` and fell back to localhost. With the owner's
  approval, updated through the Supabase Management API to Site URL
  `https://bgmi-match-makingsystem.vercel.app` and allow list
  `https://bgmi-match-makingsystem.vercel.app/**`, `http://localhost:3000/**`
  (read back after the change).

How the owner's session was confirmed: Supabase auth logs (Management API)
and Vercel request logs showed which project and site the sign-in attempts
reached; a read-only check in the owner's own browser then confirmed the live
session and the account it belonged to.

Final state, verified on production:

| Item | Result |
|---|---|
| Organisers | exactly 1: the owner's account (in-game name `vsdzvergsver`) |
| Organiser UI on the live site | "You are an organiser" note and **Form squads** button visible on `/tournaments/hubballi-weekend-cup` in the owner's session |
| Unused invited account | organiser revoked, then deleted at the owner's request (never signed in; 0 registrations, matches or feedback); profile row removed by cascade |
| Auth users on production | 1 |
