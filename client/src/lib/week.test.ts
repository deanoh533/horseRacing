import { describe, it, expect } from 'vitest';
import { weekRange, addDaysToYmd } from './week';

describe('weekRange — YYYYMMDD가 속한 월~일 주간', () => {
  it('평일(금 20260717) → 그 주 월 20260713 ~ 일 20260719', () => {
    expect(weekRange(20260717)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('월요일 입력 → 자기 자신이 from', () => {
    expect(weekRange(20260713)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('일요일 입력 → 자기 자신이 to', () => {
    expect(weekRange(20260719)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('연말 걸친 주(목 20261231) → 20261228 ~ 20270103 롤오버', () => {
    expect(weekRange(20261231)).toEqual({ from: 20261228, to: 20270103 });
  });
});

describe('addDaysToYmd — YYYYMMDD에 일수 더하기', () => {
  it('같은 달 내 이동: 20260710 + 7 = 20260717', () => {
    expect(addDaysToYmd(20260710, 7)).toBe(20260717);
  });
  it('월말 롤오버: 20260128 + 7 = 20260204', () => {
    expect(addDaysToYmd(20260128, 7)).toBe(20260204);
  });
  it('연말 롤오버: 20261230 + 7 = 20270106', () => {
    expect(addDaysToYmd(20261230, 7)).toBe(20270106);
  });
  it('음수 이동(이전 주): 20260717 - 7 = 20260710', () => {
    expect(addDaysToYmd(20260717, -7)).toBe(20260710);
  });
});
