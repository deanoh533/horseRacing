import { describe, it, expect } from 'vitest';
import { placeRate, verdict } from './learningExp.js';

const horse = (name: string, x: number, ord: number) => ({ hrName: name, pthrNo: 0, ord, winOdds: null, rawScores: {}, features: [{ name: 'x', value: x }] });

describe('placeRate', () => {
  it('1순위(점수 최고) 말이 3착 안인 경주 비율', () => {
    const m = { kind: 'logistic' as const, model: { type: 'logistic' as const, features: ['x'], means: [0], stds: [1], coef: { x: 1 }, intercept: 0 } };
    const races = [
      { raceDate: 1, meet: 1, rcNo: 1, horses: [horse('A', 2, 1), horse('B', 1, 5)] },
      { raceDate: 1, meet: 1, rcNo: 2, horses: [horse('C', 2, 7), horse('D', 1, 1)] },
    ];
    expect(placeRate(m, races)).toBe(0.5);
  });
});

describe('verdict', () => {
  const base = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  it('평균 미달이면 양수 분기가 많아도 불합격', () => {
    // Δ = +2,+1,+1,−1,0,+1 %p → 평균 +0.67%p, 양수 4/6
    expect(verdict(base, [0.52, 0.51, 0.51, 0.49, 0.50, 0.51]).pass).toBe(false);
  });
  it('평균 +1.0%p 이상 AND 과반 양수면 합격', () => {
    // Δ = +3,+2,+2,−1,+2,+1 %p → 평균 +1.5%p, 양수 5/6
    const v = verdict(base, [0.53, 0.52, 0.52, 0.49, 0.52, 0.51]);
    expect(v.meanDelta).toBeCloseTo(0.015, 6);
    expect(v.pass).toBe(true);
  });
  it('경계: 평균 정확히 +1.0%p면 합격', () => {
    expect(verdict(base, [0.51, 0.51, 0.51, 0.51, 0.51, 0.51]).pass).toBe(true);
  });
  it('양수 분기 수를 센다', () => {
    const v = verdict([0.5, 0.5, 0.5, 0.5], [0.53, 0.53, 0.49, 0.49]);
    expect(v.positive).toBe(2);
    expect(v.pass).toBe(false); // 2/4는 과반 아님
  });
});
