import { describe, it, expect } from 'vitest';
import { toScorableModel, trainBound } from './champion.js';

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

describe('trainBound', () => {
  it('train_until이 있으면 그대로', () => {
    expect(trainBound({ train_until: 20260920, created_at: '2026-09-29T13:35:36.828Z' }))
      .toEqual({ date: 20260920, source: 'train_until' });
  });
  it('train_until이 없으면 생성일(KST)로 보수적 상한', () => {
    expect(trainBound({ train_until: null, created_at: '2026-07-10T00:30:43.733Z' }))
      .toEqual({ date: 20260710, source: 'created_at' });
    expect(trainBound({ train_until: null, created_at: '2026-07-09T20:00:00Z' })!.date).toBe(20260710);
  });
  it('둘 다 없거나 날짜를 못 읽으면 null', () => {
    expect(trainBound({ train_until: null, created_at: null })).toBeNull();
    expect(trainBound({ train_until: null, created_at: 'garbage' })).toBeNull();
  });
});
