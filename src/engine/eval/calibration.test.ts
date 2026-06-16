import { describe, it, expect } from 'vitest';
import { reliabilityBins, ece, brier, logLoss, normalizeProbs, sigmoid } from './calibration.js';
import { formatCalibration, type CalibrationReport } from './calibration.js';

describe('sigmoid', () => {
  it('0 → 0.5, 큰 양수 → ~1, 큰 음수 → ~0', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 9);
    expect(sigmoid(20)).toBeGreaterThan(0.99);
    expect(sigmoid(-20)).toBeLessThan(0.01);
  });
});

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

describe('formatCalibration — 스모크', () => {
  it('모델·시장·P3·분기 섹션 포함', () => {
    const mk = (n: number, p: number, y: number): { p: number; y: number }[] =>
      Array.from({ length: n }, () => ({ p, y }));
    const report: CalibrationReport = {
      modelWin: [...mk(50, 0.1, 0), ...mk(50, 0.3, 1)],
      marketWin: [...mk(50, 0.12, 0), ...mk(50, 0.28, 1)],
      modelTop3: [...mk(50, 0.2, 0), ...mk(50, 0.5, 1)],
      perQuarter: [{ key: '2025-Q1', modelEce: 0.05, marketEce: 0.04 }],
    };
    const out = formatCalibration(report);
    expect(out).toContain('P(1착)');
    expect(out).toContain('시장');
    expect(out).toContain('P(3착내)');
    expect(out).toContain('ECE');
    expect(out).toContain('2025-Q1');
  });
});
