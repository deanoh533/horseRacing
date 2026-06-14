import { describe, it, expect } from 'vitest';
import { rankByOdds, marketDiagnostics } from './market.js';
import type { RaceRecord, HorseRecord } from './types.js';
import type { ScorableModel } from './score.js';

const H = (n: string, ord: number, odds: number | null, s: number): HorseRecord =>
  ({ hrName: n, pthrNo: 0, ord, winOdds: odds, rawScores: { s }, features: [] });

// 모델이 점수 s(rawScores.s)로 정렬되도록
const model: ScorableModel = { kind: 'weights', weights: { s: 1 } };

describe('rankByOdds', () => {
  it('win_odds 오름차순, 무효 배당 제외', () => {
    const hs = [H('a', 1, 5, 0), H('b', 2, 2, 0), H('c', 3, null, 0)];
    expect(rankByOdds(hs).map((h) => h.hrName)).toEqual(['b', 'a']);
  });
});

describe('marketDiagnostics', () => {
  it('순위별 연승: 1순위 픽이 3착내인 비율', () => {
    const r1: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 1,
      horses: [H('a', 1, 2, 9), H('b', 2, 3, 5), H('c', 3, 5, 1)] };
    const r2: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 2,
      horses: [H('a', 5, 2, 9), H('b', 1, 3, 5), H('c', 2, 5, 1)] };
    const d = marketDiagnostics([r1, r2], model);
    expect(d.rankModel[0].n).toBe(2);
    expect(d.rankModel[0].hit).toBe(1); // r1만 모델1순위(a,s=9)가 3착내
  });

  it('불일치: 모델 1순위 ≠ 인기1위인 경주만 집계', () => {
    // 모델 1순위=a(s=9), 인기1위=b(odds 2 최저) → 불일치
    const r: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 1,
      horses: [H('a', 1, 5, 9), H('b', 2, 2, 1)] };
    const d = marketDiagnostics([r], model);
    expect(d.disModel.n).toBe(1);
    expect(d.disModel.show).toBe(1); // 모델픽 a가 1착 → 3착내
    expect(d.disFav.show).toBe(1);   // 인기픽 b가 2착 → 3착내
  });
});
