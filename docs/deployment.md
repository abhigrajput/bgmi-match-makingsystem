# Deployment

Live: https://bgmi-match-makingsystem.vercel.app (Vercel, Git integration on
`main`). Database: hosted Supabase project `nvecxiezqshsbiulrckk`.

## Environments

| | Local | Production |
|---|---|---|
| Next.js | `npm run dev` | Vercel, auto-deploy on push to `main` |
| Supabase | Docker stack via `npx supabase start` | Hosted project |
| App env | `.env.local` | Vercel project env |
| Script env | `.env.local` | `.env.production.local` (git-ignored) |

### Variable names

| Name | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | public; RLS limits it |
| `SUPABASE_SERVICE_ROLE_KEY` | API routes (server only) | never `NEXT_PUBLIC_` |
| `PROD_SUPABASE_URL`, `PROD_SUPABASE_SERVICE_ROLE_KEY` | `scripts/ --target prod` | `.env.production.local` only |
| `NEXT_DIST_DIR` | optional | build into another folder while `next dev` runs |

## Migration workflow (production)

There is **no Supabase CLI, psql or pooler access to production** — the
database password path was unreliable, so it was removed from the process
entirely.

1. Write the migration in `supabase/migrations/`.
2. Apply locally: `npx supabase migration up --local`.
3. Verify locally: `phase_b_verify.sql` against the local DB and
   `npx tsx scripts/verify-prod.ts --target local`.
4. Paste the migration file into the hosted **SQL Editor** and run it.
   Migrations are written to be idempotent, so a second paste is harmless.
5. Verify on production through REST:
   `npx tsx scripts/verify-prod.ts --target prod` (optionally also paste
   `phase_b_verify.sql` into the SQL Editor). Never assume it applied.

## Data and model on production

```bash
npx tsx scripts/seed.ts   --target prod   # synthetic players, tournaments, history
npx tsx scripts/train.ts  --target prod   # model.json + model_versions row + docs/ml-results.md
git commit lib/scoring/model.json docs/ml-results.md && git push   # redeploys with the model
```

The seed only deletes `is_seed` rows on account-less profiles; real accounts
are untouched.

## Release checks

Every phase passed before commit: `tsc --noEmit`, `next lint`, `vitest run`,
`next build`; then `git push` and `npx vercel ls --prod` showing the new
deployment **Ready**.
