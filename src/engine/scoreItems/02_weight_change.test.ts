import { describe, it, expect } from 'vitest';
import { calculateWeightChangeScore } from './02_weight_change';

describe('② 마체중 변화', () => {
  it('빈 입력 → 0.5 (중립)', () => {
    expect(calculateWeightChangeScore({ weightDiffs: [] })).toBe(0.5);
  });

  it('1경주만 있고 ±2kg 정상 변동 → 1.0 (baseScore 만점)', () => {
    expect(calculateWeightChangeScore({ weightDiffs: [1] })).toBe(1.0);
    expect(calculateWeightChangeScore({ weightDiffs: [-2] })).toBe(1.0);
  });

  it('1경주만 있고 5kg 변동 → 0.8', () => {
    expect(calculateWeightChangeScore({ weightDiffs: [5] })).toBeCloseTo(0.8);
  });

  it('1경주만 있고 10kg+ 위험 → 0.1', () => {
    expect(calculateWeightChangeScore({ weightDiffs: [12] })).toBeCloseTo(0.1);
  });

  it('3경주 일관된 방향 (지속 증가) → 추세 보너스 +0.15', () => {
    // 모두 +1, baseScore 1.0, 추세 +0.15 → 1.0 clamp
    expect(calculateWeightChangeScore({ weightDiffs: [1, 1, 1] })).toBe(1.0);
  });

  it('3경주 들쭉날쭉 → 추세 페널티 -0.15', () => {
    // [+1, -3, +2]: latestAbs=1 → base=1.0, 일관성 X → -0.15 → 0.85
    expect(calculateWeightChangeScore({ weightDiffs: [1, -3, 2] })).toBeCloseTo(0.85);
  });

  it('암말 봄(4월) 감소 → 계절 보너스 +0.1', () => {
    // [-1]: base=1.0, length 1 → 추세 보너스 X, 암말 봄 → +0.1 → clamp 1.0
    expect(
      calculateWeightChangeScore({ weightDiffs: [-1], sex: '암', currentMonth: 4 })
    ).toBe(1.0);
  });
});
