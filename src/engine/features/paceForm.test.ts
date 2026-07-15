import { describe, it, expect } from 'vitest';
import {
  labelPastRacePace, computePaceFormStats, paceFormFeatures,
  PACE_HOT_DELTA, PACE_SLOW_DELTA, PACE_FIT_SHRINK_K,
} from './paceForm.js';

describe('labelPastRacePace', () => {
  it('par보다 임계 이상 빠르면 HOT, 느리면 SLOW, 사이는 NORMAL', () => {
    expect(labelPastRacePace(13.0 + PACE_HOT_DELTA, 13.0)).toBe('HOT');
    expect(labelPastRacePace(13.0 + PACE_SLOW_DELTA, 13.0)).toBe('SLOW');
    expect(labelPastRacePace(13.0, 13.0)).toBe('NORMAL');
  });
  it('결측·비양수는 null', () => {
    expect(labelPastRacePace(null, 13.0)).toBeNull();
    expect(labelPastRacePace(13.0, null)).toBeNull();
    expect(labelPastRacePace(0, 13.0)).toBeNull();
  });
});

describe('computePaceFormStats', () => {
  it('라벨별 finish_ratio 평균과 표본수', () => {
    const s = computePaceFormStats([
      { finishRatio: 0.2, paceLabel: 'HOT' },
      { finishRatio: 0.4, paceLabel: 'HOT' },
      { finishRatio: 0.8, paceLabel: 'SLOW' },
      { finishRatio: 0.5, paceLabel: null }, // 라벨 불가 → 제외
    ]);
    expect(s.HOT).toEqual({ mean: expect.closeTo(0.3, 10), n: 2 });
    expect(s.SLOW).toEqual({ mean: 0.8, n: 1 });
    expect(s.NORMAL).toBeUndefined();
  });
});

describe('paceFormFeatures', () => {
  const stats = {
    HOT: { mean: 0.25, n: 3 },
    SLOW: { mean: 0.65, n: 2 },
  };
  it('pace_fit = (버킷평균 - 통산) × n/(n+K) 수축', () => {
    const { paceFit, paceFitN } = paceFormFeatures(stats, 0.5, 'HOT');
    expect(paceFit).toBeCloseTo((0.25 - 0.5) * (3 / (3 + PACE_FIT_SHRINK_K)), 10);
    expect(paceFitN).toBe(3);
  });
  it('버킷 없음 → paceFit null, n=0', () => {
    const { paceFit, paceFitN } = paceFormFeatures(stats, 0.5, 'NORMAL');
    expect(paceFit).toBeNull();
    expect(paceFitN).toBe(0);
  });
  it('통산 결측 → paceFit null', () => {
    expect(paceFormFeatures(stats, null, 'HOT').paceFit).toBeNull();
  });
  it('pace_sens = n≥2 버킷 평균의 최대-최소, 유효 버킷 2개 미만이면 null', () => {
    expect(paceFormFeatures(stats, 0.5, 'HOT').paceSens).toBeCloseTo(0.65 - 0.25, 10);
    expect(paceFormFeatures({ HOT: { mean: 0.3, n: 5 } }, 0.5, 'HOT').paceSens).toBeNull();
    // n=1 버킷은 sens에서 제외
    expect(paceFormFeatures({ HOT: { mean: 0.3, n: 5 }, SLOW: { mean: 0.9, n: 1 } }, 0.5, 'HOT').paceSens).toBeNull();
  });
  it('stats undefined → 전부 결측', () => {
    expect(paceFormFeatures(undefined, 0.5, 'HOT')).toEqual({ paceFit: null, paceSens: null, paceFitN: 0 });
  });
});
