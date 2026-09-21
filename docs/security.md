# Security: threats and mitigations

The security boundary is the database. Middleware redirects and disabled
buttons are conveniences; every rule below holds even for a client calling
PostgREST directly with the public anon key.

## Credentials

| Credential | Where it may appear | Enforcement |
|---|---|---|
| Anon key | Browser bundle | Public by design; RLS limits it to the caller's rows |
| Service-role key | `app/api/**/route.ts`, `scripts/` | `lib/supabase/admin.ts` takes it as a parameter; no page/component/lib file reads it |
| Production keys | `.env.production.local` | git-ignored (`git check-ignore` verified); scripts never print values |
| DB password | not used | No CLI, psql or pooler against production |

## Threat → mitigation

| # | Threat | Mitigation | Where |
|---|---|---|---|
| 1 | Read another player's preferences (skill band, comms) to steer matchmaking | SELECT owner-only; leaderboard gets `primary_role` alone via a definer view | 0003 policies, `leaderboard_v` |
| 2 | Read another player's weekly schedule (stalking aid) | `player_availability` owner-only; overlap is computed server-side | 0003 |
| 3 | Forge ratings or skill stats | No INSERT/UPDATE grant or policy on `player_stats`, `matches`, `match_participants` for clients | 0003 grants |
| 4 | Register another player into a tournament | INSERT policy requires `profile_id = current_profile_id()` | `tournament_registrations_insert_own_open` |
| 5 | Register after close / into a matched tournament via direct API call | Same policy checks `status='open'` and `now() < coalesce(closes_at, starts_at)` on the DB clock | 0005 |
| 6 | Knock a rival out by deleting their registration | DELETE policy owner-only | `tournament_registrations_delete_own_open` |
| 7 | Withdraw after squads formed, orphaning a squad seat | DELETE policy requires status `open` | 0005 |
| 8 | Move a registration to another tournament/player | No UPDATE grant or policy | 0005 |
| 9 | Open/close registration or forge formation results | No write grant/policy on `tournaments`; only service-role routes write it | 0005 |
| 10 | Pin the app to a model of the attacker's choosing | No write grant/policy on `model_versions`; partial unique index allows one active | 0005 |
| 11 | Flag own rows `is_seed` so a reseed deletes them (or to hide them) | `guard_is_seed()` trigger forces the value for client roles | 0005 |
| 12 | Anonymous scraping of players, tournaments, leaderboard | No anon grants on tables/view; `public_stats()` returns counts only | 0003, 0005 |
| 13 | Read platform-wide match data through a page | Pages run as the user; `analytics_overview()` returns aggregates only, granted to `authenticated` | 0005 |
| 14 | Definer function hijacked through `search_path` | Every function pins `search_path` | 0002–0005, verified by `phase_b_verify.sql` #23 |
| 15 | Rate someone as another player, or rate a stranger | Feedback INSERT requires rater = caller, both seated, match completed | 0003 |
| 16 | Revise a rating after seeing the outcome | No UPDATE on `match_feedback` | 0003 |
| 17 | Double-form a tournament with two concurrent requests | Atomic conditional UPDATE `open → matched`; loser gets 409 | match route |
| 18 | Half-written formation after an insert error | Inserted matches deleted, tournament re-opened | `persistFormation` |
| 19 | Reset a real tournament, destroying history | Reset route refuses unless `is_seed` (403) | reset route |
| 20 | Complete someone else's match | Route reads the match with the USER client first; invisible ⇒ 404 | complete route |
| 21 | Session cookie forgery | `getUser()` (server-revalidated), never `getSession()` | middleware, all routes |
| 22 | CSRF sign-out via `<img>` | `/auth/signout` is POST-only | `app/auth/signout` |
| 23 | Open redirect via `?next=` | Callback allows same-origin relative paths only | `app/auth/callback` |
| 24 | Stored XSS through bio/comments | React renders text, never HTML; avatar URLs restricted to http(s) | zod schemas |
| 25 | Hard preferences traded away by a confident model | Vetoes checked before the model; always score 0 | `model.ts`, tests |
| 26 | A regular player forms squads or resets a demo tournament | Both routes return 403 unless `profiles.is_organiser`, checked before the service-role client is created | 0006, match and reset routes |
| 27 | A player promotes themselves to organiser | `is_organiser` is outside the 0003 column UPDATE grant and explicitly revoked; profile INSERT is revoked; only `scripts/set-organiser.ts` (service role) sets it | 0006 |

Items 4, 5-adjacent, 9, 10, 11, 12, 13 and 15 are exercised as real attacks
with a real JWT by `scripts/e2e-local.ts`; see [`verification.md`](verification.md).

## Known limitations

- **One global organiser role.** Organisers (0006) can form squads for any
  tournament; there is no per-tournament ownership yet.
- **Tournament lineups are visible to all signed-in players** by design
  (the squads route). Match history and feedback remain participant-only.
- **Rate limiting** is left to Supabase/Vercel defaults.
