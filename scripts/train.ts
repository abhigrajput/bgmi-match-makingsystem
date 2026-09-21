/**
 * scripts/train.ts -- train the match-success model.
 *
 *   npx tsx scripts/train.ts --target local
 *   npx tsx scripts/train.ts --target prod
 *
 * One example per DIRECTED rated pair in match_feedback: "did rater give ratee
 * a 4 or 5?". Features come from observable player data through the same
 * component scorers the app uses (lib/scoring/features.ts); labels come from
 * feedback, which the seeder generated from hidden latents (see seed.ts). The
 * model never sees how a label was produced.
 *
 * Leakage controls:
 *   - The split is by MATCH, not by row. The two directions of one pair share
 *     an identical feature vector; a row-level split would put one direction
 *     in train and the other in test and inflate every metric. Matches are
 *     stratified by their positive rate before being dealt into folds.
 *   - Standardisation statistics come from the training rows only.
 *   - Baseline thresholds are tuned on the training rows only.
 *
 * Outputs: lib/scoring/model.json, a model_versions row on the target (made
 * active, previous one deactivated), and docs/ml-results.md -- every number in
 * which is printed from this run.
 */

import fs from 'node:fs';
import path from 'node:path';

import { pairScore } from '@/lib/scoring/compatibility';
import { FEATURE_NAMES, pairFeatures } from '@/lib/scoring/features';
import {
  DEFAULT_TRAIN_OPTIONS,
  meanStd,
  metrics,
  predictProba,
  trainLogistic,
  tuneThreshold,
  type Metrics,
} from '@/lib/scoring/logistic';
import type { PlayerVector } from '@/lib/scoring/types';
import { toPlayerVector } from '@/lib/scoring/vectors';

import { describeTarget, parseTarget, serviceClient, type Target } from './lib/env';
import { makeRng } from './lib/rng';

const SPLIT_SEED = 'bgmi-split-v1';
const FOLDS = 5;
const POSITIVE_RATING = 4;
const RANK_ONLY_GAP = 10;

type Example = { matchId: string; x: number[]; y: number; rule: number; gap: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await query(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

async function loadExamples(target: Target): Promise<Example[]> {
  const db = serviceClient(target);

  const [feedback, profiles, stats, prefs, avail] = await Promise.all([
    fetchAll((a, b) =>
      db.from('match_feedback').select('match_id, rater_profile_id, ratee_profile_id, rating').order('id').range(a, b),
    ),
    fetchAll((a, b) => db.from('profiles').select('id, bgmi_ign, display_name, region').order('id').range(a, b)),
    fetchAll((a, b) =>
      db
        .from('player_stats')
        .select('profile_id, overall_rating, aim_score, game_sense, teamwork_score, clutch_score, consistency_score')
        .order('profile_id')
        .range(a, b),
    ),
    fetchAll((a, b) =>
      db
        .from('player_preferences')
        .select('profile_id, primary_role, secondary_role, comm_preference, languages, min_teammate_skill, max_teammate_skill')
        .order('profile_id')
        .range(a, b),
    ),
    fetchAll((a, b) =>
      db
        .from('player_availability')
        .select('profile_id, day_of_week, start_minute, end_minute, timezone_offset_minutes')
        .order('id')
        .range(a, b),
    ),
  ]);

  const statsBy = new Map(stats.map((s) => [s.profile_id, s]));
  const prefsBy = new Map(prefs.map((p) => [p.profile_id, p]));
  const availBy = new Map<string, typeof avail>();
  for (const w of avail) availBy.set(w.profile_id, [...(availBy.get(w.profile_id) ?? []), w]);

  const vectors = new Map<string, PlayerVector>();
  for (const profile of profiles) {
    vectors.set(
      profile.id,
      toPlayerVector({
        profile,
        stats: statsBy.get(profile.id) ?? null,
        preferences: prefsBy.get(profile.id) ?? null,
        availability: availBy.get(profile.id) ?? [],
      }),
    );
  }

  const examples: Example[] = [];
  for (const f of feedback) {
    const a = vectors.get(f.rater_profile_id);
    const b = vectors.get(f.ratee_profile_id);
    if (!a || !b) continue;
    examples.push({
      matchId: f.match_id,
      x: pairFeatures(a, b),
      y: f.rating >= POSITIVE_RATING ? 1 : 0,
      rule: pairScore(a, b).score,
      gap: Math.abs(a.overallRating - b.overallRating),
    });
  }
  return examples;
}

/**
 * Deals matches into FOLDS folds, stratified by each match's positive rate:
 * matches are shuffled with a fixed seed, stably sorted by positive rate, and
 * dealt round-robin -- so every fold gets the same mix of good and bad squads.
 */
function assignFolds(examples: Example[]): Map<string, number> {
  const byMatch = new Map<string, { pos: number; n: number }>();
  for (const e of examples) {
    const g = byMatch.get(e.matchId) ?? { pos: 0, n: 0 };
    g.pos += e.y;
    g.n += 1;
    byMatch.set(e.matchId, g);
  }
  const rng = makeRng(SPLIT_SEED);
  const ids = rng.sample([...byMatch.keys()].sort(), byMatch.size);
  ids.sort((x, y) => byMatch.get(x)!.pos / byMatch.get(x)!.n - byMatch.get(y)!.pos / byMatch.get(y)!.n);
  return new Map(ids.map((id, i) => [id, i % FOLDS]));
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const f3 = (v: number) => v.toFixed(3);

function row(name: string, m: Metrics): string {
  return `| ${name} | ${f3(m.accuracy)} | ${f3(m.precision)} | ${f3(m.recall)} | ${f3(m.f1)} | ${f3(m.auc)} |`;
}

async function main() {
  const target = parseTarget();
  console.log(`Training on ${describeTarget(target)}`);

  const examples = await loadExamples(target);
  if (examples.length < 100) throw new Error(`Only ${examples.length} labelled pairs; seed the target first.`);

  const folds = assignFolds(examples);
  const train = examples.filter((e) => folds.get(e.matchId) !== 0);
  const test = examples.filter((e) => folds.get(e.matchId) === 0);
  const yTest = test.map((e) => e.y);

  // --- model ----------------------------------------------------------------
  const model = trainLogistic(train.map((e) => e.x), train.map((e) => e.y), DEFAULT_TRAIN_OPTIONS);
  const pTest = test.map((e) => predictProba(model, e.x));
  const modelMetrics = metrics(yTest, pTest, 0.5);

  // --- baselines on the same test rows -------------------------------------
  const ruleThreshold = tuneThreshold(train.map((e) => e.y), train.map((e) => e.rule));
  const ruleMetrics = metrics(yTest, test.map((e) => e.rule), ruleThreshold);

  // Rank-only: "close ratings = good pair". Score is -gap so AUC ranks
  // smaller gaps higher; the threshold turns that into |gap| < 10.
  const rankMetrics = metrics(yTest, test.map((e) => -e.gap), -RANK_ONLY_GAP + 1e-9);

  const trainPositive = train.reduce((s, e) => s + e.y, 0) / train.length;
  const majority = trainPositive >= 0.5 ? 1 : 0;
  const majorityMetrics = metrics(yTest, test.map(() => majority), 0.5);

  // --- 5-fold cross-validation ---------------------------------------------
  const cvF1: number[] = [];
  const cvAuc: number[] = [];
  for (let k = 0; k < FOLDS; k++) {
    const tr = examples.filter((e) => folds.get(e.matchId) !== k);
    const te = examples.filter((e) => folds.get(e.matchId) === k);
    const m = trainLogistic(tr.map((e) => e.x), tr.map((e) => e.y), DEFAULT_TRAIN_OPTIONS);
    const scores = te.map((e) => predictProba(m, e.x));
    const r = metrics(te.map((e) => e.y), scores, 0.5);
    cvF1.push(r.f1);
    cvAuc.push(r.auc);
  }
  const f1Cv = meanStd(cvF1);
  const aucCv = meanStd(cvAuc);

  // --- importance -------------------------------------------------------------
  const importance = FEATURE_NAMES.map((name, j) => ({
    feature: name,
    coefficient: model.weights[j]!,
    importance: Math.abs(model.weights[j]!),
  })).sort((a, b) => b.importance - a.importance);

  // --- persist ----------------------------------------------------------------
  const trainedAt = new Date();
  const version = `lr-${trainedAt.toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const saved = {
    version,
    algorithm: 'logistic_regression',
    trained_at: trainedAt.toISOString(),
    target,
    features: [...FEATURE_NAMES],
    weights: model.weights,
    bias: model.bias,
    mean: model.standardizer.mean,
    std: model.standardizer.std,
    threshold: 0.5,
    training: { ...DEFAULT_TRAIN_OPTIONS, split: 'match-grouped, stratified, 80/20', seed: SPLIT_SEED },
    n_train: train.length,
    n_test: test.length,
    metrics: {
      accuracy: modelMetrics.accuracy,
      precision: modelMetrics.precision,
      recall: modelMetrics.recall,
      f1: modelMetrics.f1,
      auc: modelMetrics.auc,
    },
  };
  fs.writeFileSync(path.resolve('lib/scoring/model.json'), JSON.stringify(saved, null, 2) + '\n');

  const db = serviceClient(target);
  {
    const { error } = await db.from('model_versions').update({ is_active: false }).eq('is_active', true);
    if (error) throw new Error(`Deactivating previous model failed: ${error.message}`);
  }
  {
    const { error } = await db.from('model_versions').insert({
      version,
      algorithm: 'logistic_regression',
      trained_at: trainedAt.toISOString(),
      n_train: train.length,
      n_test: test.length,
      metrics: { ...modelMetrics, cv: { f1: f1Cv, auc: aucCv } },
      baselines: {
        rule_based: { ...ruleMetrics, threshold: ruleThreshold },
        rank_only: { ...rankMetrics, rule: `|rating gap| < ${RANK_ONLY_GAP}` },
        majority: { ...majorityMetrics, predicts: majority },
      },
      feature_importance: importance,
      is_active: true,
    });
    if (error) throw new Error(`Inserting model_versions row failed: ${error.message}`);
  }

  // --- report -----------------------------------------------------------------
  const positives = examples.reduce((s, e) => s + e.y, 0);
  const c = modelMetrics.confusion;
  const doc = `# ML results

Generated by \`scripts/train.ts --target ${target}\` on ${trainedAt.toISOString()}.
Every number on this page was printed by that run; nothing is typed by hand.
Model version: \`${version}\` (also stored in \`model_versions\` on ${target}).

## Data

| | |
|---|---|
| Labelled directed pairs | ${examples.length} |
| Positive rate (rating ≥ ${POSITIVE_RATING}) | ${pct(positives / examples.length)} |
| Matches | ${folds.size} |
| Train / test rows | ${train.length} / ${test.length} (split by match, stratified) |

## Test-set results

Threshold 0.5 for the model. The rule-based baseline's threshold
(${f3(ruleThreshold)}) was tuned for accuracy on the training rows only (an
F1-tuned threshold collapses to "always positive" at this class balance).

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
${row('Logistic regression', modelMetrics)}
${row('Rule-based pairScore', ruleMetrics)}
${row(`Rank-only (rating gap < ${RANK_ONLY_GAP})`, rankMetrics)}
${row(`Majority class (always ${majority})`, majorityMetrics)}

Confusion matrix (logistic regression, test set):

| | Predicted 1 | Predicted 0 |
|---|---|---|
| Actual 1 | ${c.tp} | ${c.fn} |
| Actual 0 | ${c.fp} | ${c.tn} |

## ${FOLDS}-fold cross-validation (match-grouped)

| Metric | Mean | Std |
|---|---|---|
| F1 | ${f3(f1Cv.mean)} | ${f3(f1Cv.std)} |
| ROC-AUC | ${f3(aucCv.mean)} | ${f3(aucCv.std)} |

## Feature importance

|standardised coefficient|, largest first. Sign shows direction.

| Feature | Coefficient | Importance |
|---|---|---|
${importance.map((i) => `| ${i.feature} | ${i.coefficient >= 0 ? '+' : ''}${f3(i.coefficient)} | ${f3(i.importance)} |`).join('\n')}

Training: batch gradient descent, learning rate ${DEFAULT_TRAIN_OPTIONS.learningRate},
L2 ${DEFAULT_TRAIN_OPTIONS.l2}, ${DEFAULT_TRAIN_OPTIONS.epochs} epochs, features standardised with
training-set statistics.
`;
  fs.writeFileSync(path.resolve('docs/ml-results.md'), doc);

  console.log(`\nTest set (${test.length} rows):`);
  console.log(`  logistic regression  acc ${f3(modelMetrics.accuracy)}  f1 ${f3(modelMetrics.f1)}  auc ${f3(modelMetrics.auc)}`);
  console.log(`  rule-based           acc ${f3(ruleMetrics.accuracy)}  f1 ${f3(ruleMetrics.f1)}  auc ${f3(ruleMetrics.auc)}`);
  console.log(`  rank-only            acc ${f3(rankMetrics.accuracy)}  f1 ${f3(rankMetrics.f1)}  auc ${f3(rankMetrics.auc)}`);
  console.log(`  majority             acc ${f3(majorityMetrics.accuracy)}  f1 ${f3(majorityMetrics.f1)}  auc ${f3(majorityMetrics.auc)}`);
  console.log(`  CV f1 ${f3(f1Cv.mean)} ± ${f3(f1Cv.std)}   CV auc ${f3(aucCv.mean)} ± ${f3(aucCv.std)}`);
  console.log(`Wrote lib/scoring/model.json, docs/ml-results.md, model_versions ${version} (active).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
