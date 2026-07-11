import { describe, it, expect } from 'vitest';
import { yyyymmddOffset, isEmptySync } from './syncCli.js';

describe('yyyymmddOffset', () => {
  it('+2일: 수요일 발표 → 금요일 경주', () => {
    expect(yyyymmddOffset(2, new Date(2026, 6, 8))).toBe(20260710); // 2026-07-08(수) → 07-10(금)
  });

  it('-1일: 결과 sync의 어제', () => {
    expect(yyyymmddOffset(-1, new Date(2026, 6, 11))).toBe(20260710);
  });

  it('월 경계를 넘는다', () => {
    expect(yyyymmddOffset(2, new Date(2026, 6, 30))).toBe(20260801); // 07-30 → 08-01
  });

  it('연 경계를 넘는다', () => {
    expect(yyyymmddOffset(2, new Date(2026, 11, 30))).toBe(20270101); // 12-30 → 01-01
  });

  it('now 생략 시 오늘 기준으로 8자리 정수를 낸다', () => {
    const v = yyyymmddOffset(0);
    expect(String(v)).toMatch(/^20\d{6}$/);
  });
});

describe('isEmptySync', () => {
  it('전 meet 0건이면 true', () => {
    expect(isEmptySync([{ racesSynced: 0 }, { racesSynced: 0 }])).toBe(true);
  });

  it('한 meet라도 1건 이상이면 false', () => {
    expect(isEmptySync([{ racesSynced: 0 }, { racesSynced: 3 }])).toBe(false);
  });

  it('빈 배열이면 true (아무 것도 처리 못함)', () => {
    expect(isEmptySync([])).toBe(true);
  });
});
