import { describe, it, expect } from 'vitest';
import { calculateDistanceFitnessScore } from './06_distance_fitness';

describe('⑥ 거리 적성 (차등 점수)', () => {
  it('이력 없음 → 0.5 중립', () => {
    expect(calculateDistanceFitnessScore({ sameDistOrds: [] })).toBe(0.5);
  });

  it('모두 1등 (5번 1등) → 1.0 만점', () => {
    expect(
      calculateDistanceFitnessScore({ sameDistOrds: [1, 1, 1, 1, 1] })
    ).toBe(1.0);
  });

  it('사용자 핵심 검증: 2번 1등 > 5번 3등', () => {
    // 2번 1등 + 3번 미입상 = (3+3+0+0+0)/15 = 0.40
    const twoWins = calculateDistanceFitnessScore({
      sameDistOrds: [1, 1, 4, 4, 4],
    });
    // 5번 모두 3등 = (1+1+1+1+1)/15 = 0.333
    const fiveThirds = calculateDistanceFitnessScore({
      sameDistOrds: [3, 3, 3, 3, 3],
    });
    expect(twoWins).toBeGreaterThan(fiveThirds);
    expect(twoWins).toBeCloseTo(0.4, 2);
    expect(fiveThirds).toBeCloseTo(0.333, 2);
  });

  it('4등 이하는 0점', () => {
    expect(
      calculateDistanceFitnessScore({ sameDistOrds: [4, 5, 6, 7, 8] })
    ).toBe(0);
  });

  it('1-1-1-2-2 (PRD 예시) → 13/15 = 0.867', () => {
    const score = calculateDistanceFitnessScore({
      sameDistOrds: [1, 1, 1, 2, 2],
    });
    expect(score).toBeCloseTo(0.867, 2);
  });
});
