import { describe, it, expect } from 'vitest';
import { calculatePedigreeScore } from './14_pedigree';

describe('⑭ 혈통 (임시)', () => {
  it('빈 input → 0.5 (중립)', () => {
    expect(calculatePedigreeScore({})).toBe(0.5);
  });

  it('모든 지수 0 → 0.5 (필터링되어 빈 상태)', () => {
    expect(
      calculatePedigreeScore({
        dsaBriVl: 0,
        dsaClcVl: 0,
        dsaIerVl: 0,
        dsaPrfVl: 0,
        dsidxVl: 0,
      })
    ).toBe(0.5);
  });

  it('평균 5.0 → 0.5', () => {
    expect(
      calculatePedigreeScore({
        dsaBriVl: 5,
        dsaClcVl: 5,
        dsaIerVl: 5,
        dsaPrfVl: 5,
        dsidxVl: 5,
      })
    ).toBe(0.5);
  });

  it('평균 10.0 → 1.0 만점', () => {
    expect(
      calculatePedigreeScore({
        dsaBriVl: 10,
        dsaClcVl: 10,
      })
    ).toBe(1.0);
  });

  it('평균 12.0 (초과) → 1.0 clamp', () => {
    expect(
      calculatePedigreeScore({ dsaBriVl: 12, dsaClcVl: 12 })
    ).toBe(1.0);
  });

  it('일부만 채움 → 채워진 것만 평균', () => {
    // dsaBriVl 6, dsaClcVl 4 → avg 5 → 0.5
    expect(
      calculatePedigreeScore({ dsaBriVl: 6, dsaClcVl: 4 })
    ).toBe(0.5);
  });
});
