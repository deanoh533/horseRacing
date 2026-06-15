import { describe, it, expect } from 'vitest';
import {
  calculateRunningStylePaceScore,
  classifyRunningStyleFromData,
} from './19_running_style_pace';

describe('classifyRunningStyleFromData', () => {
  it('avg=null → unknown', () => {
    expect(classifyRunningStyleFromData(null, null)).toBe('unknown');
  });
  it('stddev >= 0.35 → free (우선 판정)', () => {
    expect(classifyRunningStyleFromData(0.1, 0.35)).toBe('free');
  });
  it('avg <= 0.15 → front', () => {
    expect(classifyRunningStyleFromData(0.15, 0.1)).toBe('front');
  });
  it('avg <= 0.35 → pace', () => {
    expect(classifyRunningStyleFromData(0.25, 0.1)).toBe('pace');
  });
  it('avg <= 0.65 → stalker', () => {
    expect(classifyRunningStyleFromData(0.5, 0.1)).toBe('stalker');
  });
  it('avg > 0.65 → closer', () => {
    expect(classifyRunningStyleFromData(0.8, 0.1)).toBe('closer');
  });
});

describe('calculateRunningStylePaceScore', () => {
  it('도주 + HOT → 0.65 (실측 역전 반영: 빠른 페이스서 도주 유리)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.1,
        stddevPositionRatio: 0.1,
        paceType: 'HOT',
      })
    ).toBe(0.65);
  });
  it('도주 + SLOW → 0.75', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.1,
        stddevPositionRatio: 0.1,
        paceType: 'SLOW',
      })
    ).toBe(0.75);
  });
  it('추입 + HOT → 0.60 (도주+HOT 0.65보다 낮음 = 역전 교정)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.8,
        stddevPositionRatio: 0.1,
        paceType: 'HOT',
      })
    ).toBe(0.60);
  });
  it('추입 + SLOW → 0.20 (최하 — 가장 불리)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.8,
        stddevPositionRatio: 0.1,
        paceType: 'SLOW',
      })
    ).toBe(0.20);
  });
  it('unknown → 0.55 중립', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: null,
        stddevPositionRatio: null,
        paceType: 'NORMAL',
      })
    ).toBe(0.55);
  });
  it('자유마 → 페이스 관계없이 0.60', () => {
    const input = { avgPositionRatio: 0.1, stddevPositionRatio: 0.4 };
    expect(calculateRunningStylePaceScore({ ...input, paceType: 'HOT' })).toBe(0.60);
    expect(calculateRunningStylePaceScore({ ...input, paceType: 'SLOW' })).toBe(0.60);
  });
});
