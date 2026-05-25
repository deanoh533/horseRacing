import { describe, it, expect } from 'vitest';
import { calculateBurdenWeightScore } from './08_burden_weight';

describe('⑧ 부담 극복 지수', () => {
  it('빈 입력 → 0.5 (중립)', () => {
    expect(calculateBurdenWeightScore({})).toBe(0.5);
    expect(calculateBurdenWeightScore({ history: [] })).toBe(0.5);
  });

  it('평균 부담중량으로 1위 → 보정 착순 = 1 → 1.0', () => {
    // ord 1, myBudam = raceAvg → 보정 = 1 → 1 - 0/9 = 1.0
    expect(
      calculateBurdenWeightScore({
        history: [{ ord: 1, myBudam: 55, raceAvgBudam: 55 }],
      })
    ).toBeCloseTo(1.0, 2);
  });

  it('+3kg 짊어지고 3위 → 보정 1.5위 → 거의 만점', () => {
    // 3 - 3 × 0.5 = 1.5 → 1 - 0.5/9 ≈ 0.944
    expect(
      calculateBurdenWeightScore({
        history: [{ ord: 3, myBudam: 58, raceAvgBudam: 55 }],
      })
    ).toBeCloseTo(0.944, 2);
  });

  it('-3kg 짊어지고 3위 → 보정 4.5위 → 0.611', () => {
    // 3 - (-3) × 0.5 = 4.5 → 1 - 3.5/9 ≈ 0.611
    expect(
      calculateBurdenWeightScore({
        history: [{ ord: 3, myBudam: 52, raceAvgBudam: 55 }],
      })
    ).toBeCloseTo(0.611, 2);
  });

  it('무거운 부담으로도 1위 (보정 음수) → 1.0 clamp', () => {
    // ord 1, +5kg → 1 - 2.5 = -1.5 → clamp 1.0
    expect(
      calculateBurdenWeightScore({
        history: [{ ord: 1, myBudam: 60, raceAvgBudam: 55 }],
      })
    ).toBe(1.0);
  });

  it('가벼운 부담으로 10위 → 보정 12.5위 → 0.0 clamp', () => {
    // ord 10, -5kg → 10 + 2.5 = 12.5 → 1 - 11.5/9 = -0.28 → clamp 0
    expect(
      calculateBurdenWeightScore({
        history: [{ ord: 10, myBudam: 50, raceAvgBudam: 55 }],
      })
    ).toBe(0);
  });

  it('여러 경주 평균', () => {
    // 평균 보정 = (1 + 1.5) / 2 = 1.25 → 1 - 0.25/9 ≈ 0.972
    expect(
      calculateBurdenWeightScore({
        history: [
          { ord: 1, myBudam: 55, raceAvgBudam: 55 },
          { ord: 3, myBudam: 58, raceAvgBudam: 55 },
        ],
      })
    ).toBeCloseTo(0.972, 2);
  });
});
