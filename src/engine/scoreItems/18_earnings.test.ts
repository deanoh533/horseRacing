import { describe, it, expect } from 'vitest';
import { calculateEarningsScore } from './18_earnings';

describe('⑱ 수득상금', () => {
  it('데이터 없음 → 0.5 (중립)', () => {
    expect(calculateEarningsScore({})).toBe(0.5);
    expect(calculateEarningsScore({ erngSump: undefined })).toBe(0.5);
  });

  it('0원 (미입상) → 0', () => {
    expect(calculateEarningsScore({ erngSump: 0 })).toBe(0);
  });

  it('100만 미만 → 0.1', () => {
    expect(calculateEarningsScore({ erngSump: 500_000 })).toBe(0.1);
  });

  it('1000만 미만 → 0.25', () => {
    expect(calculateEarningsScore({ erngSump: 5_000_000 })).toBe(0.25);
  });

  it('1억 미만 (상수) → 0.6', () => {
    expect(calculateEarningsScore({ erngSump: 50_000_000 })).toBe(0.6);
  });

  it('5억 미만 (강자) → 0.85', () => {
    expect(calculateEarningsScore({ erngSump: 200_000_000 })).toBe(0.85);
  });

  it('5억+ (최상위) → 1.0', () => {
    expect(calculateEarningsScore({ erngSump: 1_000_000_000 })).toBe(1.0);
  });
});
