import { describe, it, expect } from 'vitest';
import { weekRange } from './week';

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
