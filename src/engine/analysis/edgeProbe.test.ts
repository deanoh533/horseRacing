import { describe, it, expect } from 'vitest';
import { oddsBand, terciles, conditionalEdge } from './edgeProbe.js';

describe('oddsBand', () => {
  it('배당을 구간 라벨로', () => {
    expect(oddsBand(1.8)).toBe('<2');
    expect(oddsBand(3)).toBe('2-4');
    expect(oddsBand(6.9)).toBe('4-7');
    expect(oddsBand(15)).toBe('15-30');
    expect(oddsBand(31)).toBe('30+');
    expect(oddsBand(0)).toBe('na');
  });
});

describe('terciles', () => {
  it('값 순위로 0(하)/1/2(상) 3분할', () => {
    expect(terciles([10, 20, 30, 40, 50, 60])).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('역순도 동일 분할', () => {
    expect(terciles([60, 50, 40, 30, 20, 10])).toEqual([2, 2, 1, 1, 0, 0]);
  });
});

describe('conditionalEdge', () => {
  it('배당 구간 안에서 모델 고점수 터셀의 top3율이 높으면 양의 스프레드', () => {
    const recs = [
      { odds: 3, score: 0.1, top3: 0 }, { odds: 3, score: 0.2, top3: 0 },
      { odds: 3, score: 0.5, top3: 0 }, { odds: 3, score: 0.6, top3: 1 },
      { odds: 3, score: 0.9, top3: 1 }, { odds: 3, score: 0.95, top3: 1 },
    ];
    const out = conditionalEdge(recs, 2);
    const band = out.find((b) => b.band === '2-4')!;
    expect(band.n).toBe(6);
    expect(band.hi.rate).toBeGreaterThan(band.lo.rate);
    expect(band.spread).toBeCloseTo(band.hi.rate - band.lo.rate, 5);
    expect(band.spread).toBeGreaterThan(0);
  });
  it('표본 부족 구간(minN 미만)은 제외', () => {
    const recs = [{ odds: 3, score: 0.5, top3: 1 }];
    expect(conditionalEdge(recs, 6)).toEqual([]);
  });
});
