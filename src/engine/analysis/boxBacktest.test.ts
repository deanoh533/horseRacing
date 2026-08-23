import { describe, it, expect } from 'vitest';
import { settleBox, settleBoxN, type BoxHorse } from './boxBacktest.js';

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

describe('settleBoxN — 박스 두수 일반화', () => {
  it('n=3은 settleBox와 동일 (기존 동작 보존)', () => {
    const div = new Map([['2-3', 10]]);
    const ords = { 1: 4, 2: 1, 3: 2, 4: 3, 5: 5 };
    expect(settleBoxN(horses(ords), div, 3)).toEqual(settleBox(horses(ords), div));
  });

  it('n=2: 상위 2두만 박스 → 비용 1조합', () => {
    // 1착=마번1, 2착=마번2 (상위 2두) → 적중, 비용 C(2,2)=1
    const div = new Map([['1-2', 6]]);
    expect(settleBoxN(horses({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }), div, 2))
      .toEqual({ hit: true, profit: 5 });
  });

  it('n=2: 2착이 3순위 픽 → 미적중, profit=-1', () => {
    // 1착=마번1(픽), 2착=마번3(박스 밖)
    expect(settleBoxN(horses({ 1: 1, 2: 3, 3: 2, 4: 4, 5: 5 }), new Map(), 2))
      .toEqual({ hit: false, profit: -1 });
  });

  it('n=4: 비용 C(4,2)=6조합', () => {
    // 1착=마번4, 2착=마번1 (둘 다 상위4)
    const div = new Map([['1-4', 20]]);
    expect(settleBoxN(horses({ 1: 2, 2: 3, 3: 5, 4: 1, 5: 4 }), div, 4))
      .toEqual({ hit: true, profit: 14 });
  });

  it('n이 출전 두수보다 크면 전 두수 박스 — 비용도 실제 조합 수', () => {
    // 5두 경주에 n=7 → 5두 박스, 비용 C(5,2)=10. 1·2착은 반드시 포함되므로 적중.
    const div = new Map([['1-2', 12]]);
    expect(settleBoxN(horses({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }), div, 7))
      .toEqual({ hit: true, profit: 2 });
  });

  it('n<2면 베팅 불가 → null', () => {
    expect(settleBoxN(horses({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }), new Map(), 1)).toBeNull();
  });

  it('5두 미만 → null (복승 미발매)', () => {
    const small: BoxHorse[] = [
      { pthrNo: 1, ord: 1, prob: 0.9 },
      { pthrNo: 2, ord: 2, prob: 0.8 },
      { pthrNo: 3, ord: 3, prob: 0.7 },
      { pthrNo: 4, ord: 4, prob: 0.2 },
    ];
    expect(settleBoxN(small, new Map(), 2)).toBeNull();
  });
});
