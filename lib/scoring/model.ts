/**
 * The trained match-success model at serving time.
 *
 * lib/scoring/model.json is written by scripts/train.ts and committed, so the
 * deployed app scores with exactly the model whose metrics are in
 * docs/ml-results.md and the model_versions table. It is read at build time
 * as a JSON import: no network call, no service to be down.
 *
 * The scorer blends 0.7 x model probability with 0.3 x the rule-based pair
 * score. The rule share keeps squads explainable in the same terms as before,
 * and damps the model where it is least certain. Hard vetoes are applied
 * BEFORE the model is consulted and always win: a model trained on feedback
 * could learn that some vetoed pairs rate fine, and the product promise is
 * that a declared hard preference is never traded away.
 *
 * If model.json is missing or malformed, activeScorer() returns the pure
 * rule-based scorer and squads are stamped scoring_source = 'rule_based'.
 */

import rawModel from './model.json';
import { isHardIncompatible, pairScore, vetoReason } from './compatibility';
import { FEATURE_NAMES, pairFeatures } from './features';
import { sigmoid } from './logistic';
import type { PairResult, PairScorer, PlayerVector } from './types';

export const ML_WEIGHT = 0.7;
export const RULE_WEIGHT = 0.3;

export type SavedModel = {
  version: string;
  algorithm: string;
  trained_at: string;
  features: string[];
  weights: number[];
  bias: number;
  mean: number[];
  std: number[];
  threshold: number;
};

/** Structural check: the right features, in the right order, all finite. */
export function isValidModel(value: unknown): value is SavedModel {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SavedModel>;
  const d = FEATURE_NAMES.length;
  const finiteArray = (a: unknown) =>
    Array.isArray(a) && a.length === d && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  return (
    typeof m.version === 'string' &&
    Array.isArray(m.features) &&
    m.features.length === d &&
    m.features.every((f, i) => f === FEATURE_NAMES[i]) &&
    finiteArray(m.weights) &&
    finiteArray(m.mean) &&
    finiteArray(m.std) &&
    (m.std as number[]).every((s) => s > 0) &&
    typeof m.bias === 'number' &&
    Number.isFinite(m.bias)
  );
}

export function loadModel(): SavedModel | null {
  return isValidModel(rawModel) ? rawModel : null;
}

/** P(the pair rates each other 4+), from the saved model. */
export function predictPair(model: SavedModel, a: PlayerVector, b: PlayerVector): number {
  const x = pairFeatures(a, b);
  let z = model.bias;
  for (let j = 0; j < x.length; j++) {
    z += model.weights[j]! * ((x[j]! - model.mean[j]!) / model.std[j]!);
  }
  return sigmoid(z);
}

export function makeMlScorer(model: SavedModel): PairScorer {
  return (a, b): PairResult => {
    const rule = pairScore(a, b);
    const veto = isHardIncompatible(a, b);
    if (veto.vetoed && veto.rule) {
      return { ...rule, score: 0, reasons: [vetoReason(veto.rule, a, b)], veto: veto.rule, source: 'ml' };
    }
    const p = predictPair(model, a, b);
    return {
      score: ML_WEIGHT * p + RULE_WEIGHT * rule.score,
      reasons: [`Model: ${Math.round(p * 100)}% chance they rate each other 4+`, ...rule.reasons],
      components: rule.components,
      veto: null,
      source: 'ml',
    };
  };
}

/** The scorer the app should use right now, and which kind it is. */
export function activeScorer(): { scorer: PairScorer; source: 'ml' | 'rule_based'; version: string | null } {
  const model = loadModel();
  if (!model) return { scorer: pairScore, source: 'rule_based', version: null };
  return { scorer: makeMlScorer(model), source: 'ml', version: model.version };
}
