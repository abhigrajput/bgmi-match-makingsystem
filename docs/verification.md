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

## Production (hosted Supabase)

Pending: migration 0005 has been handed off for the SQL Editor. This section is
filled in from `scripts/verify-prod.ts --target prod` once it is applied.
