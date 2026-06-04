import { describe, it, expect } from 'vitest';
import { itemContributions } from './logisticScorer.js';
import type { LogisticModel } from './models/logistic.js';

const model: LogisticModel = {
  type: 'logistic',
  features: ['rating_abs', 'burden_over_avg', 'rc_dist'],
  means: [80, 0, 1400],
  stds: [10, 2, 200],
  coef: { rating_abs: 0.5, burden_over_avg: -0.3, rc_dist: 0.1 },
  intercept: 0.2,
};

describe('itemContributions', () => {
  it('총점=intercept+Σ(coef·z), 항목별 기여 합산', () => {
    const features = [
      { name: 'rating_abs', value: 90 },
      { name: 'burden_over_avg', value: 2 },
      { name: 'rc_dist', value: 1600 },
    ];
    const { total, byItem } = itemContributions(model, features);
    expect(total).toBeCloseTo(0.2 + 0.5 - 0.3 + 0.1, 6);
    expect(byItem['01_rating']).toBeCloseTo(0.5, 6);
    expect(byItem['08_burden_weight']).toBeCloseTo(-0.3, 6);
    expect(byItem['context']).toBeCloseTo(0.1, 6);
  });
  it('입력에 없는 모델 피처는 raw=0 처리(toVector 패리티), 스키마 밖 피처는 무시', () => {
    // 엉뚱(스키마 밖)=무시. rating_abs=80=mean→z0→0.
    // burden_over_avg 누락→raw0→z=(0-0)/2=0→0. rc_dist 누락→raw0→z=(0-1400)/200=-7→0.1*-7=-0.7.
    const { total } = itemContributions(model, [{ name: '엉뚱', value: 9 }, { name: 'rating_abs', value: 80 }]);
    expect(total).toBeCloseTo(0.2 - 0.7, 6); // intercept 0.2 + rc_dist 기여 -0.7 = -0.5
  });
});
