import { describe, it, expect } from 'vitest';
import { parseClassBand } from './intentSignals.js';

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
