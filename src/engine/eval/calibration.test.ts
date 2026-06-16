import { describe, it, expect } from 'vitest';
import { reliabilityBins, ece, brier, logLoss, normalizeProbs } from './calibration.js';

describe('normalizeProbs', () => {
  it('합으로 나눠 합=1', () => {
    expect(normalizeProbs([1, 1, 2])).toEqual([0.25, 0.25, 0.5]);
  });
  it('합 0이면 전부 0 (방어)', () => {
    expect(normalizeProbs([0, 0])).toEqual([0, 0]);
  });
});

describe('reliabilityBins — 등개수 분위', () => {
  it('2 bin: 낮은 p 묶음 rate 0.1, 높은 p 묶음 rate 0.9', () => {
    const pairs = [
      ...Array.from({ length: 10 }, (_, i) => ({ p: 0.1, y: i === 0 ? 1 : 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ p: 0.9, y: i < 9 ? 1 : 0 })),
    ];
    const bins = reliabilityBins(pairs, 2);
    expect(bins).toHaveLength(2);
    expect(bins[0]!.avgPred).toBeCloseTo(0.1, 6);
    expect(bins[0]!.actualRate).toBeCloseTo(0.1, 6);
    expect(bins[0]!.n).toBe(10);
    expect(bins[1]!.avgPred).toBeCloseTo(0.9, 6);
    expect(bins[1]!.actualRate).toBeCloseTo(0.9, 6);
  });
  it('빈 입력 → 빈 배열', () => {
    expect(reliabilityBins([], 10)).toEqual([]);
  });
});

describe('ece', () => {
  it('가중 절대편차 합', () => {
    const bins = [
      { avgPred: 0.2, actualRate: 0.1, n: 10 },
      { avgPred: 0.6, actualRate: 0.7, n: 10 },
    ];
    expect(ece(bins)).toBeCloseTo(0.1, 6);
  });
});

describe('brier', () => {
  it('평균제곱오차', () => {
    expect(brier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBeCloseTo(0.25, 6);
  });
});

describe('logLoss', () => {
  it('p=0,y=1도 클립으로 유한값', () => {
    const v = logLoss([{ p: 0, y: 1 }]);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(15);
  });
  it('완벽예측이면 ~0', () => {
    expect(logLoss([{ p: 1, y: 1 }])).toBeCloseTo(0, 6);
  });
});
