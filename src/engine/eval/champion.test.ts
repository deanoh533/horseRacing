import { describe, it, expect } from 'vitest';
import { toScorableModel } from './champion.js';

describe('toScorableModel', () => {
  it('logistic + 유효 artifact → kind=logistic', () => {
    const row = {
      id: 6, label: 'v6', model_type: 'logistic',
      weights: { a: 1 },
      artifact: { type: 'logistic' as const, features: ['f1'], means: [0], stds: [1], coef: { f1: 2 }, intercept: 0 },
    };
    const m = toScorableModel(row);
    expect(m.kind).toBe('logistic');
  });

  it('logistic이지만 artifact 비면 weights 폴백', () => {
    const row = { id: 5, label: 'v5', model_type: 'logistic', weights: { a: 1 }, artifact: null };
    const m = toScorableModel(row);
    expect(m).toEqual({ kind: 'weights', weights: { a: 1 } });
  });

  it('rho-legacy → weights', () => {
    const row = { id: 1, label: 'v1', model_type: 'rho-legacy', weights: { a: 1 }, artifact: null };
    expect(toScorableModel(row)).toEqual({ kind: 'weights', weights: { a: 1 } });
  });
});
