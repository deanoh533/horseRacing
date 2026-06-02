import { describe, it, expect } from 'vitest';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, figuresBeforeDate } from './speedFigure.js';

describe('parBucketKey', () => {
  it('meet·거리·주로를 하나의 키로', () => {
    expect(parBucketKey(1, 1200, '건조')).toBe('1|1200|건조');
  });
});

describe('raceSpeedFigure', () => {
  it('par/time — 빠르면(시간 작으면) 1보다 큼', () => {
    expect(raceSpeedFigure(69, 70)!).toBeCloseTo(70 / 69, 5);
  });
  it('느리면 1보다 작음', () => {
    expect(raceSpeedFigure(72, 70)!).toBeCloseTo(70 / 72, 5);
  });
  it('완주시간 0/음수면 null', () => {
    expect(raceSpeedFigure(0, 70)).toBeNull();
    expect(raceSpeedFigure(70, 0)).toBeNull();
  });
});

describe('computeAbilityRaw', () => {
  it('빈 배열 → null', () => {
    expect(computeAbilityRaw([], 5)).toBeNull();
  });
  it('최신순 figures의 최근 N개 평균', () => {
    expect(computeAbilityRaw([1.05, 1.0, 0.95, 0.9, 0.85, 0.8], 3)!).toBeCloseTo(1.0, 5);
  });
  it('N보다 적으면 있는 것만 평균', () => {
    expect(computeAbilityRaw([1.0, 0.9], 5)!).toBeCloseTo(0.95, 5);
  });
});

describe('figuresBeforeDate (as-of 누수 차단)', () => {
  const timeline = [
    { date: 20250601, fig: 1.05 },
    { date: 20250515, fig: 1.0 },
    { date: 20250401, fig: 0.95 },
    { date: 20250301, fig: 0.9 },
  ];
  it('beforeDate 이상(당일·미래)은 제외, 과거만 최신순 반환', () => {
    expect(figuresBeforeDate(timeline, 20250515)).toEqual([0.95, 0.9]);
  });
  it('과거가 없으면 빈 배열', () => {
    expect(figuresBeforeDate(timeline, 20250101)).toEqual([]);
  });
});
