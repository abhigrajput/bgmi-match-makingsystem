# Architecture (summary)

Full detail lives in `docs/architecture.md`, `docs/database.md`, `docs/security.md`, `docs/deployment.md`. This file records the durable decisions and anything that changed since.

## Runtime
- Next.js 14 App Router on Vercel. Pages and server actions run as the user (anon key + session cookie, RLS enforced).
- Only `app/api/**/route.ts` and `scripts/` use the service role. `lib/supabase/admin.ts` takes the key as an argument.
- Supabase (Postgres, GoTrue, PostgREST) is the security boundary: 11 tables, 23 RLS policies, migrations 0001 to 0008.
- Scoring engine and logistic-regression model are pure TypeScript in `lib/scoring/` (no I/O).

## Auth and session
- `middleware.ts` + `lib/supabase/middleware.ts` refresh the session and gate protected prefixes (`/dashboard`, `/tournaments`, `/players`, `/leaderboard`, `/matches`, `/analytics`, `/profile`). Middleware is routing, not security.
- `getUser()` only, never `getSession()`.
- **Changed 2026-10-30 (fix/launch-hardening):** every Supabase call from middleware and server code goes through a fetch with a timeout (`lib/supabase/fetch-timeout.ts`). Middleware skips Supabase entirely for public routes when the request carries no auth cookie. On timeout or network failure, public routes render (signed out) and protected routes redirect to `/login?error=service`. Middleware can no longer hang until Vercel's 25 s limit.
- **Changed 2026-10-30:** auth errors are classified in one place, `lib/auth/errors.ts`, and both server actions use it. Service and rate-limit failures are no longer reported as a wrong password.
- **Changed 2026-10-30:** `NEXT_PUBLIC_SITE_URL` (through `siteUrl()` in `lib/site.ts`) is the only source for absolute URLs. Never request headers, so a forged Host cannot choose where an email link points.
- **Email links use the implicit flow** (`createEmailLinkClient()` in `lib/supabase/server.ts`). PKCE links only work in the browser that asked for them; a reset requested on a laptop and opened on a phone would fail. `/reset-password` and `/accept-invite` read the session from the URL fragment and wipe it from the address bar.
- **Signup data:** region goes to `profiles.region` through `handle_new_user()` (0007). The role stays in user metadata and pre-fills the preferences form, because a `player_preferences` row is what marks a player matchmaking-ready.
- **Staying awake:** `/api/health` does one read through `public_stats()`; `.github/workflows/keep-alive.yml` calls it every 3 days. `scripts/auth-health.ts` (daily, `.github/workflows/auth-health.yml`) proves signup and sign-in work, and checks the catalog through `schema_health()` (0008, service role only).

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

## Contact form and rate limits (0009)
`/contact` is a server action running as anon. `contact_messages`: anon and authenticated insert, organiser read, no update or delete, 200 an hour across all senders in the insert policy. `lib/rate-limit.ts` counts per IP through `rate_limit_hit()`, in Postgres because serverless instances share no memory, and stores only a hash of the IP. It fails open when the counter cannot be reached.

## SEO
`metadataBase` is `siteUrl()`. `lib/seo.ts` builds each public page's tags. Auth and signed-in layouts are noindex; `next.config.mjs` sends `X-Robots-Tag` for `/api` and `/auth`. The social card is a static PNG from `scripts/generate-icons.mjs`.
