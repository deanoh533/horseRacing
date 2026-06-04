import { describe, it, expect } from 'vitest';
import { quantileCutoff, topTercileCutoffs, isBet } from './valueBacktest.js';

describe('quantileCutoff', () => {
  it('2/3 분위 = 상위 1/3 경계 (terciles 정의와 일치)', () => {
    // floor(2/3 * 6) = 4 → 오름차순 [10,20,30,40,50,60]의 index 4 = 50
    expect(quantileCutoff([10, 20, 30, 40, 50, 60], 2 / 3)).toBe(50);
  });
  it('정렬 순서 무관', () => {
    expect(quantileCutoff([60, 10, 40, 20, 50, 30], 2 / 3)).toBe(50);
  });
  it('빈 배열은 Infinity (아무도 컷 통과 못함)', () => {
    expect(quantileCutoff([], 2 / 3)).toBe(Infinity);
  });
});

describe('topTercileCutoffs', () => {
  it('배당구간별 상위 1/3 점수 컷오프', () => {
    const recs = [
      { odds: 5, score: 0.1 }, { odds: 5, score: 0.2 }, { odds: 5, score: 0.3 },
      { odds: 5, score: 0.4 }, { odds: 5, score: 0.5 }, { odds: 5, score: 0.6 },
    ];
    // 4-7 구간: floor(2/3*6)=4 → index4 = 0.5
    expect(topTercileCutoffs(recs)['4-7']).toBeCloseTo(0.5, 5);
  });
  it('na 배당(0 이하)은 무시', () => {
    const recs = [{ odds: 0, score: 0.9 }, { odds: 5, score: 0.5 }];
    const out = topTercileCutoffs(recs);
    expect(out['na']).toBeUndefined();
    expect(out['4-7']).toBeDefined();
  });
});

describe('isBet', () => {
  it('구간 컷오프 이상이면 베팅', () => {
    const cut = { '4-7': 0.5 };
    expect(isBet(5, 0.6, cut)).toBe(true);
    expect(isBet(5, 0.5, cut)).toBe(true);
    expect(isBet(5, 0.49, cut)).toBe(false);
  });
  it('컷오프 없는 구간은 베팅 안 함', () => {
    expect(isBet(1.5, 0.99, { '4-7': 0.5 })).toBe(false);
  });
});
