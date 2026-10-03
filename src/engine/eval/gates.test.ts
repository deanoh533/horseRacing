import { describe, it, expect } from 'vitest';
import { gateHoldoutBefore, holdoutOverlapsTest } from './gates.js';

describe('gateHoldoutBefore', () => {
  it('첫 시험 분기의 바로 앞 분기', () => {
    expect(gateHoldoutBefore({ year: 2025, q: 1 })).toEqual({ start: 20241001, end: 20241231 });
    expect(gateHoldoutBefore({ year: 2025, q: 3 })).toEqual({ start: 20250401, end: 20250630 });
  });
});

describe('holdoutOverlapsTest', () => {
  it('holdout 끝이 첫 시험 분기 시작 이상이면 겹친다', () => {
    expect(holdoutOverlapsTest({ start: 20251001, end: 20251231 }, 20250101)).toBe(true);
    expect(holdoutOverlapsTest({ start: 20241001, end: 20241231 }, 20250101)).toBe(false);
  });
});
