import { describe, it, expect } from 'vitest';
import { settleBox, type BoxHorse } from './boxBacktest.js';

// 5두: prob 상위3 = 마번 1,2,3
const horses = (ords: Record<number, number>): BoxHorse[] => [
  { pthrNo: 1, ord: ords[1]!, prob: 0.9 },
  { pthrNo: 2, ord: ords[2]!, prob: 0.8 },
  { pthrNo: 3, ord: ords[3]!, prob: 0.7 },
  { pthrNo: 4, ord: ords[4]!, prob: 0.2 },
  { pthrNo: 5, ord: ords[5]!, prob: 0.1 },
];

describe('settleBox', () => {
  it('1·2착이 둘 다 top3 픽 안 → 적중, profit=배당-3', () => {
    // 1착=마번2, 2착=마번3 (둘 다 top3)
    const div = new Map([['2-3', 10]]);
    const r = settleBox(horses({ 1: 4, 2: 1, 3: 2, 4: 3, 5: 5 }), div);
    expect(r).toEqual({ hit: true, profit: 7 });
  });

  it('2착이 top3 밖 → 미적중, profit=-3', () => {
    // 1착=마번2(top3), 2착=마번5(top3 밖)
    const r = settleBox(horses({ 1: 3, 2: 1, 3: 4, 4: 5, 5: 2 }), new Map());
    expect(r).toEqual({ hit: false, profit: -3 });
  });

  it('적중이지만 배당 결측 → profit=null (ROI 제외)', () => {
    const r = settleBox(horses({ 1: 4, 2: 1, 3: 2, 4: 3, 5: 5 }), new Map());
    expect(r).toEqual({ hit: true, profit: null });
  });

  it('5두 미만 → null (복승 미발매)', () => {
    const small: BoxHorse[] = [
      { pthrNo: 1, ord: 1, prob: 0.9 },
      { pthrNo: 2, ord: 2, prob: 0.8 },
      { pthrNo: 3, ord: 3, prob: 0.7 },
      { pthrNo: 4, ord: 4, prob: 0.2 },
    ];
    expect(settleBox(small, new Map())).toBeNull();
  });

  it('배당키는 마번 순서 무관(pairKey 정규화)', () => {
    // 1착=마번3, 2착=마번2 → 키 "2-3"
    const div = new Map([['2-3', 8]]);
    const r = settleBox(horses({ 1: 4, 2: 2, 3: 1, 4: 3, 5: 5 }), div);
    expect(r).toEqual({ hit: true, profit: 5 });
  });
});
