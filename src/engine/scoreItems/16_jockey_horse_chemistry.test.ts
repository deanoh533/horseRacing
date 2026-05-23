import { describe, it, expect } from 'vitest';
import { calculateChemistryScore } from './16_jockey_horse_chemistry';

describe('⑯ 기수-말 궁합 (향상도 + 신뢰도)', () => {
  it('처음 조합 (이력 0) → 0.5 중립', () => {
    expect(
      calculateChemistryScore({
        horseAllOrds: [1, 2, 3, 4, 5],
        combinationOrds: [],
      })
    ).toBe(0.5);
  });

  it('말 데이터 < 3 → 0.5', () => {
    expect(
      calculateChemistryScore({
        horseAllOrds: [1, 2],
        combinationOrds: [1, 1],
      })
    ).toBe(0.5);
  });

  it('환상의 콤비: 5회 평균 1.5위 (말 평균 3.5위) → 1.0 또는 가까움', () => {
    const score = calculateChemistryScore({
      horseAllOrds: [3, 4, 3, 4, 3, 4, 3, 4, 3, 4], // 평균 3.5
      combinationOrds: [1, 2, 1, 2, 2], // 5회, 평균 1.6
    });
    // 향상도 약 +1.9 → mapImprovement → 0.8 또는 1.0
    expect(score).toBeGreaterThan(0.7);
  });

  it('조합이 평소보다 나쁨: 5회 평균 5위 (말 평균 2위) → 낮은 점수', () => {
    const score = calculateChemistryScore({
      horseAllOrds: [1, 2, 2, 3, 2, 1, 2, 3, 2, 1],
      combinationOrds: [5, 5, 5, 5, 5],
    });
    // 향상도 약 -3 → mapImprovement → 0.2
    expect(score).toBeLessThan(0.5);
  });

  it('1회 조합은 신뢰도 0.5만 적용', () => {
    const score = calculateChemistryScore({
      horseAllOrds: [3, 4, 3, 4, 3, 4, 3, 4],
      combinationOrds: [1], // 1회, 매우 좋음
    });
    // 향상도 약 +2.5 → 1.0, but 신뢰도 0.5
    // 결과: 0.5 + (1.0 - 0.5) * 0.5 = 0.75
    expect(score).toBeCloseTo(0.75, 2);
  });
});
