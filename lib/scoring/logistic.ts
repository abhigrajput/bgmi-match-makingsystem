/**
 * Logistic regression and the metrics used to judge it. Pure functions: no
 * I/O and no randomness, so training is exactly reproducible and every part is
 * unit-testable.
 *
 * Why logistic regression and not something larger: eight features, a few
 * thousand labelled pairs, and a requirement that the model be explainable on
 * a slide. A linear model's standardised coefficients ARE its explanation, it
 * cannot memorise a dataset this size, and it trains in milliseconds in plain
 * TypeScript -- so there is no Python service to deploy and nothing to fall
 * back from at request time.
 */

export type Standardizer = { mean: number[]; std: number[] };

export type LogisticModel = {
  weights: number[];
  bias: number;
  standardizer: Standardizer;
};

export type TrainOptions = {
  learningRate: number;
  l2: number;
  epochs: number;
};

export const DEFAULT_TRAIN_OPTIONS: TrainOptions = {
  learningRate: 0.1,
  l2: 0.01,
  epochs: 2000,
};

export function sigmoid(z: number): number {
  // Split form avoids exp overflow for large |z|.
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Mean and standard deviation from the TRAINING rows only. Computing them on
 * the full dataset would leak the test set's distribution into training.
 * A constant column gets std 1 so it standardises to 0 instead of NaN.
 */
export function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0]?.length ?? 0;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, row) => s + row[j]!, 0) / X.length);
  const std = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((s, row) => s + (row[j]! - mean[j]!) ** 2, 0) / X.length;
    return v > 1e-12 ? Math.sqrt(v) : 1;
  });
  return { mean, std };
}

export function standardize(row: number[], s: Standardizer): number[] {
  return row.map((x, j) => (x - s.mean[j]!) / s.std[j]!);
}

/**
 * Full-batch gradient descent on L2-regularised log loss. The bias is not
 * regularised: shrinking it towards 0 would bias predictions towards 0.5 for
 * no reason.
 */
export function trainLogistic(
  Xraw: number[][],
  y: number[],
  options: TrainOptions = DEFAULT_TRAIN_OPTIONS,
): LogisticModel {
  const standardizer = fitStandardizer(Xraw);
  const X = Xraw.map((row) => standardize(row, standardizer));
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const row = X[i]!;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * row[j]!;
      const err = sigmoid(z) - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * row[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) {
      w[j] = w[j]! - options.learningRate * (gw[j]! / n + options.l2 * w[j]!);
    }
    b -= options.learningRate * (gb / n);
  }

  return { weights: w, bias: b, standardizer };
}

export function predictProba(model: LogisticModel, row: number[]): number {
  const x = standardize(row, model.standardizer);
  let z = model.bias;
  for (let j = 0; j < x.length; j++) z += model.weights[j]! * x[j]!;
  return sigmoid(z);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type Confusion = { tp: number; fp: number; tn: number; fn: number };

export type Metrics = {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  auc: number;
  confusion: Confusion;
};

export function confusion(yTrue: number[], yPred: number[]): Confusion {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  yTrue.forEach((t, i) => {
    const p = yPred[i];
    if (t === 1 && p === 1) c.tp++;
    else if (t === 0 && p === 1) c.fp++;
    else if (t === 0 && p === 0) c.tn++;
    else c.fn++;
  });
  return c;
}

/**
 * ROC-AUC as the Mann-Whitney U statistic: the probability that a random
 * positive outranks a random negative, ties counted as half. Exact, and
 * O(n log n) through a sort with average ranks for tied scores.
 */
export function rocAuc(yTrue: number[], scores: number[]): number {
  const idx = scores.map((s, i) => ({ s, y: yTrue[i]! })).sort((a, b) => a.s - b.s);
  const ranks = new Array<number>(idx.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.s === idx[i]!.s) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }
  const nPos = idx.filter((e) => e.y === 1).length;
  const nNeg = idx.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  const sumPos = idx.reduce((s, e, k) => s + (e.y === 1 ? ranks[k]! : 0), 0);
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function metrics(yTrue: number[], scores: number[], threshold = 0.5): Metrics {
  const yPred = scores.map((s) => (s >= threshold ? 1 : 0));
  const c = confusion(yTrue, yPred);
  const accuracy = (c.tp + c.tn) / yTrue.length;
  const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { accuracy, precision, recall, f1, auc: rocAuc(yTrue, scores), confusion: c };
}

/**
 * Threshold on `scores` maximising a criterion over `yTrue` -- always called
 * on training rows only.
 *
 * Accuracy is the default because F1 is degenerate here: with ~59% positives,
 * "predict everything positive" already scores F1 ≈ 0.74, so an F1-tuned
 * threshold collapses to the minimum and the baseline stops discriminating at
 * all -- it becomes the majority-class baseline under another name.
 */
export function tuneThreshold(
  yTrue: number[],
  scores: number[],
  criterion: 'accuracy' | 'f1' = 'accuracy',
): number {
  // At most 200 candidates, taken at score quantiles: every distinct score
  // would be thousands of passes over thousands of rows for a curve that is
  // flat at this resolution anyway.
  const distinct = [...new Set(scores)].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(distinct.length / 200));
  const candidates = distinct.filter((_, i) => i % step === 0);
  let best = { t: 0.5, f1: -1 };
  for (const t of candidates) {
    const c = confusion(yTrue, scores.map((s) => (s >= t ? 1 : 0)));
    const value =
      criterion === 'f1'
        ? c.tp === 0 ? 0 : (2 * c.tp) / (2 * c.tp + c.fp + c.fn)
        : (c.tp + c.tn) / yTrue.length;
    if (value > best.f1) best = { t, f1: value };
  }
  return best.t;
}

export function meanStd(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, std };
}
