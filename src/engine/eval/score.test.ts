import { describe, it, expect } from 'vitest';
import { scoreHorse, rankHorses } from './score.js';
import type { HorseRecord } from './types.js';

const h = (over: Partial<HorseRecord>): HorseRecord => ({
  hrName: 'x', pthrNo: 1, ord: 1, winOdds: null,
  rawScores: {}, features: [], ...over,
});

describe('scoreHorse', () => {
  it('weights 모델: rawScores·weights 내적', () => {
    const horse = h({ rawScores: { a: 2, b: 3 } });
    const s = scoreHorse({ kind: 'weights', weights: { a: 1, b: 10 } }, horse);
    expect(s).toBe(2 * 1 + 3 * 10);
  });

  it('logistic 모델: model.features 스키마로 predictLogit', () => {
    const model = {
      type: 'logistic' as const, features: ['f1'], means: [0], stds: [1],
      coef: { f1: 2 }, intercept: 0,
    };
    const horse = h({ features: [{ name: 'f1', value: 3 }] as any });
    const s = scoreHorse({ kind: 'logistic', model }, horse);
    expect(s).toBeCloseTo(6); // 0 + 2 * ((3-0)/1)
  });

  it('rankHorses: 점수 내림차순 정렬', () => {
    const a = h({ hrName: 'a', rawScores: { s: 1 } });
    const b = h({ hrName: 'b', rawScores: { s: 5 } });
    const ranked = rankHorses({ kind: 'weights', weights: { s: 1 } }, [a, b]);
    expect(ranked.map((x) => x.hrName)).toEqual(['b', 'a']);
  });
});
