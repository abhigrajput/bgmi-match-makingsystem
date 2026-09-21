import { describe, expect, it } from 'vitest';

import { pairScore } from '../compatibility';
import { FEATURE_NAMES } from '../features';
import { metrics, rocAuc, trainLogistic, predictProba, tuneThreshold } from '../logistic';
import {
  ML_WEIGHT,
  RULE_WEIGHT,
  activeScorer,
  isValidModel,
  loadModel,
  makeMlScorer,
  predictPair,
  type SavedModel,
} from '../model';
import { formSquads } from '../squad';

import { fixturePool, makePlayer } from './fixtures';

const d = FEATURE_NAMES.length;
const toyModel: SavedModel = {
  version: 'test',
  algorithm: 'logistic_regression',
  trained_at: '2026-01-01T00:00:00Z',
  features: [...FEATURE_NAMES],
  weights: [1.2, 0.4, 0.1, 0.3, 0.5, 0, 0, -0.4],
  bias: 0.2,
  mean: new Array(d).fill(0.5),
  std: new Array(d).fill(0.25),
  threshold: 0.5,
};

describe('logistic regression', () => {
  it('computes AUC 1 for a perfect ranking and 0.5 for ties', () => {
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])).toBe(1);
    expect(rocAuc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5])).toBe(0.5);
    expect(rocAuc([1, 1, 0, 0], [0.1, 0.2, 0.8, 0.9])).toBe(0);
  });

  it('computes confusion-based metrics correctly', () => {
    const m = metrics([1, 1, 0, 0], [0.9, 0.3, 0.6, 0.1], 0.5);
    expect(m.confusion).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(m.accuracy).toBe(0.5);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.5);
  });

  it('learns a linearly separable rule', () => {
    const X = Array.from({ length: 200 }, (_, i) => [i / 200, (i % 7) / 7]);
    const y = X.map(([a]) => (a! > 0.5 ? 1 : 0));
    const model = trainLogistic(X, y, { learningRate: 0.5, l2: 0, epochs: 2000 });
    const scores = X.map((x) => predictProba(model, x));
    expect(metrics(y, scores).accuracy).toBeGreaterThan(0.95);
  });

  it('tunes a threshold that separates a clean split', () => {
    expect(tuneThreshold([0, 0, 1, 1], [0.1, 0.2, 0.7, 0.8])).toBeGreaterThan(0.2);
  });
});

describe('model scorer', () => {
  it('produces probabilities within [0, 1] across a varied pool', () => {
    const pool = fixturePool(30);
    for (const a of pool) {
      for (const b of pool) {
        const p = predictPair(toyModel, a, b);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('blends 0.7 model + 0.3 rule-based for compatible pairs', () => {
    const a = makePlayer({ profileId: 'a', primaryRole: 'igl' });
    const b = makePlayer({ profileId: 'b', primaryRole: 'support' });
    const result = makeMlScorer(toyModel)(a, b);
    const expected = ML_WEIGHT * predictPair(toyModel, a, b) + RULE_WEIGHT * pairScore(a, b).score;
    expect(result.score).toBeCloseTo(expected, 12);
    expect(result.source).toBe('ml');
    expect(result.reasons[0]).toMatch(/Model: \d+% chance/);
  });

  it('still enforces vetoes: a vetoed pair scores 0 whatever the model says', () => {
    // A model that loves everything: huge bias.
    const eager: SavedModel = { ...toyModel, bias: 50 };
    const result = makeMlScorer(eager)(
      makePlayer({ profileId: 'a', comm: 'silent' }),
      makePlayer({ profileId: 'b', comm: 'voice_required' }),
    );
    expect(result.score).toBe(0);
    expect(result.veto).toBe('comm');
  });

  it('never lets the optimizer seat a vetoed pair with the ML scorer', () => {
    const eager: SavedModel = { ...toyModel, bias: 50 };
    const result = formSquads(fixturePool(40), 4, makeMlScorer(eager));
    for (const squad of result.squads) {
      expect(squad.source).toBe('ml');
      for (let i = 0; i < squad.members.length; i++) {
        for (let j = i + 1; j < squad.members.length; j++) {
          expect(pairScore(squad.members[i]!, squad.members[j]!).veto).toBeNull();
        }
      }
    }
  });

  it('rejects malformed models, which makes the app fall back to rules', () => {
    expect(isValidModel(null)).toBe(false);
    expect(isValidModel({ version: 'untrained' })).toBe(false);
    expect(isValidModel({ ...toyModel, weights: [1, 2] })).toBe(false);
    expect(isValidModel({ ...toyModel, features: [...FEATURE_NAMES].reverse() })).toBe(false);
    expect(isValidModel({ ...toyModel, std: new Array(d).fill(0) })).toBe(false);
    expect(isValidModel({ ...toyModel, bias: Number.NaN })).toBe(false);
    expect(isValidModel(toyModel)).toBe(true);
  });

  it('reports the active scorer consistently with the committed model.json', () => {
    const active = activeScorer();
    if (loadModel()) {
      expect(active.source).toBe('ml');
      expect(active.version).toBeTruthy();
    } else {
      expect(active.source).toBe('rule_based');
      expect(active.scorer).toBe(pairScore);
    }
  });
});
