# Rules

Working rules for this repo. Source: the launch-hardening master prompt (2026-10-30) and existing practice in docs/.

## Secrets
1. Never print, log, commit or echo a secret value. Report only names and set / empty.
2. Only `NEXT_PUBLIC_*` values may reach the browser. The service role key is read only in `app/api/**/route.ts` and `scripts/`.
3. `.env.local` and `.env.production.local` stay git-ignored.

## Data and schema
4. New migrations only (0007 onward). Never edit an applied migration.
5. No deleting or renaming production fields without a written migration plan.
6. Production DB is never reached by CLI, psql or pooler. Apply locally first with rollback SQL in Task.md, then the user pastes into the SQL Editor, or the agent uses the Management API when the user has said so for that migration. Verify through REST.

## Change discipline
7. Diagnose before changing. Findings go into Task.md first.
8. Reproduce a failure before claiming it is fixed, then show it passing. Report real output.
9. No unrelated refactors. Stay inside Task.md scope.
10. If requirements conflict, stop and report the conflict.
11. Do not invent content: IDs, domains, emails, phone numbers, company or legal details, testimonials, counts. Missing values become env vars or a named TODO in Task.md, and the UI hides the element.
12. Update Task.md at the end of each phase. Update Architecture.md or Design.md in the same change when a durable decision changes.

## Code
13. TypeScript strict. Zod at every boundary (forms, route bodies, env).
14. `getUser()`, never `getSession()`, for any access decision.
15. `redirect()` is never called inside a try block.
16. Users never see raw Supabase, Postgres or stack-trace text. Errors go through `lib/auth/errors.ts` (auth) or an explicit mapping.
17. Every network call to Supabase from middleware or server rendering has a timeout.

## Git
18. One concern per commit. Branch per piece of work; merge to `main` only when the user has authorised that merge, then verify production and revert the merge if it fails.

## Processes
19. Never kill a process by port owner. Verify image name and command line first. No `taskkill /T` on an unverified PID. Never PID 0, PID 4, or anything that is not this project's own process.
