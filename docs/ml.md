# Machine learning: the match-success model

Every number referred to here lives in [`ml-results.md`](ml-results.md), which
`scripts/train.ts` rewrites on each run. This page explains the method; that
page reports what the method produced.

## 1. Framing

Squad formation needs a pair score: "how well would A and B play together?"
Phase C answers that with hand-set rules (`lib/scoring/compatibility.ts`). The
model answers a narrower, checkable version of the same question:

> Given two players' observable data, what is the probability that one rates
> the other **4 or 5 out of 5** after playing together?

That is binary classification over **directed teammate pairs**: every row in
`match_feedback` (rater → ratee, one match) is one example.

## 2. Why logistic regression

| Consideration | Consequence |
|---|---|
| 8 features, ~7,200 labelled pairs | A linear model has enough capacity; a deep one would mostly fit noise. |
| The squad page must explain itself | Standardised coefficients *are* the explanation, and they fit on one slide. |
| No Python on the deploy target | Training and inference are ~100 lines of TypeScript (`lib/scoring/logistic.ts`) with no dependencies. |
| Request-time reliability | The model is a JSON file imported at build time. There is no service that can be down, so no fallback is exercised in normal operation. |

Training is full-batch gradient descent on L2-regularised log loss
(learning rate 0.1, L2 0.01, 2000 epochs). The bias is not regularised.

## 3. Where the data comes from

The project has no real match history, so `scripts/seed.ts` generates it from a
fixed seed (`bgmi-synthetic-v1`):

- **200 players** with hidden *latent* traits: true skill ~ N(55, 15) clipped to
  5–95, true role, true comms style, true languages (en, hi, kn, ta, te, mr) and
  toxicity ~ Beta(2, 8).
- **Observable** data derived from the latents plus noise: five skill axes =
  true skill + N(0, 8); the declared role is the true role only 80% of the time;
  a teammate skill band of rating ± 20–40; 1–3 weekly windows clustered in the
  18:00–24:00 IST evening.
- **600 historical matches** of four *randomly* chosen players — deliberately
  not formed by the optimizer, so the data covers bad squads as well as good.
- **Feedback for every directed pair** (12 per match).

## 4. Why the labels are not circular

This is the property that makes the metrics mean anything.

Labels are computed **only from latents**:

```
tc = 0.35 · exp(−|Δ true_skill|² / 450)
   + 0.25 · role_matrix(true roles)
   + 0.15 · comm_match(true comms)
   + 0.15 · jaccard(true languages)
   + 0.10 · (1 − mean toxicity)
rating = clip(round(1 + 4 · sigmoid(6 · (tc − 0.5)) + N(0, 0.7)), 1, 5)
label  = rating ≥ 4
```

Features are computed **only from observables** — the same component scorers
the app uses, applied to the noisy database values. The latents are written to
`scripts/.seed-latent.json` (git-ignored) and never to the database.

So the model has to recover a signal it can only see through noise: a declared
role that is wrong 20% of the time, skill axes with σ = 8 of noise, and
toxicity, which moves ratings but has **no observable proxy at all**. If labels
were computed from the observable features, the model could re-derive the
formula and score near-perfectly, and the result would say nothing.

A useful sanity check follows from this: availability and region do not appear
in the label formula, so a model that is learning the real structure should
give them near-zero weight. See the importance table in `ml-results.md`.

## 5. Features

`lib/scoring/features.ts`, in this order (the order is checked when the model
is loaded):

| # | Feature | Source |
|---|---|---|
| 1 | `skill` | Gaussian of the rating gap, σ = 15 |
| 2 | `role` | Role-matrix affinity, best over primary/secondary |
| 3 | `availability` | Shared weekly minutes (UTC), saturating at 6 h |
| 4 | `comm` | Comms compatibility table |
| 5 | `language` | Jaccard overlap of languages |
| 6 | `region` | Same 1 / different 0.5 / unknown 0.8 |
| 7 | `teamwork` | Mean of the two teamwork axes |
| 8 | `abs_rating_diff` | Raw absolute rating gap |

The raw gap sits beside the Gaussian skill score so the model can learn a
different shape than our prior if the feedback disagrees with it.

## 6. Leakage prevention

- **Split by match, not by row.** The two directions of a pair have identical
  features. A row-level split would put (A→B) in train and (B→A) in test and
  inflate every metric. Matches are shuffled with a fixed seed, sorted by their
  positive rate and dealt into five folds round-robin, so each fold is
  stratified. Fold 0 is the 20% test set; all five are used for CV.
- **Standardisation uses training statistics only.**
- **Baseline thresholds are tuned on training rows only.**
- **Latents never reach the database or the feature code.**

## 7. Baselines

All evaluated on the same test rows:

| Baseline | Rule |
|---|---|
| Rule-based | Phase C `pairScore`, threshold tuned for accuracy on train. (An F1-tuned threshold collapses to "always positive" at this class balance, turning it into the majority baseline.) |
| Rank-only | Positive iff the rating gap is under 10 — what "skill-based matchmaking" usually means. |
| Majority class | Always predict the training majority. |

## 8. How the model is used

`lib/scoring/model.ts` loads `lib/scoring/model.json` and scores a pair as

```
score = 0.7 · P(rating ≥ 4) + 0.3 · rule-based pairScore
```

**Hard vetoes are applied first and always win**: a silent player is never
seated with a voice-required one, however confident the model is. The squad is
stamped `scoring_source = 'ml'`. If `model.json` is missing or fails
`isValidModel()` (wrong feature order, non-finite weights, zero std), the app
uses the rule-based scorer and stamps `'rule_based'`. Both paths are tested in
`lib/scoring/__tests__/model.test.ts`.

## 9. Limitations

- **The data is synthetic.** The metrics measure how well the model recovers a
  generating process we wrote. They are evidence that the pipeline is sound, not
  a claim about real BGMI players.
- **The label formula shares vocabulary with the features** (skill gap, role
  matrix, comms, languages). The noise and the unobservable toxicity term keep
  it from being circular, but a real dataset would have signals no feature here
  captures.
- **Pairwise, not squad-level.** Squad quality is approximated as the mean of
  pair scores plus role and spread terms; interactions between three or four
  players are not modelled.
- **Static model.** It is retrained only when `scripts/train.ts` runs.

## 10. Future work

- Retrain on real post-match feedback as it accumulates, and compare against
  the synthetic-trained model on the same held-out real matches.
- Calibrate probabilities (Platt scaling) before blending with the rule score.
- Learn the blend weight (0.7/0.3) from held-out squad outcomes rather than
  fixing it.
- Try gradient-boosted trees once the dataset is large enough to justify losing
  coefficient-level explainability.
