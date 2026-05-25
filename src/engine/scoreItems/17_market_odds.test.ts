import { describe, it, expect } from 'vitest';
import { calculateMarketOddsScore } from './17_market_odds';

describe('⑰ 배당률 (인기도)', () => {
  it('빈 input → 0 (시장 인정 없음)', () => {
    expect(calculateMarketOddsScore({ recent5Popularities: [] })).toBe(0);
  });

  it('최근 5경주 모두 1인기 → 1.0', () => {
    expect(
      calculateMarketOddsScore({ recent5Popularities: [1, 1, 1, 1, 1] })
    ).toBe(1.0);
  });

  it('최근 5경주 모두 2인기 → 1.0 (1-2인기 포함)', () => {
    expect(
      calculateMarketOddsScore({ recent5Popularities: [2, 2, 2, 2, 2] })
    ).toBe(1.0);
  });

  it('최근 5경주 모두 3인기+ → 0', () => {
    expect(
      calculateMarketOddsScore({ recent5Popularities: [3, 4, 5, 6, 7] })
    ).toBe(0);
  });

  it('5경주 중 2번 1-2인기 → 0.4', () => {
    expect(
      calculateMarketOddsScore({ recent5Popularities: [1, 5, 2, 8, 9] })
    ).toBe(0.4);
  });

  it('6경주 입력 → 마지막 5개만 사용', () => {
    // 6개 중 마지막 5개: [2,3,4,5,6] → 1-2인기 1번 → 0.2
    expect(
      calculateMarketOddsScore({ recent5Popularities: [1, 2, 3, 4, 5, 6] })
    ).toBe(0.2);
  });
});
