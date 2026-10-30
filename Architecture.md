# Architecture (summary)

Full detail lives in `docs/architecture.md`, `docs/database.md`, `docs/security.md`, `docs/deployment.md`. This file records the durable decisions and anything that changed since.

## Runtime
- Next.js 14 App Router on Vercel. Pages and server actions run as the user (anon key + session cookie, RLS enforced).
- Only `app/api/**/route.ts` and `scripts/` use the service role. `lib/supabase/admin.ts` takes the key as an argument.
- Supabase (Postgres, GoTrue, PostgREST) is the security boundary: 11 tables, 23 RLS policies, migrations 0001 to 0006.
- Scoring engine and logistic-regression model are pure TypeScript in `lib/scoring/` (no I/O).

## Auth and session
- `middleware.ts` + `lib/supabase/middleware.ts` refresh the session and gate protected prefixes (`/dashboard`, `/tournaments`, `/players`, `/leaderboard`, `/matches`, `/analytics`, `/profile`). Middleware is routing, not security.
- `getUser()` only, never `getSession()`.
- **Changed 2026-10-30 (fix/launch-hardening):** every Supabase call from middleware and server code goes through a fetch with a timeout (`lib/supabase/fetch-timeout.ts`). Middleware skips Supabase entirely for public routes when the request carries no auth cookie. On timeout or network failure, public routes render (signed out) and protected routes redirect to `/login?error=service`. Middleware can no longer hang until Vercel's 25 s limit.
- **Changed 2026-10-30:** auth errors are classified in one place, `lib/auth/errors.ts`, and both server actions use it. Service and rate-limit failures are no longer reported as a wrong password.

## Environments
| | Local | Production |
|---|---|---|
| Supabase | Docker stack (`npx supabase start`) | Hosted project `nvecxiezqshsbiulrckk`, free tier, region ap-south-1 |
| App env | `.env.local` | Vercel project env |
| Scripts | `.env.local` | `.env.production.local` (git-ignored) |

Production schema changes: no CLI, psql or pooler. Apply locally, paste the file into the hosted SQL Editor, verify through REST (`scripts/verify-prod.ts`).

## Production auth settings (read 2026-10-30, read-only)
Site URL is the production URL; redirect list is `https://bgmi-match-makingsystem.vercel.app/**` and `http://localhost:3000/**`; autoconfirm on (no confirmation email); minimum password length 6; leaked password protection off; JWT expiry 3600 s; email send limit 2 per hour; no custom SMTP; no OAuth providers enabled. Target values are tracked in Task.md.

## Known operational risk
Free-tier projects auto-pause when idle. A paused project's hostname returns NXDOMAIN. This happened on 2026-10-30 and caused the login failures (Task.md, Phase 1).
