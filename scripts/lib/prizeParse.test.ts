import { describe, it, expect } from 'vitest';
import { parsePurse, parseRcNo } from './prizeParse.js';

describe('parsePurse', () => {
  it('콤마 천단위 상금을 정수로', () => {
    expect(parsePurse('16,500,000')).toBe(16500000);
    expect(parsePurse('6,600,000')).toBe(6600000);
    expect(parsePurse('0')).toBe(0);
  });
  it('빈값·하이픈·null → null', () => {
    expect(parsePurse('-')).toBeNull();
    expect(parsePurse('')).toBeNull();
    expect(parsePurse(null)).toBeNull();
    expect(parsePurse(undefined)).toBeNull();
  });
  it('숫자형 입력도 허용', () => {
    expect(parsePurse(16500000 as unknown as string)).toBe(16500000);
  });
});

describe('parseRcNo', () => {
  it('"1R"→1, "12R"→12', () => {
    expect(parseRcNo('1R')).toBe(1);
    expect(parseRcNo('12R')).toBe(12);
  });
  it('숫자만/이상값', () => {
    expect(parseRcNo('3')).toBe(3);
    expect(parseRcNo('-')).toBeNull();
    expect(parseRcNo(null)).toBeNull();
  });
});
