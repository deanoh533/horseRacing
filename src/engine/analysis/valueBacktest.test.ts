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

import { roi, summarize, type Bet } from './valueBacktest.js';

describe('roi', () => {
  it('정액 베팅 ROI = Σ입상배당/nBets − 1 (입상=plcOdds!=null)', () => {
    // 1픽 배당 3.0 1회 적중, 3베팅 → (3+0+0)/3 - 1 = 0 (본전)
    const bets: Bet[] = [
      { band: '4-7', plcOdds: 3 }, { band: '4-7', plcOdds: null }, { band: '4-7', plcOdds: null },
    ];
    expect(roi(bets)).toBeCloseTo(0, 5);
  });
  it('양의 ROI', () => {
    const bets: Bet[] = [{ band: '4-7', plcOdds: 2 }, { band: '4-7', plcOdds: 2 }, { band: '4-7', plcOdds: null }];
    expect(roi(bets)).toBeCloseTo(4 / 3 - 1, 5); // 0.333
  });
  it('빈 베팅은 0', () => {
    expect(roi([])).toBe(0);
  });
});

describe('summarize', () => {
  it('배당구간별 베팅수·적중수·적중율·평균배당·ROI', () => {
    const bets: Bet[] = [
      { band: '4-7', plcOdds: 2.5 }, { band: '4-7', plcOdds: null },
      { band: '7-15', plcOdds: 5 }, { band: '7-15', plcOdds: null }, { band: '7-15', plcOdds: null },
    ];
    const out = summarize(bets);
    const b47 = out.find((b) => b.band === '4-7')!;
    expect(b47.nBets).toBe(2);
    expect(b47.nHits).toBe(1);
    expect(b47.hitRate).toBeCloseTo(0.5, 5);
    expect(b47.avgOdds).toBeCloseTo(2.5, 5);
    expect(b47.roi).toBeCloseTo(2.5 / 2 - 1, 5); // 0.25
    const b715 = out.find((b) => b.band === '7-15')!;
    expect(b715.roi).toBeCloseTo(5 / 3 - 1, 5); // 0.667
  });
  it('배당구간 순서대로 정렬, 빈 구간 제외', () => {
    const bets: Bet[] = [{ band: '7-15', plcOdds: 4 }, { band: '4-7', plcOdds: 2 }];
    expect(summarize(bets).map((b) => b.band)).toEqual(['4-7', '7-15']);
  });
});

import { placePaid } from './valueBacktest.js';

describe('placePaid (KRA 연승 입상 규칙)', () => {
  it('8두 이상은 3착 이내', () => {
    expect(placePaid(3, 8)).toBe(true);
    expect(placePaid(4, 8)).toBe(false);
    expect(placePaid(1, 12)).toBe(true);
  });
  it('5~7두는 2착 이내', () => {
    expect(placePaid(2, 7)).toBe(true);
    expect(placePaid(3, 7)).toBe(false);
    expect(placePaid(2, 5)).toBe(true);
  });
  it('4두 이하는 연승 미발매 → 항상 false', () => {
    expect(placePaid(1, 4)).toBe(false);
    expect(placePaid(1, 1)).toBe(false);
  });
});
