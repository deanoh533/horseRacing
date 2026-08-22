import { describe, it, expect } from 'vitest';
import {
  yyyymmddOffset,
  isEmptySync,
  upcomingCardDates,
  emptySyncVerdict,
} from './syncCli.js';

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

describe('emptySyncVerdict', () => {
  it('1건이라도 동기화됐으면 synced', () => {
    expect(
      emptySyncVerdict([
        { racesSynced: 0, errors: [] },
        { racesSynced: 3, errors: [] },
      ])
    ).toBe('synced');
  });

  it('0건 + 에러 없음 = 휴장일 (KRA가 빈 응답을 정상 반환)', () => {
    expect(
      emptySyncVerdict([
        { racesSynced: 0, errors: [] },
        { racesSynced: 0, errors: [] },
      ])
    ).toBe('holiday');
  });

  it('0건 + 에러 있음 = 진짜 실패 (타임아웃 등)', () => {
    expect(
      emptySyncVerdict([
        { racesSynced: 0, errors: ['전체 실패: timeout of 60000ms exceeded'] },
        { racesSynced: 0, errors: ['전체 실패: timeout of 60000ms exceeded'] },
      ])
    ).toBe('failed');
  });

  it('한 meet만 에러여도 나머지가 0건이면 실패', () => {
    expect(
      emptySyncVerdict([
        { racesSynced: 0, errors: ['rcNo=3: boom'] },
        { racesSynced: 0, errors: [] },
      ])
    ).toBe('failed');
  });

  it('동기화된 경주가 있으면 부분 에러가 있어도 synced', () => {
    expect(emptySyncVerdict([{ racesSynced: 5, errors: ['rcNo=3: boom'] }])).toBe('synced');
  });

  it('빈 배열 = 아무 것도 시도 못함 = 실패', () => {
    expect(emptySyncVerdict([])).toBe('failed');
  });

  // 회귀: 2026-08-15·08-22 서울 R9·R10 — 19시 슬롯이 야간 막판 경주를 만나면
  // KRA가 ord=0 행을 주고, dailySync가 이를 스킵한다. 전 경주가 스킵된 경우
  // "0건 + 에러 0"이라 휴장일로 오판하면 "경마 없는 날"이라 거짓 보고하게 된다.
  it('0건 + 에러 없음 + 스킵 있음 = 휴장일이 아니라 pending (다음 슬롯 대기)', () => {
    expect(
      emptySyncVerdict([
        { racesSynced: 0, racesSkipped: 2, errors: [] },
        { racesSynced: 0, racesSkipped: 0, errors: [] },
      ])
    ).toBe('pending');
  });

  it('스킵이 있어도 동기화된 경주가 있으면 synced', () => {
    expect(emptySyncVerdict([{ racesSynced: 8, racesSkipped: 2, errors: [] }])).toBe('synced');
  });

  it('스킵 + 에러가 함께면 실패가 우선 (구멍 가능성)', () => {
    expect(
      emptySyncVerdict([{ racesSynced: 0, racesSkipped: 2, errors: ['rcNo=3: boom'] }])
    ).toBe('failed');
  });
});
