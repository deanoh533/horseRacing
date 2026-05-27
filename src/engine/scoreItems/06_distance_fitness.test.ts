import { describe, it, expect } from 'vitest';
import { calculateDistanceFitnessScore } from './06_distance_fitness';

describe('⑥ 거리 적성 — distFinishRatio (primary)', () => {
  it('ratio 0.0 (항상 1등) → 1.0 만점', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [], distFinishRatio: 0.0 })).toBe(1.0);
  });

  it('ratio 0.5 (항상 중위) → 0.5', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [], distFinishRatio: 0.5 })).toBe(0.5);
  });

  it('ratio 1.0 (항상 꼴등) → 0.0', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [], distFinishRatio: 1.0 })).toBe(0.0);
  });

  it('ratio 0.2 → 0.8', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [], distFinishRatio: 0.2 })).toBeCloseTo(0.8, 5);
  });

  it('ratio가 있으면 sameDistOrds 무시', () => {
    // sameDistOrds만 있으면 1.0이 나올 데이터 + ratio 0.3 → ratio 우선 0.7
    const score = calculateDistanceFitnessScore({ sameDistOrds: [1, 1, 1, 1, 1], distFinishRatio: 0.3 });
    expect(score).toBeCloseTo(0.7, 5);
  });
});

describe('⑥ 거리 적성 — fallback (sameDistOrds)', () => {
  it('ratio null → fallback: 이력 없음 → 0.5 중립', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [], distFinishRatio: null })).toBe(0.5);
  });

  it('ratio undefined → fallback: 이력 없음 → 0.5 중립', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [] })).toBe(0.5);
  });

  it('fallback: 모두 1등 (5번 1등) → 1.0 만점', () => {
    expect(
      calculateDistanceFitnessScore({ sameDistOrds: [1, 1, 1, 1, 1] })
    ).toBe(1.0);
  });

  it('fallback 핵심 검증: 2번 1등 > 5번 3등', () => {
    const twoWins = calculateDistanceFitnessScore({ sameDistOrds: [1, 1, 4, 4, 4] });
    const fiveThirds = calculateDistanceFitnessScore({ sameDistOrds: [3, 3, 3, 3, 3] });
    expect(twoWins).toBeGreaterThan(fiveThirds);
    expect(twoWins).toBeCloseTo(0.4, 2);
    expect(fiveThirds).toBeCloseTo(0.333, 2);
  });

  it('fallback: 4등 이하는 0점', () => {
    expect(
      calculateDistanceFitnessScore({ sameDistOrds: [4, 5, 6, 7, 8] })
    ).toBe(0);
  });

  it('fallback: 1-1-1-2-2 → 13/15 = 0.867', () => {
    const score = calculateDistanceFitnessScore({ sameDistOrds: [1, 1, 1, 2, 2] });
    expect(score).toBeCloseTo(0.867, 2);
  });
});
