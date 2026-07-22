import { describe, it, expect } from 'vitest';
import { yyyymmddOffset, isEmptySync, upcomingCardDates } from './syncCli.js';

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

describe('upcomingCardDates', () => {
  // 출마표는 수요일에 금·토·일 3일치가 한 번에 발표 → 각 실행이 "남은 주말 전체"를 받는다.
  it('수요일 실행: 이번 주 금·토·일 3일치', () => {
    // 2026-07-08(수) → 금 07-10, 토 07-11, 일 07-12
    expect(upcomingCardDates(new Date(2026, 6, 8))).toEqual([20260710, 20260711, 20260712]);
  });

  it('목요일 실행: 토·일만 (금은 어제 이미 받음)', () => {
    // 2026-07-09(목) → 토 07-11, 일 07-12
    expect(upcomingCardDates(new Date(2026, 6, 9))).toEqual([20260711, 20260712]);
  });

  it('금요일 실행: 일요일만', () => {
    // 2026-07-10(금) → 일 07-12
    expect(upcomingCardDates(new Date(2026, 6, 10))).toEqual([20260712]);
  });

  it('월 경계를 넘는 주말도 이어서 반환', () => {
    // 2026-07-29(수) → 금 07-31, 토 08-01, 일 08-02
    expect(upcomingCardDates(new Date(2026, 6, 29))).toEqual([20260731, 20260801, 20260802]);
  });

  it('주말이 아닌 요일(수동 실행)엔 발표일+2 단일 날짜로 폴백', () => {
    // 2026-07-12(일) → 폴백 today+2 = 07-14(화)
    expect(upcomingCardDates(new Date(2026, 6, 12))).toEqual([20260714]);
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
