# API reference

Every HTTP endpoint the app serves besides pages. All JSON. Errors are always
`{ "error": "<human-readable sentence>" }` with the status below.

Routes that use the service role authenticate the caller **first** with the
cookie session (`getUser()`, revalidated against Supabase Auth). The
service-role key is read only in these route files.

| Method | Path | Auth | Service role | Purpose |
|---|---|---|---|---|
| GET | `/api/public-stats` | none | no | Landing-page counts |
| POST | `/api/tournaments/[slug]/match` | signed in | yes | Form squads |
| GET | `/api/tournaments/[slug]/squads` | signed in | yes | Read formed squads |
| POST | `/api/tournaments/[slug]/reset` | signed in | yes | Reset a demo tournament |
| POST | `/api/matches/[id]/complete` | participant | yes (after check) | Mark a match played |
| GET | `/auth/callback` | — | no | Supabase email-link exchange |
| POST | `/auth/signout` | — | no | Sign out (POST only) |

---

## GET /api/public-stats

Calls `public_stats()` with a cookie-less anon client.

```json
200 { "players": 203, "tournaments": 3, "squads_formed": 600 }
503 { "error": "Stats are unavailable right now." }
```

`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
The landing page calls the same `loadPublicStats()` directly and hides the
strip on failure instead of printing zeros.

## POST /api/tournaments/[slug]/match

Forms squads for an open tournament.

| Status | When |
|---|---|
| 401 | No session |
| 404 | Unknown slug |
| 409 | Tournament not `open`; fewer registrations than `squad_size`; or another request claimed it first |
| 500 | Formation or insert failed — inserted matches are deleted and the tournament re-opened |
| 200 | Formed |

Steps: load registrants → atomic `UPDATE tournaments SET status='matched'
WHERE id=… AND status='open'` (the claim) → `runFormation()` (optimizer with the
active scorer, rank-only baseline, comparison) → insert one `matches` row per
squad (`status 'ready'`, `synergy_score`, `scoring_source`,
`squad_score_components`, `reasons`, `tournament_id`) and its
`match_participants` with assigned roles → write `formation_summary`.

```json
200 {
  "squads": [SquadView],
  "unmatched": [{ "profile_id": "…", "ign": "…", "display_name": "…", "reason": "Vetoed with 5 of 9 remaining players, mostly on language …" }],
  "comparison": { "optimizer": GroupingMetrics, "baseline": GroupingMetrics },
  "summary": FormationSummary
}
```

`GroupingMetrics`: `squads`, `meanSquadScore`, `vetoedPairs`, `roleCoverage`,
`meanRatingSpread`.

## GET /api/tournaments/[slug]/squads

```json
200 { "squads": [SquadView], "summary": FormationSummary | null }
```

`SquadView`:

```json
{
  "match_id": "uuid", "status": "ready", "synergy_score": 96,
  "scoring_source": "ml",
  "reasons": ["Full role coverage: IGL + Assaulter + Sniper + Support", "…", "Weakest link: A & B (84) — …"],
  "components": { "skill": 0.91, "role": 0.9, "…": 0, "squad_score": 0.96, "mean_pair_score": 0.9 },
  "members": [{ "profile_id": "…", "ign": "…", "display_name": "…", "avatar_url": null,
                "role": "igl", "rating": 64, "is_leader": true }]
}
```

Why a service-role route: `matches` and `match_participants` are visible only
to participants (0003). Tournament lineups are public to signed-in players by
design, so this route reads them after authenticating and returns lineup fields
only — no feedback, preferences or availability.

## POST /api/tournaments/[slug]/reset

| Status | When |
|---|---|
| 401 / 404 | as above |
| 403 | Tournament is not `is_seed` — real tournaments are never reset |
| 200 | `{ "ok": true }` — matches deleted (participants and feedback cascade), status `open`, summary cleared |

## POST /api/matches/[id]/complete

| Status | When |
|---|---|
| 401 | No session |
| 404 | The caller cannot see the match (RLS: not a participant) |
| 409 | Match is `abandoned` |
| 200 | `{ "ok": true }`, or `{ "ok": true, "alreadyCompleted": true }` |

Sets `status 'completed'`, keeps an existing `started_at` or stamps now, stamps
`ended_at` now (satisfying `matches_timeline_ordered`).

---

## Server actions

Not HTTP endpoints, but the other write surface. All run as the user under RLS
and return `{ ok: true } | { ok: false, error, fieldErrors? }`.

| Action | File | Maps |
|---|---|---|
| `updateProfile`, `upsertPreferences`, `addAvailabilityWindow`, `removeAvailabilityWindow` | `app/(app)/actions.ts` | CHECK/UNIQUE constraint names → field messages |
| `registerForTournament(slug, role?)` | `app/(app)/tournaments/actions.ts` | 23505 → "You're already registered"; 42501 → "Registration is closed"; incomplete profile refused first |
| `unregisterFromTournament(slug)` | same | 0 rows deleted (RLS) → "Registration is closed…" |
| `submitFeedback` | `app/(app)/matches/actions.ts` | 23505 → already rated; 42501 → not completed / not a teammate |
