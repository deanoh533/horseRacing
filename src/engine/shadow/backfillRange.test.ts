import { describe, it, expect } from 'vitest';
import { resolveBackfillRange, nextDay } from './backfillRange.js';

describe('nextDay', () => {
  it('월말·연말을 넘긴다', () => {
    expect(nextDay(20260630)).toBe(20260701);
    expect(nextDay(20261231)).toBe(20270101);
    expect(nextDay(20240228)).toBe(20240229);
  });
});

describe('resolveBackfillRange', () => {
  it('from 생략 시 train_until 다음 날부터, to 생략 시 오늘까지', () => {
    expect(resolveBackfillRange(20260630, undefined, undefined, 20260918)).toEqual({ from: 20260701, to: 20260918 });
  });
  it('from ≤ train_until 이면 거부 (학습에 쓴 경주)', () => {
    expect(() => resolveBackfillRange(20260630, 20260630, undefined, 20260918)).toThrow(/train_until/);
  });
  it('train_until 미기록 버전은 거부', () => {
    expect(() => resolveBackfillRange(null, 20260701, undefined, 20260918)).toThrow(/train_until/);
  });
  it('from > to 거부', () => {
    expect(() => resolveBackfillRange(20260630, 20260801, 20260720, 20260918)).toThrow();
  });
});
