# Task: launch hardening

Branch `fix/launch-hardening` (from `main` at 9948f4b). AI briefing work is separate, on `feat/briefing` (59f064c).
This file is longer than the two-screen target because the migration safety section below was asked for in full here.

## Progress (2026-10-30)
| Item | Status | Evidence |
|---|---|---|
| Phase 1: diagnosis | Done | Table below. Prod catalog read through `schema_health()` on 2026-10-30, see "Production check" |
| Phase 2.1 middleware | Done | Local hang and refused-connection tests, below |
| Phase 2.2 signup validation, error mapping | Done | e2e, Vitest |
| Phase 2.3 login mapping | Done | e2e, Vitest |
| Phase 2.4 forgot and reset password | Done locally | e2e, real email through local mail catcher |
| Phase 2.5 `NEXT_PUBLIC_SITE_URL` | Done for email links | `lib/site.ts`, Vitest. OG, sitemap and canonical do not exist yet (Phase 5) |
| Phase 2.6 resend with cooldown | Done locally | e2e, real email through local mail catcher |
| Phase 2.7 sign out to `/` | Done | e2e |
| Phase 2.8 session refresh | Done locally | e2e: expired token on protected and public pages |
| Phase 2.9 `scripts/auth-health.ts` + schedule | Done, scheduled job is anon-only | See "Workflows" |
| Phase 2.10 keep-alive + `/api/health` | Done, starts after merge | Local 200 up, 503 down, 200 recovered |
| Phase 2.11 tests | Done | Below |
| Migrations 0007, 0008 on production | Applied, verified 2026-10-30 | 0007: a real account saved region India-South. 0008: `schema_health()` answers. See "Production check" |
| Build without Supabase settings | Done locally | Reproduced 500s, then a no-key production build. See "Production check" |
| Phases 3 to 6 | Not started | |

Gates at 12269e2: `tsc --noEmit` exit 0; `vitest run` 134 passed in 10 files; `next lint` no warnings or errors; `scripts/e2e-auth.ts --target local` 37/37 (includes cleanup: 2/2 users deleted, 0 profile rows left).

Production, before this branch was deployed anywhere: `verify-prod` 15/15 and `e2e-auth` 11/11 against the old deployment on 2026-10-30 (test user deleted).

## Production check (2026-10-30, second run)
An earlier run the same day found both migrations absent. They have since been applied by the user. Real output below.

| Step | Result |
|---|---|
| `verify-prod --target prod` | 22/23, exit 1. Only FAIL: `schema_health() refused to anon`, because `PROD_SUPABASE_ANON_KEY` is not set, so `profiles refused to anon` did not run either. PASS: 11 tables all with RLS, 23 policies, `handle_new_user()` exists, is `SECURITY DEFINER`, pins `search_path`, trigger enabled, every definer function pins `search_path`. 201 profiles, 624 matches, unchanged |
| `auth-health --target prod --base <72mxkmync preview>` | 14 PASS, 2 FAIL, exit 1. PASS includes region saved (India-South), sign in, test user and profile deleted (0 rows left). FAIL: deployment `/api/health` and `/login`, HTTP 302 from Vercel Authentication, because `VERCEL_BYPASS` is not set |
| `e2e-auth --target prod` on the preview | **Not run.** No bypass, so it could not reach the app |
| Playwright at 375 and 1440 px | **Not run.** Same reason. Console errors, failed requests and overflow are unknown on the preview |
| Preview `dpl_4aVzigeD3Aw9UxhdFtDD7mdVud9d` (1921652), through the Vercel connector | `/api/health` 200 `{"status":"ok","database":"ok"}`, so the anon key is in this build. `/`, `/login`, `/signup`, `/forgot-password` all 200. No JavaScript was run, so this says nothing about layout or console |

Vercel made no deployment for 12269e2 in the 12 minutes after that push (no status on the commit, none in the deployment list, none queued or failed). The runs above used 1921652, which has the anon key but not the fix below. That fix changes behaviour only when settings are missing.

Build without `NEXT_PUBLIC_SUPABASE_ANON_KEY`, local production build, not a deployment:

| Route | Before | After |
|---|---|---|
| `/login`, `/signup` | 500 | 200 |
| `/api/health` | 503 `misconfigured` | 503, also `"missing":["NEXT_PUBLIC_SUPABASE_ANON_KEY"]` |
| `/dashboard`, with or without a cookie | 307 `/login` | 307 `/login?error=service` |
| `/auth/callback?code=x` | 500 | 307 `/login?error=service` |
| `POST /auth/signout` | 500 | 303 `/` |
| `/`, `/forgot-password`, `/reset-password`, `/accept-invite` | 200 | 200 |

After the fix, submitting the login and forgot-password forms shows the service message, `/reset-password` shows it instead of the error screen, and the browser reported 0 page errors. `lib/api/auth.ts` now answers 503 for API routes in this state; that path has no test.

Found along the way:
- Vercel functions run in `iad1`, the database in `ap-south-1`, so every query crosses that distance. Not measured.
- The Vercel connector creates or reuses temporary share links on the previews it fetches (`qwn5shuaa`, `72mxkmync`). They expire in 23 hours and work for anyone with the URL.

## Not verified yet
- **The fix for missing settings on a deployment:** 12269e2 has not been built by Vercel.
- **`e2e-auth` and the Playwright viewport check on any preview:** both need `VERCEL_BYPASS`.
- **Anon refused `schema_health` and `profiles` on production:** needs `PROD_SUPABASE_ANON_KEY`.
- **New code on production:** nothing from this branch is deployed there.
- **Real email delivery on the hosted project.** Forgot-password and resend were exercised with real messages only on the local mail catcher. On a hosted target the e2e uses a generated recovery link instead, to avoid mailing a fake address and spending the 2-per-hour limit.
- **Resend on hosted:** autoconfirm is on, so production never produces an unconfirmed account today.
- **Expired token:** simulated by setting `expires_at` in the past in the session cookie, with a genuine refresh token, on a dev server. Not an actual hour-old session and not a production build.
- **Workflows on GitHub:** neither has run. Scheduled workflows run only from the default branch.
- **Local hang test results** predate the later auth changes; they were not re-run at the final commit.

## Phase 1: diagnosis
| # | Check | Evidence | Status |
|---|---|---|---|
| A | Supabase paused | Management API `INACTIVE`; hostname NXDOMAIN on 8.8.8.8; `/auth/v1/health` ENOTFOUND in 128 ms. Restored by the user. | Root cause, resolved |
| B | Middleware design | Awaited `getUser()` with no timeout. Hung past 40 s locally. | Fixed |
| C | Vercel env | `NEXT_PUBLIC_SUPABASE_URL` now Production, Preview, Development. `NEXT_PUBLIC_SUPABASE_ANON_KEY` Production only. `NEXT_PUBLIC_SITE_URL` Production. | Partial, needs user |
| D | Auth URL config | Site URL = prod URL. Redirects: prod `/**`, `http://localhost:3000/**`. | Pass |
| E | Schema on prod | `verify-prod` 15/15 over REST; trigger proven by a real signup. Catalog facts need 0008. | Partial |
| F | Signup mislabelling | Duplicate IGN is `AuthRetryableFetchError` 500 "Database error saving new user", the same class as a network failure. Now classified by message first. | Fixed |
| G | Email confirmation | Prod autoconfirm on. Mailer limit 2 per hour, no custom SMTP. | Open, Phase 5 |
| H | Login code path | Every error was shown as "Incorrect email or password". | Fixed |
| E2E | Prod throwaway user | 11/11 against the old deployment, user deleted. | Pass |

Local reproduction, dev server, gateway frozen with `docker pause`: signed-in pages and anonymous `/` hung past 40 s, a login attempt hung 305 s then showed a wrong-password message. After the fix: public pages at most 1617 ms, protected redirect at 4024 ms, form shows the service message in about 9.4 s. Gateway stopped: form shows the service message in about 1 s (before: "Incorrect email or password.").

## Migration safety: 0007 and 0008
**Nothing here has been applied to production. The user applies both.** Every result below was observed on the local stack.

**Order: migrate first, then deploy.** Paste 0007, then 0008, into the hosted SQL Editor. Then merge, which deploys. Both are safe if the order slips (see compatibility), but only this order saves regions from the first new signup.

### 0007_signup_region.sql
**Changes:** `CREATE OR REPLACE` of `public.handle_new_user()`, adding one variable `v_region`, read from `raw_user_meta_data ->> 'region'` (trimmed; blank or over 40 characters becomes NULL), and inserting it into `profiles.region`. No table, column, grant, policy or trigger changes. The trigger keeps working: it references the function, which keeps its identity.

**`SECURITY DEFINER` and pinned `search_path`:** `CREATE OR REPLACE` resets attributes, so both are restated.
```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
```
Observed after applying: `prosecdef = t`, `proconfig = {"search_path=public, pg_temp"}`, owner `postgres`.

**Rollback** (tested locally; `prosecdef` stayed `t`, signups worked). Regions already saved stay in `profiles.region`, which is harmless because the column predates this migration.
```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_display_name text;
    v_bgmi_ign     text;
    v_constraint   text;
begin
    v_display_name := btrim(coalesce(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        ''
    ));
    if v_display_name = '' then
        v_display_name := btrim(split_part(coalesce(new.email, ''), '@', 1));
    end if;
    if v_display_name = '' then
        v_display_name := 'Player ' || left(replace(new.id::text, '-', ''), 6);
    end if;

    v_bgmi_ign := btrim(coalesce(new.raw_user_meta_data ->> 'bgmi_ign', ''));
    if v_bgmi_ign = '' then
        v_bgmi_ign := 'player_' || left(replace(new.id::text, '-', ''), 12);
    end if;

    begin
        insert into public.profiles (auth_user_id, display_name, bgmi_ign)
        values (new.id, v_display_name, v_bgmi_ign)
        on conflict (auth_user_id) do nothing;
    exception
        when unique_violation then
            get stacked diagnostics v_constraint = constraint_name;
            if v_constraint = 'profiles_bgmi_ign_key' then
                raise exception 'bgmi_ign "%" is already taken', v_bgmi_ign
                    using errcode = '23505',
                          detail  = format('profiles.bgmi_ign is UNIQUE; signup for auth user %s was rolled back.', new.id),
                          hint    = 'Choose a different in-game name and sign up again.';
            end if;
            raise;
    end;

    return new;
end;
$$;

comment on function public.handle_new_user() is
    'AFTER INSERT trigger on auth.users. Provisions the profiles row inside the signup transaction. See the comment block above the definition for why this is not a client API call.';

revoke execute on function public.handle_new_user() from public;
```

**Backward compatibility** (signups run through the anon key with each code's metadata shape):
| Database | Old code shape (no region) | New code shape (region, role) |
|---|---|---|
| 0007 applied | Signup ok, region NULL, as today | Signup ok, region saved |
| 0007 missing | Signup ok, region NULL | Signup ok, **region NULL**: the region is silently not saved |

So new code does not break without 0007, but it does lose the region. Those players can set it on their profile page. `e2e-auth` check "signup region saved" fails in that state, by design.

### 0008_schema_health.sql
**Changes:** adds one function, `public.schema_health()`, returning catalog metadata as JSON: `handle_new_user` attributes, the trigger, table and RLS counts, policy count, definer functions without a pinned `search_path`. It reads no row data and writes nothing. `EXECUTE` is revoked from `public`, `anon` and `authenticated` and granted to `service_role`. Observed grantees: `postgres`, `service_role`; anon gets `42501`.

**Header:**
```sql
create or replace function public.schema_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
```
**Rollback** (tested locally):
```sql
drop function public.schema_health();
```
**Backward compatibility:** old code never calls it, so it is unaffected. New app code never calls it either, so the app works without it. Without 0008, only the tooling reports it: `auth-health --target` and `verify-prod` fail their catalog check (observed: `PGRST202`, exit 1). If that error persists right after applying, PostgREST has a stale schema cache: run `notify pgrst, 'reload schema';`.

### Verification queries (SQL Editor, after applying)
```sql
-- Expect handle_new_user: t, {"search_path=public, pg_temp"}
-- Expect schema_health:   t, {"search_path=pg_catalog, public, pg_temp"}
select p.proname, p.prosecdef as security_definer, p.proconfig, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('handle_new_user', 'schema_health')
order by p.proname;

-- Expect one row, tgenabled = O.
select t.tgname, t.tgenabled, c.relname, pg_get_triggerdef(t.oid) as def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created';

-- Expect 11 and 11.
select count(*) as public_tables,
       count(*) filter (where c.relrowsecurity) as with_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- Expect 23.
select count(*) as policies from pg_policies where schemaname = 'public';
```
Local results: both functions as expected; trigger `O` on `users`; 11 and 11; 23.

## Workflows
- `keep-alive.yml`: no secrets, `permissions: {}`.
- `auth-health.yml`: the repository is **public** (GitHub API: `"visibility": "public"`), so the scheduled job holds no service role key. It runs `auth-health.ts --anon`: `/api/health`, `/login`, signed-out `/dashboard` redirect. With the optional repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (public values) it also checks the auth server and that anon is refused `schema_health()` and `profiles`.
- The full check (real account, catalog) stays a manual local script: `npx tsx scripts/auth-health.ts --target prod`.
- Local: anon mode 6/6 and exit 0 when up; both modes exit 1 with the gateway stopped. Without the two variables, anon mode prints SKIP for those three checks.

## Tests
`e2e-auth.ts` 37 checks locally: signed-out redirect, password rule, signup, profile row, region, role pre-fill, sign out (lands on `/`, cookie gone), wrong password, sign in, hard refresh, expired token on `/dashboard` and on `/` (rotation saved, next pages signed in), recovery link, reset, old password refused, new password works, duplicate email, duplicate IGN, forgot-password form and real email, unknown email same notice, unconfirmed login, resend with countdown, real confirmation email signs in, cleanup.

Harness notes, because an earlier run had 5 FAILs and a later one hung:
- The 5 FAILs: `networkidle` is reached once per document and then returns at once, so the checks read the page before React rendered the result. After the harness waited for the page to stop changing, all 5 passed with no assertion changed.
- The hang: Playwright's `response.finished()` never resolves for the 303 from a redirecting server action. Tested directly: POST 303 in 606 ms, page on `/dashboard`, `finished()` still pending at 15 s. The wait is now bounded.

## Decisions
- **Public routes and Supabase:** middleware skips Supabase on public routes only when there is no auth cookie. A signed-in visitor is still refreshed, because the page's server component cannot save a rotated refresh token and the user would be signed out on the next protected page. The e2e covers this.
- **Role at signup** stays in user metadata and pre-fills preferences. A `player_preferences` row marks a player matchmaking-ready, so creating one would enrol them on defaults they never chose.
- **Email links are implicit-flow**, so a reset requested on one device can be opened on another. No dashboard email template change is needed.
- **Resend cooldown:** a 60 s cookie drives the countdown. GoTrue's own limits are the real enforcement, since a script can drop a cookie.
- **Sign out** also deletes the session cookies directly, so it still works when Supabase is unreachable.

## ASSUMPTIONS
- ASSUMPTION: `India-East` is offered at signup alongside the three regions on production, so players there are not forced into a wrong one.

## Needs the user
2. Vercel: add a Protection Bypass for Automation, and set its value locally as `VERCEL_BYPASS`.
4. `.env.production.local`: add `PROD_SUPABASE_ANON_KEY`, so `verify-prod --target prod` can prove anon is refused.
5. Optional: repository variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
6. Phase 5 answers: minimum age, governing law and jurisdiction, operator name and contact email.
7. Supabase dashboard (Phase 5): password minimum 10 (still 6, so only the app's forms enforce it), leaked password protection, email confirmation, custom SMTP.

## Remaining
Phases 3 to 6. `NEXT_PUBLIC_APP_URL` is no longer read by the app and can be removed from Vercel once this is live.
