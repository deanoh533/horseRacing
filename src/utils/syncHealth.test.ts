import { describe, it, expect } from 'vitest';
import {
  cardAgeDays, classifyRaceDate, isLivePrediction, venueChanges, weekdayOf,
  type RaceDateCounts,
} from './syncHealth.js';

const c = (over: Partial<RaceDateCounts>): RaceDateCounts => ({
  raceDate: 20260815, entries: 100, ordFilled: 98,
  races: 10, racesWithResult: 10, racesWithCombo: 10, stTimeFilled: 10, comboRows: 9000,
  cardFetchedAt: '2026-08-12T06:00:00.000Z', meets: [1, 3], ...over,
});

describe('classifyRaceDate', () => {
  const TODAY = 20260823;

  it('결과·조합배당 다 있으면 ok', () => {
    expect(classifyRaceDate(c({}), TODAY)).toBe('ok');
  });

  it('오늘/미래 경주는 결과가 없어도 pending (구멍 아님)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260823, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('pending');
    expect(classifyRaceDate(c({ raceDate: 20260828, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('pending');
  });

  it('지난 경주인데 결과가 0건이면 hole', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('hole');
  });

  it('결과는 왔는데 조합배당만 비면 partial (조합 수집은 실패 격리됨)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, ordFilled: 87, comboRows: 0 }), TODAY)).toBe('partial');
  });

  it('출전마가 아예 없으면 판정 불가 → hole로 보고 (휴장일은 애초에 행이 없어 목록에 안 뜸)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, entries: 0, ordFilled: 0 }), TODAY)).toBe('hole');
  });
});

describe('classifyRaceDate — 부분 결과(경주 단위 대조)', () => {
  const TODAY = 20260828;

  // 실측 20260822·20260815: 19시 sync 시점에 서울 R9·R10이 아직 KRA에 없어
  // 10경주 중 8경주만 결과가 왔다. ordFilled > 0이라 기존 판정은 ✅ 정상이었다.
  it('일부 경주만 결과가 오면 gap (두수가 아니라 경주 수로 판정)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260822, entries: 97, ordFilled: 75, races: 10, racesWithResult: 8 }), TODAY
    )).toBe('gap');
  });

  it('제외마 때문에 두수만 모자란 날은 gap이 아니다 (경주는 전부 왔다)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260821, entries: 88, ordFilled: 87, races: 8, racesWithResult: 8 }), TODAY
    )).toBe('ok');
  });

  it('gap은 조합배당 누락(partial)보다 우선한다 — 재싱크가 둘 다 채운다', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260822, ordFilled: 75, races: 10, racesWithResult: 8, comboRows: 0 }), TODAY
    )).toBe('gap');
  });

  it('오늘/미래 경주는 일부만 왔어도 pending (진행 중인 게 정상)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260828, ordFilled: 40, races: 10, racesWithResult: 4 }), TODAY
    )).toBe('pending');
  });

  it('races가 0이면 경주 단위 대조를 하지 않는다 (0 < 0 비교로 오탐 금지)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260821, ordFilled: 87, races: 0, racesWithResult: 0 }), TODAY
    )).toBe('ok');
  });
});

describe('classifyRaceDate — 조합배당 도입 이전 오탐 방지', () => {
  const TODAY = 20260823;

  it('조합배당 수집 도입(2026-07-29) 이전 경주는 조합배당 0이어도 ok', () => {
    expect(classifyRaceDate(c({ raceDate: 20260718, ordFilled: 106, comboRows: 0 }), TODAY)).toBe('ok');
  });

  it('도입 당일부터는 조합배당 0이면 partial', () => {
    expect(classifyRaceDate(c({ raceDate: 20260729, ordFilled: 100, comboRows: 0 }), TODAY)).toBe('partial');
  });
});

describe('classifyRaceDate — 경주 단위 조합배당 대조', () => {
  const TODAY = 20260919;

  // 2026-09-18 발견: 그날 마지막 결과를 받은 폴러에서 조합배당만 실패하면, 날짜 전체
  // comboRows는 0이 아니라서 기존 판정은 'ok'로 통과시켰다(캐치업도 안 잡음).
  it('착순 있는 경주 중 일부에 조합배당이 없으면 partial', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260918, races: 9, racesWithResult: 9, racesWithCombo: 8, comboRows: 11000 }), TODAY
    )).toBe('partial');
  });

  it('착순 있는 경주 전부에 조합배당이 있으면 ok', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260918, races: 9, racesWithResult: 9, racesWithCombo: 9 }), TODAY
    )).toBe('ok');
  });

  it('결과 구멍(gap)이 조합배당 구멍보다 우선한다 — 재싱크가 둘 다 채운다', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260918, races: 9, racesWithResult: 8, racesWithCombo: 7 }), TODAY
    )).toBe('gap');
  });

  it('조합배당 수집 도입(2026-07-29) 이전 날짜는 경주 단위 대조도 하지 않는다', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260718, races: 10, racesWithResult: 10, racesWithCombo: 0, comboRows: 0 }), TODAY
    )).toBe('ok');
  });
});

describe('cardAgeDays', () => {
  // 2026-09-16(수) 19:22 KST = 10:22 UTC 수집 → 9/19(토) 경주는 3일 전 수집
  it('KST 달력 기준으로 경주일과의 일수를 센다', () => {
    expect(cardAgeDays('2026-09-16T10:22:00.000Z', 20260919)).toBe(3);
    expect(cardAgeDays('2026-09-16T10:22:00.000Z', 20260920)).toBe(4);
    expect(cardAgeDays('2026-09-18T10:05:00.000Z', 20260920)).toBe(2);
  });

  // UTC로 읽으면 하루가 밀리는 구간 — KST 9/17 01:00은 UTC로는 아직 9/16이다
  it('UTC 자정 근처에서도 KST 날짜로 센다', () => {
    expect(cardAgeDays('2026-09-16T16:00:00.000Z', 20260919)).toBe(2); // KST 9/17 01:00
  });

  it('당일 수집이면 0', () => {
    expect(cardAgeDays('2026-09-19T01:00:00.000Z', 20260919)).toBe(0);
  });

  // 결과만 백필된 과거 행은 출마표를 받은 적이 없다
  it('값이 없거나 못 읽으면 null', () => {
    expect(cardAgeDays(null, 20260919)).toBeNull();
    expect(cardAgeDays('아무말', 20260919)).toBeNull();
  });
});

describe('venueChanges — 경마장이 통째로 빠지는 변화', () => {
  // 2026-09-13 영천 개장: 일요일 부경 경주가 영천으로 넘어갔다.
  // races 행이 아예 안 생겨서 기존 판정엔 휴장일과 똑같이 보였고 2주치를 놓쳤다.
  it('같은 요일 직전 대비 빠진 경마장을 잡는다', () => {
    const c = venueChanges([
      { raceDate: 20260906, meets: [1, 3] }, // 일
      { raceDate: 20260913, meets: [1] },    // 일 — 부경 사라짐
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.raceDate).toBe(20260913);
    expect(c[0]!.missing).toEqual([3]);
    expect(c[0]!.comparedTo).toBe(20260906);
  });

  it('개편은 한 번만 경고하고 새 구성이 기준이 된다', () => {
    const c = venueChanges([
      { raceDate: 20260906, meets: [1, 3] },
      { raceDate: 20260913, meets: [1] },
      { raceDate: 20260920, meets: [1] },
    ]);
    expect(c).toHaveLength(1);
  });

  it('요일이 다르면 비교하지 않는다 (금=부경 / 토=서울은 원래 다름)', () => {
    const c = venueChanges([
      { raceDate: 20260918, meets: [3] }, // 금
      { raceDate: 20260919, meets: [1] }, // 토
    ]);
    expect(c).toEqual([]);
  });

  it('새 경마장이 생긴 것도 알린다', () => {
    const c = venueChanges([
      { raceDate: 20260913, meets: [1] },
      { raceDate: 20260920, meets: [1, 4] },
    ]);
    expect(c[0]!.added).toEqual([4]);
    expect(c[0]!.missing).toEqual([]);
  });
});

describe('weekdayOf', () => {
  it('YYYYMMDD의 요일을 준다 (0=일)', () => {
    expect(weekdayOf(20260920)).toBe(0); // 일요일
    expect(weekdayOf(20260918)).toBe(5); // 금요일
  });
});

describe('isLivePrediction — 백필 예측 걸러내기', () => {
  // 2026-09-22에 영천 9/13 경주를 백필하면서 실제로 생긴 경로.
  // 사전 모드(ord NULL)로 계산돼도, race_entries 누적 필드가 경주 후 스냅샷이라 라이브가 아니다.
  it('경주 뒤에 만든 예측은 라이브가 아니다', () => {
    expect(isLivePrediction('2026-09-22T01:00:00.000Z', 20260913)).toBe(false);
  });

  it('경주 전에 만든 예측은 라이브', () => {
    expect(isLivePrediction('2026-09-16T10:22:00.000Z', 20260919)).toBe(true);
  });

  it('경주 당일 생성도 라이브 (발주 전 사전 예측)', () => {
    expect(isLivePrediction('2026-09-19T01:00:00.000Z', 20260919)).toBe(true);
  });

  // KST 9/20 01:00은 UTC로는 아직 9/19 — 날짜 경계에서 밀리면 안 된다
  it('KST 날짜로 판정한다', () => {
    expect(isLivePrediction('2026-09-19T16:00:00.000Z', 20260919)).toBe(false);
  });

  it('생성 시각을 모르면 라이브로 치지 않는다', () => {
    expect(isLivePrediction(null, 20260919)).toBe(false);
    expect(isLivePrediction('아무말', 20260919)).toBe(false);
  });
});
