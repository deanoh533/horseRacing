import { describe, it, expect } from 'vitest';
import { calculateSeasonalPatternScore } from './15_seasonal_pattern';

describe('⑮ 계절 패턴', () => {
  it('빈 input → 0.5 (중립)', () => {
    expect(calculateSeasonalPatternScore({ sameSeasonOrds: [] })).toBe(0.5);
  });

  it('같은 계절 5경주 모두 3위 이내 → 1.0', () => {
    expect(
      calculateSeasonalPatternScore({ sameSeasonOrds: [1, 2, 3, 1, 3] })
    ).toBe(1.0);
  });

  it('같은 계절 5경주 모두 4위+ → 0', () => {
    expect(
      calculateSeasonalPatternScore({ sameSeasonOrds: [5, 6, 7, 8, 9] })
    ).toBe(0);
  });

  it('5경주 중 2번 3위 이내 → 0.4', () => {
    expect(
      calculateSeasonalPatternScore({ sameSeasonOrds: [1, 3, 5, 7, 9] })
    ).toBeCloseTo(0.4, 2);
  });

  it('1경주 1위 → 1.0', () => {
    expect(calculateSeasonalPatternScore({ sameSeasonOrds: [1] })).toBe(1.0);
  });
});
