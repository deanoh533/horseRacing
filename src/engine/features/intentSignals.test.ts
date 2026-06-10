import { describe, it, expect } from 'vitest';
import { parseClassBand, equipDiff } from './intentSignals.js';

describe('parseClassBand', () => {
  it('R0~NN에서 상한(클래스 서열)을 뽑는다', () => {
    expect(parseClassBand('R0~65')).toBe(65);
    expect(parseClassBand('R0~80')).toBe(80);
    expect(parseClassBand('R0~110')).toBe(110);
  });
  it('숫자 없거나 null이면 null', () => {
    expect(parseClassBand(null)).toBeNull();
    expect(parseClassBand('')).toBeNull();
    expect(parseClassBand('별정')).toBeNull();
    expect(parseClassBand(undefined)).toBeNull();
  });
});

describe('equipDiff', () => {
  it('추가/제거 개수 (오늘 vs 직전)', () => {
    expect(equipDiff(['블', '가'], ['블'])).toEqual({ added: 1, removed: 0 });
    expect(equipDiff(['블'], ['블', '가'])).toEqual({ added: 0, removed: 1 });
    expect(equipDiff(['블'], ['블'])).toEqual({ added: 0, removed: 0 });
    expect(equipDiff([], [])).toEqual({ added: 0, removed: 0 });
    expect(equipDiff(['블', '가'], ['차'])).toEqual({ added: 2, removed: 1 });
  });
});
