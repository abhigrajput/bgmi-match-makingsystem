# Task: launch hardening

Branch `fix/launch-hardening` (from `main` at 9948f4b). AI briefing work is separate, on `feat/briefing` (59f064c).

## Current scope (user, 2026-10-30)
Local stack only, no production calls. Docs drafts; Phase 2 middleware (4 s timeout, fail-open on public routes); login and signup error mapping; reproduce the hang locally.

## Phase 1: diagnosis

| # | Check | Evidence | Status |
|---|---|---|---|
| A | Supabase paused | Management API: project status `INACTIVE`; `nvecxiezqshsbiulrckk.supabase.co` NXDOMAIN on 8.8.8.8; `/auth/v1/health` ENOTFOUND in 128 ms. User restored it 2026-10-30 (status `COMING_UP` at last read). | Root cause. Restore in progress |
| B | Middleware design | Runs on every non-asset path; awaits `getUser()` with no timeout. Local repro below: hangs past 40 s when Supabase does not answer. | Fail. Fixed in Phase 2 |
| C | Vercel env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Non-sensitive, Production only (missing for Preview). `NEXT_PUBLIC_APP_URL`: Sensitive. `NEXT_PUBLIC_SITE_URL`: absent. | Partial. Needs user |
| D | Auth URL config | Site URL = prod URL. Redirect list: `https://bgmi-match-makingsystem.vercel.app/**`, `http://localhost:3000/**`. | Pass |
| E | Trigger, RLS, 23 policies on prod | Not run: prod was paused, then user scoped work to local. | Pending |
| F | Signup mislabelling | Local: duplicate IGN returns `AuthRetryableFetchError` status 500 "Database error saving new user", the same error class as a network failure. Old code then mapped any "Database error saving new user" to IGN taken (correct today, since the trigger raises only for IGN), but mapped network failure to a generic message. | Partial. Fixed in Phase 2 |
| G | Email confirmation | Prod autoconfirm on, so no confirmation mail is sent. Mailer limit 2 per hour, no custom SMTP. | Noted for Phase 5 |
| H | Login code path | `redirect()` outside try: OK. Cookies: OK. Bug: every error, including network failure and rate limit, shown as "Incorrect email or password" (`app/(auth)/actions.ts:75`). Signup builds `emailRedirectTo` from the `origin` header. No forgot-password flow. | Fail. Mapping fixed in Phase 2 |
| E2E | Prod throwaway user | Not run (prod off-limits this task). | Pending |

### Local reproduction (dev server on :3100, local Supabase stack)
Signed-in = request carrying a real session cookie for a throwaway local user.

| Scenario | anon `/` | anon `/login` | signed `/` | signed `/dashboard` | login attempt |
|---|---|---|---|---|---|
| Healthy (warm) | 200, 138 ms | 200, 61 ms | 200, 184 ms | 200, 187 ms | `invalid_credentials` 400, 23 ms |
| Gateway frozen (`docker pause` kong) | **timeout > 40 s** | 200, 81 ms | **timeout > 40 s** | **timeout > 40 s** | **hung 305 s**, then `fetch failed`, shown as "Incorrect email or password" |
| Gateway stopped (`docker stop` kong) | 200, 155 ms | 200, 114 ms | 200, 148 ms | 307 to `/login`, no message | `fetch failed` in 12 ms, shown as "Incorrect email or password" |

Frozen gateway is the production failure mode (Vercel kills at 25 s). Anonymous `/` also hangs because the landing page's `public_stats()` call has no timeout.

## Phase 2 (this task): done, verified locally
- [x] `lib/supabase/fetch-timeout.ts`: per-request fetch timeout plus an overall deadline (auth-js retries a failed refresh for up to 30 s, so a fetch timeout alone is not enough). Wired into middleware (4 s protected, 1.5 s public), server client (8 s), public stats (1.5 s).
- [x] `middleware.ts`: no auth cookie means no Supabase call (public renders, protected goes to `/login`). Unreachable: protected goes to `/login?error=service`, public renders with `x-supabase-unreachable` so pages skip their own calls. Matcher also excludes `robots.txt`, `sitemap.xml`, `manifest.webmanifest`.
- [x] `lib/auth/errors.ts`: one classifier; login and signup actions use it; service and rate-limit failures get their own messages; structured log line with kind, status and code only.
- [x] `/login?error=service` banner; login, signup and landing pages skip Supabase when middleware flagged it.
- [x] Vitest: `lib/auth/__tests__/errors.test.ts` (16), `lib/supabase/__tests__/fetch-timeout.test.ts` (5).

### Results after the fix (same harness, dev server :3100, local stack)
| Scenario | anon `/` | signed `/` | signed `/login` | signed `/dashboard` | login form shows | signup dup IGN shows |
|---|---|---|---|---|---|---|
| Healthy | 200, 307 ms | 200, 571 ms | 307 to `/dashboard` | 200, 897 ms | "Incorrect email or password." | "That in-game name is already taken..." |
| Gateway stopped, BEFORE fix | | | | | "Incorrect email or password." | "Could not create the account..." |
| Gateway stopped, after | 200, 88 ms | 200, 66 ms | 200, 83 ms | 307 `/login?error=service`, 13 ms | "We can't reach the sign-in service..." (1.0 s) | same service message |
| Gateway frozen (hang), after | 200, 1617 ms | 200, 1588 ms | 200, 1557 ms | 307 `/login?error=service`, 4024 ms | service message (9.4 s) | service message (9.4 s) |

`tsc --noEmit`: exit 0. `vitest run`: 105 passed (84 existing + 21 new). `next lint`: no warnings or errors. Throwaway local user deleted, profile row confirmed gone.

### Not verified yet
- Expired access token refreshed through middleware across navigation and hard refresh (item 8): code path unchanged for healthy Supabase, but not exercised with an expired token.
- Server actions wait up to 8 s (server fetch timeout) during a hang; only middleware has the 4 s budget. Acceptable for a form submit, revisit if needed.
- Nothing deployed; production untouched after the user's instruction.

## Decisions and conflicts
- **Conflict, resolved by keeping sessions safe:** the prompt says "public routes never call Supabase". Taken literally, a signed-in user on a public page would have their token refreshed by the page's server component, which cannot write cookies. The rotated refresh token is lost, and the next use of the old one is rejected as reuse, signing the user out. So middleware skips Supabase on public routes only when there is no auth cookie (every anonymous visitor). Signed-in requests still refresh, with a shorter timeout on public routes and fail-open.

## Remaining (not in this task)
Phase 2 items 2 (password min 10, region/role at signup), 4 to 11; Phases 3 to 6; Phase 1 E and the prod E2E once production is confirmed `ACTIVE_HEALTHY`.
TODO(user): Vercel env: add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Preview; add `NEXT_PUBLIC_SITE_URL`. Answers needed for Phase 5: minimum age, governing law and jurisdiction, operator name and contact email.
