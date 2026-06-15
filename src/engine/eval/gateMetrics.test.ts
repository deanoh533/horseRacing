import { describe, it, expect } from 'vitest';
import { placeHitRate, fadeHitRate, quinellaHitRate, type ScoredRace } from './gateMetrics.js';

// score 높을수록 모델 상위. winOdds 낮을수록 인기.
describe('placeHitRate', () => {
  it('모델 1순위(최고점)가 3착내면 성공', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: 3, score: 0.9 }, { ord: 5, winOdds: 2, score: 0.1 }],
      [{ ord: 7, winOdds: 4, score: 0.8 }, { ord: 2, winOdds: 2, score: 0.2 }],
    ];
    expect(placeHitRate(races)).toBeCloseTo(0.5);
  });
  it('빈 입력은 0', () => { expect(placeHitRate([])).toBe(0); });
});

describe('fadeHitRate', () => {
  it('인기1~3 중 모델 최저점 말이 3착 밖이면 성공', () => {
    const races: ScoredRace[] = [
      [
        { ord: 6, winOdds: 2, score: 0.1 },
        { ord: 1, winOdds: 3, score: 0.7 },
        { ord: 2, winOdds: 4, score: 0.6 },
        { ord: 8, winOdds: 20, score: 0.05 },
      ],
      [
        { ord: 3, winOdds: 2, score: 0.2 },
        { ord: 1, winOdds: 3, score: 0.9 },
        { ord: 5, winOdds: 4, score: 0.8 },
      ],
    ];
    expect(fadeHitRate(races)).toBeCloseTo(0.5);
  });
  it('winOdds 인기 후보 2두 미만 경주는 분모 제외', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: null, score: 0.9 }, { ord: 2, winOdds: null, score: 0.1 }],
      [{ ord: 6, winOdds: 2, score: 0.1 }, { ord: 1, winOdds: 3, score: 0.9 }],
    ];
    expect(fadeHitRate(races)).toBeCloseTo(1.0);
  });
});

describe('quinellaHitRate', () => {
  it('모델 top2가 실제 1·2위 둘 다 포함하면 성공', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 2, winOdds: 3, score: 0.8 }, { ord: 3, winOdds: 4, score: 0.1 }],
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 4, winOdds: 3, score: 0.8 }, { ord: 2, winOdds: 4, score: 0.1 }],
    ];
    expect(quinellaHitRate(races)).toBeCloseTo(0.5);
  });
  it('실제 1·2위 없는 경주는 제외', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 5, winOdds: 3, score: 0.1 }],
    ];
    expect(quinellaHitRate(races)).toBe(0);
  });
});
