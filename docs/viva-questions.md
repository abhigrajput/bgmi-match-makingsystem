# Viva questions and answers

Forty questions an examiner is likely to ask, answered from this codebase.
File references are where to point if asked to show it.

## Problem and design

**1. What problem does the project solve?**
Squads formed by queue order or a single rating ignore role coverage, comms,
language and play hours. We form tournament squads from a multi-dimensional
player model with hard constraints, and explain each squad.

**2. Why not just use a skill rating like Elo?**
Elo estimates *how good* a player is, not *how well two players fit*. Our
rank-only baseline is exactly "group by rating", and on the demo tournament it
seated 17 incompatible pairs together; the optimiser seated none.

**3. What is a "player vector"?**
`lib/scoring/types.ts` `PlayerVector`: overall rating and five skill axes,
primary/secondary role, comms preference, languages, region, teammate skill
band, weekly availability windows, registration time.

**4. Why are some rules vetoes instead of low scores?**
A silent player with a voice-required one is not a slightly worse squad, it is
one that will not function. Vetoes force the pair score to exactly 0 and the
optimiser never seats that pair, whatever the other components or the model say.

**5. What are the three vetoes?**
Rating outside either player's teammate skill band; silent vs voice-required;
no common language (`isHardIncompatible` in `compatibility.ts`).

**6. How are the component weights chosen?**
Domain judgement, documented in `WEIGHTS`: skill 0.30, role 0.20, availability
0.15, comms, language, region 0.10 each, teamwork 0.05. They sum to 1 (tested),
so a pair score reads as a fraction of ideal. The learned model then corrects
them from feedback.

**7. How does the skill score work?**
A Gaussian on the rating gap, exp(−Δ²/(2·15²)): identical ratings score 1, a
15-point gap about 0.61, a 100-point gap effectively 0.

**8. How is role compatibility computed?**
A symmetric 5×5 matrix (IGL–Assaulter 0.95, Sniper–Sniper 0.30, Flex with
anyone 0.75). We take the best value over each player's primary and secondary
roles and say in the reason when a secondary was used.

**9. How do you compute availability overlap across timezones?**
Each local window becomes a UTC minute-of-week interval: day·1440 + start −
offset, wrapped modulo 10080; a window crossing the week boundary is split.
Each player's intervals are merged, then intersected. Tests cover 24:00 ends,
IST shifting into the previous UTC day and Sunday→Saturday wrap.

**10. Why store availability as minutes, not `time` values?**
Overlap becomes integer interval arithmetic, 1440 can express "until
midnight", and there is no DST arithmetic (`0001_init.sql` comments).

## Optimiser

**11. Describe the squad-formation algorithm.**
Queue by registration time; seed with the first unassigned player; add the
candidate (not vetoed with anyone in the squad) maximising mean pair score plus
a 0.15 role-coverage bonus; repeat to size. Failed squads return to the pool
once; then best-improvement swaps between squads for up to 200 iterations
(`squad.ts`).

**12. Is it optimal?**
No. Partitioning into squads of four maximising total compatibility is
NP-hard. Greedy plus local search is deterministic, fast (about 30 ms for 80
players) and never violates a veto, which matters more here than optimality.

**13. Why must it be deterministic?**
An organiser who forms squads twice on the same registrations must get the
same squads. There is no randomness; ties break by registration order; a test
reverses the input order and checks the output is identical.

**14. What happens to players who can't be placed?**
They are listed with a reason: the dominant veto against the remaining pool
(e.g. "vetoed with 5 of 9 remaining players, mostly on language") or that the
pool ran out.

**15. How is the squad score defined?**
Mean pairwise score + 0.10 × distinct roles/size − 0.10 × rating standard
deviation/50.

**16. Why is the baseline's rating spread better than yours?**
Rank-only sorts by rating and cuts consecutive groups, so spread is minimal by
construction. It pays for that by ignoring every other factor, including
vetoes.

## Machine learning

**17. What does the model predict?**
The probability that one teammate rates another 4 or 5 out of 5 after a match.

**18. Why logistic regression?**
Eight features and ~7,200 examples; coefficients are the explanation; it
trains in milliseconds in TypeScript, so there is no separate Python service
to deploy or fail.

**19. What are the features?**
The seven component scores plus the raw rating gap (`features.ts`), computed
from observable data.

**20. Where does the training data come from?**
A seeded synthetic generator (`scripts/seed.ts`): 200 players, 600 random
historical squads, feedback for every directed pair.

**21. Isn't training on synthetic data circular?**
It would be if labels came from the features. Labels come from hidden latent
traits (true skill, true role, toxicity) that never reach the database;
features come from noisy observables. Toxicity has no observable proxy at all.

**22. How did you prevent data leakage?**
Split by match, not by row, because both directions of a pair share identical
features; standardisation statistics from training rows only; baseline
thresholds tuned on training rows only.

**23. What were the results?**
Test AUC 0.783 vs 0.723 rule-based, 0.739 rank-only, 0.500 majority; 5-fold CV
AUC 0.804 ± 0.014 (`docs/ml-results.md`).

**24. What does the model consider most important?**
Skill (+0.72), language (+0.52), rating gap (−0.49), then comms. Availability
and region get almost no weight, which is correct: they are not in the
label-generating formula.

**25. Why tune the rule baseline's threshold for accuracy, not F1?**
With 59% positives, predicting "always positive" already scores F1 ≈ 0.74, so
an F1-tuned threshold collapses to that and the baseline stops discriminating.

**26. How is the model used in production?**
`model.json` is imported at build time. Pair score = 0.7 × model probability +
0.3 × rule score, vetoes checked first. If the file is invalid, the rule scorer
is used and squads are stamped `rule_based`.

**27. How would you know if the model is worse than rules on real data?**
`matches.scoring_source` records which scorer formed each squad; real feedback
on both populations can be compared directly.

## Database and security

**28. Why Supabase / PostgreSQL?**
Relational data with strong constraints, row-level security as the access
model, and hosted Auth.

**29. What is row-level security and why rely on it?**
Policies evaluated by Postgres on every row. The anon key is public and
PostgREST is reachable directly, so only the database can enforce access
reliably; middleware is a convenience.

**30. How can the leaderboard show roles if preferences are private?**
`leaderboard_v` is a definer view exposing `primary_role` and nothing else
from preferences, granted to signed-in users only.

**31. How does analytics count everyone's matches if RLS hides them?**
`analytics_overview()` is a `SECURITY DEFINER` function returning aggregates
only, with a pinned `search_path`. Pages are never given the service role.

**32. Where is the service-role key used?**
Only in `app/api/**/route.ts` and `scripts/`; `lib/supabase/admin.ts` takes it
as a parameter so grep audits every use. Each route authenticates first.

**33. What stops a player registering someone else?**
The INSERT policy requires `profile_id = current_profile_id()`; the e2e script
attempts it and gets 42501.

**34. What happens if two people press "Form squads" at once?**
Both pass the checks, but only one wins the conditional UPDATE
`status 'open' → 'matched'`; the other receives 409.

**35. What is `is_seed` for, and how is it protected?**
It marks synthetic rows so reseeding never touches real data. A trigger forces
it to false for client roles, so a player cannot flag their own rows.

**36. How are production migrations applied without the CLI?**
Written and verified locally, pasted into the Supabase SQL Editor, then
verified through REST by `scripts/verify-prod.ts`. Migrations are idempotent.

## Engineering

**37. How is the UI kept accessible?**
Visible focus rings, labelled inputs, aria-live toasts, native `<dialog>` and
`<details>`, WAI-ARIA tabs, star ratings as a radio group, colour never the only
signal (role badges carry icons and labels), chart palette validated for CVD.

**38. How is the project tested?**
81 unit tests, a 24-check catalog script, a 14-check REST verifier and a
36-check end-to-end script that attempts RLS violations; CI on every push.

**39. What are the main limitations?**
Synthetic training data; no organiser role (any signed-in player can form
squads); pairwise rather than squad-level modelling; ratings not computed from
real match imports.

**40. What would you build next?**
Train on real feedback, add an organiser role and live queue matchmaking,
model squads as a whole, calibrate the model and learn the blend weight.
