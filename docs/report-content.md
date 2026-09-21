# Project report content

Ready-to-paste chapter text for the project report. Numbers in the Results
chapter are copied from `docs/ml-results.md` and `docs/verification.md`, which
the scripts generate; if the model is retrained, update Chapter 10 from those
files. Figures refer to `docs/screenshots/`.

---

## Abstract

Squad-based battle royale games such as Battlegrounds Mobile India (BGMI)
usually group players by queue order, optionally filtered by a single skill
rating. The resulting squads often duplicate roles, mix incompatible
communication styles, share no language and have no overlapping play hours.
This project presents SquadSync, a web-based tournament matchmaking system that
models each player as a vector of measured skill, declared role and
communication preference, languages, region and weekly availability, and forms
squads that maximise pairwise compatibility subject to hard constraints. A
rule-based compatibility engine scores every pair on seven components and
enforces three hard vetoes (skill band, communication conflict, no common
language). A logistic-regression model, trained on post-match peer feedback,
predicts the probability that two players will rate each other highly and is
blended with the rule score. A deterministic greedy optimiser with swap-based
local search builds squads and explains each one. On a held-out test set of
1,440 player pairs the model reached ROC-AUC 0.783 against 0.723 for the rule
engine alone and 0.739 for rating proximity; on a 58-player demo tournament the
optimiser seated no incompatible pairs, where rank-only grouping seated 17.
The system is implemented in Next.js and TypeScript on Supabase (PostgreSQL)
with row-level security and is deployed on Vercel.

## 1. Introduction

Competitive mobile gaming in India has grown into organised college and
community tournaments. Organisers typically form squads either by letting
players self-organise or by ranking players on a single rating. Neither
accounts for what makes a squad function in BGMI: a shotcaller (IGL), an entry
fragger, long-range coverage and support; agreement on voice communication; a
shared language; and time when all four can actually play.

SquadSync treats squad formation as a constrained optimisation over player
compatibility. It collects measured skill and declared preferences, forms
squads for a tournament in one click, and shows for each squad why it was
formed and where its weakest link is. Post-match feedback closes the loop as
training data for a learned compatibility model.

## 2. Problem statement

Given the set of players registered for a tournament and a squad size *k*
(2–4), partition as many players as possible into squads of *k* such that

1. no two players in a squad violate a hard constraint (teammate skill band,
   silent vs voice-required communication, no common language), and
2. the mean compatibility of the resulting squads is maximised,

and, for every player who cannot be placed, state the constraint that
prevented it. The grouping must be deterministic, explainable, and measurably
better than grouping by rating alone.

## 3. Objectives

1. Model a player as a multi-dimensional vector rather than a single rating.
2. Define an interpretable pairwise compatibility score with hard vetoes.
3. Build a deterministic squad optimiser and compare it against a rank-only
   baseline on the same players.
4. Train a supervised model on peer feedback and evaluate it against
   rule-based, rank-only and majority-class baselines without data leakage.
5. Explain every formed squad in plain language.
6. Protect player data with database-enforced access control.
7. Deliver a responsive, accessible web application deployed to production.

## 4. Literature survey

**Rating systems.** Elo's system [1] models each player's skill as a single
number updated after each game from the expected versus actual result; it
remains the basis of most competitive ladders. Glickman's Glicko [2] adds a
rating deviation that captures uncertainty. Microsoft's TrueSkill [3] extends
Bayesian skill rating to teams and multiplayer outcomes, representing skill as
a Gaussian and inferring it with message passing; TrueSkill 2 [4] adds
game-specific signals such as individual performance statistics and squad
membership. These systems estimate skill well but answer "how good is this
player", not "how well do these players fit together".

**Matchmaking beyond skill.** Delalleau et al. [5] showed for an online
shooter that player satisfaction depends on more than skill balance and
proposed predicting match enjoyment from player features — the framing adopted
here, where the target is a teammate's post-match rating rather than a win.

**Recommender systems.** Recommending teammates is a people-to-people
recommendation problem. Resnick and Varian [6] framed recommender systems
generally; Koren, Bell and Volinsky [7] popularised latent-factor methods.
Collaborative approaches need interaction history the new platform does not
have, so this project uses a content-based score over declared and measured
features, with a learned component on top.

**Logistic regression and evaluation.** Logistic regression [8], [9] models the
log-odds of a binary outcome as a linear function of features; standardised
coefficients give a direct measure of feature influence. ROC-AUC [10], [11] is
used as the threshold-independent metric. Kaufman et al. [12] catalogue data
leakage in predictive modelling; the grouped train/test split used here follows
from their discussion.

## 5. System requirements

**Functional.** Sign-up and sign-in; player profile, preferences and weekly
availability; tournament listing, registration with an optional role and
withdrawal while open; one-click squad formation; squad view with reasons,
weakest link and unplaced players; optimiser vs baseline comparison; match
completion and per-teammate feedback; leaderboard with filters; analytics.

**Non-functional.** Players' preferences and schedules readable only by their
owner; deterministic formation; formation of 80 players in well under a
second; responsive layout down to 375 px; keyboard operability and WCAG AA
contrast; no secret in the client bundle or the repository.

**Software.** Node.js 20+, Next.js 14, TypeScript 5, Tailwind CSS, Supabase
(PostgreSQL 15, Auth), Vitest, Recharts. **Hardware:** any machine that runs
Node.js and Docker (for the local database).

## 6. System design

The system has three runtime parts (Figure: architecture diagram in
`docs/architecture.md`): the browser, a Next.js application on Vercel, and a
Supabase PostgreSQL database. Pages and server actions run as the signed-in
user with row-level security enforced; five API routes use the service role
after authenticating the caller. The scoring engine and the trained model are
TypeScript modules inside the web application; offline scripts seed data, train
the model and verify deployments.

The database (ER diagram in `docs/database.md`) has eleven tables: identity
(`profiles`), measured skill (`player_stats`), declared intent
(`player_preferences`, `player_availability`), tournaments and registrations,
matches, participants, peer feedback, and model versions. Twenty-three RLS
policies govern access; a definer view exposes only primary role for the
leaderboard; two definer functions return aggregates for public statistics and
analytics.

## 7. Methodology

**Pair compatibility.** For players *a* and *b*:
`score = 0.30·skill + 0.20·role + 0.15·availability + 0.10·comm + 0.10·language + 0.10·region + 0.05·teamwork`,
where skill = exp(−Δ²/(2·15²)) on the rating gap, role comes from a symmetric
5×5 affinity matrix (e.g. IGL–Assaulter 0.95, Sniper–Sniper 0.30) taking the
best combination of primary and secondary roles, availability is shared weekly
minutes after converting each window to UTC minute-of-week (handling
end-of-day, timezone shifts across midnight and the week boundary), saturating
at six hours, and language is Jaccard overlap. A skill-band violation, silent
vs voice-required, or no common language forces the score to 0.

**Squad score.** Mean pairwise score + 0.10 × (distinct roles / size) −
0.10 × (rating standard deviation / 50).

**Optimiser.** Players are queued by registration time. The first unassigned
player seeds a squad; candidates vetoed with any member are excluded; the
candidate maximising mean pair score plus a 0.15 bonus for a missing role joins
until the squad is full. A squad that cannot be completed returns its members
to the pool once; a second failure marks the seed unplaced with the dominant
blocking rule. Best-improvement single-player swaps between squads then run
for at most 200 iterations, never creating a vetoed pair. Roles within each
squad are assigned exhaustively to maximise coverage.

**Learned model.** Each directed feedback pair is an example; the label is
rating ≥ 4. Features are the seven component scores plus the raw rating gap,
computed from observable data. Logistic regression is trained by batch
gradient descent (learning rate 0.1, L2 0.01, 2,000 epochs) on standardised
features. At serving time the pair score is 0.7 × model probability + 0.3 ×
rule score; vetoes are applied first.

**Data.** With no real match history available, a seeded generator produces
200 players with hidden latent traits and noisy observable data, and 600 random
historical squads with feedback. Labels are computed only from the latent
traits, features only from the observables, so the model must recover a signal
seen through noise (declared role wrong 20% of the time, skill noise σ = 8, and
an unobservable toxicity term).

## 8. Implementation

Implemented as a Next.js 14 App Router application in TypeScript.
`lib/scoring/` contains the pure engine (`compatibility.ts`, `squad.ts`,
`baseline.ts`, `evaluate.ts`, `features.ts`, `logistic.ts`, `model.ts`).
Database access uses `@supabase/ssr` for per-request user sessions. The schema
is five ordered SQL migrations. The UI is built on a custom dark-first design
system (`components/ui/`) with a sidebar and a mobile tab bar; charts use
Recharts with a colour palette validated for colour-vision deficiency.
Production migrations are applied through the Supabase SQL Editor and verified
through the REST API by `scripts/verify-prod.ts`.

## 9. Testing

81 automated unit tests (Vitest) cover the compatibility components and
vetoes, the optimiser's invariants (no vetoed pair, no duplicate player,
determinism, beats the baseline on a fixed fixture), the model and its
fallback, and the API routes' status codes and rollback. A 24-check catalog
script verifies the schema, and a 36-check end-to-end script exercises pages,
API routes and attempted policy violations with a real session. CI runs type
checking, linting, tests and a production build on every push.

## 10. Results

**Model (held-out test set, 1,440 pairs from 120 unseen matches):**

| Scorer | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| Logistic regression | 0.724 | 0.734 | 0.830 | 0.779 | 0.783 |
| Rule-based | 0.697 | 0.744 | 0.739 | 0.741 | 0.723 |
| Rank-only (gap < 10) | 0.625 | 0.797 | 0.486 | 0.604 | 0.739 |
| Majority class | 0.588 | 0.588 | 1.000 | 0.740 | 0.500 |

Five-fold match-grouped cross-validation: F1 0.798 ± 0.012, ROC-AUC 0.804 ±
0.014. The largest standardised coefficients were skill (+0.72), language
(+0.52) and rating gap (−0.49); availability and region, which do not enter
the label-generating process, received near-zero weight — evidence that the
model recovered the real structure rather than noise.

**Squad formation (Hubballi Weekend Cup, 58 registered players):**

| Metric | Optimiser | Rank-only |
|---|---|---|
| Squads | 13 | 14 |
| Mean squad score (×100) | 95.1 | 76.9 |
| Vetoed pairs seated together | 0 | 17 |
| Role coverage | 96% | 89% |
| Mean rating spread | 10.0 | 3.9 |

The optimiser trades a slightly wider rating spread and one fewer squad for
the elimination of every incompatible pairing.

## 11. Conclusion

SquadSync shows that forming squads from a multi-dimensional player model with
hard constraints produces measurably more compatible squads than rating-only
grouping, and that a simple, explainable learned model improves on a
hand-tuned score when trained on peer feedback. Database-level access control,
deterministic formation and per-squad explanations make the system suitable
for organisers who must justify their squads.

## 12. Future scope

- Retrain on real post-match feedback and compare with the synthetic-trained
  model on held-out real matches.
- An organiser role, live queue-based matchmaking, and party (pre-made)
  support.
- Squad-level (not pairwise) models and gradient-boosted trees once data
  volume allows.
- Probability calibration and learned blend weights.
- Import of match statistics to compute ratings automatically.

## References

[1] A. E. Elo, *The Rating of Chessplayers, Past and Present*. New York: Arco, 1978.

[2] M. E. Glickman, "Parameter estimation in large dynamic paired comparison experiments," *Journal of the Royal Statistical Society: Series C (Applied Statistics)*, vol. 48, no. 3, pp. 377–394, 1999.

[3] R. Herbrich, T. Minka, and T. Graepel, "TrueSkill™: A Bayesian skill rating system," in *Advances in Neural Information Processing Systems 19*, 2007.

[4] T. Minka, R. Cleven, and Y. Zaykov, "TrueSkill 2: An improved Bayesian skill rating system," Microsoft Research, Tech. Rep. MSR-TR-2018-8, 2018.

[5] O. Delalleau, E. Contal, E. Thibodeau-Laufer, R. C. Ferrari, Y. Bengio, and F. Zhang, "Beyond skill rating: Advanced matchmaking in Ghost Recon Online," *IEEE Transactions on Computational Intelligence and AI in Games*, vol. 4, no. 3, pp. 167–177, 2012.

[6] P. Resnick and H. R. Varian, "Recommender systems," *Communications of the ACM*, vol. 40, no. 3, pp. 56–58, 1997.

[7] Y. Koren, R. Bell, and C. Volinsky, "Matrix factorization techniques for recommender systems," *Computer*, vol. 42, no. 8, pp. 30–37, 2009.

[8] D. R. Cox, "The regression analysis of binary sequences," *Journal of the Royal Statistical Society: Series B*, vol. 20, no. 2, pp. 215–242, 1958.

[9] D. W. Hosmer, S. Lemeshow, and R. X. Sturdivant, *Applied Logistic Regression*, 3rd ed. Hoboken, NJ: Wiley, 2013.

[10] J. A. Hanley and B. J. McNeil, "The meaning and use of the area under a receiver operating characteristic (ROC) curve," *Radiology*, vol. 143, no. 1, pp. 29–36, 1982.

[11] T. Fawcett, "An introduction to ROC analysis," *Pattern Recognition Letters*, vol. 27, no. 8, pp. 861–874, 2006.

[12] S. Kaufman, S. Rosset, C. Perlich, and O. Stitelman, "Leakage in data mining: Formulation, detection, and avoidance," *ACM Transactions on Knowledge Discovery from Data*, vol. 6, no. 4, 2012.
